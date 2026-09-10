package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/go-github/v88/github"
	"github.com/kuberik/rollout-dashboard/pkg/githubapp"
)

const (
	changesDefaultDays = 30
	changesMaxDays     = 365
	// changesMaxResults caps the whole response (across every repo), not
	// per-repo — a "did my stuff land" list is only useful as a recent
	// ledger, not an unbounded export.
	changesMaxResults = 100
	// changesPullsMaxPages / changesCommitsMaxPages are page caps, not
	// commit-count caps (unlike main_github_pulls.go's maxContainedInCommits)
	// — the budget in the design doc is stated as page counts per repo
	// (1 repo call + up to 2 pulls pages + up to 3 commits pages), so that's
	// exactly what's enforced here.
	changesPullsMaxPages   = 2
	changesCommitsMaxPages = 3
	// changesDefaultBranchCacheTTL matches pullsMineLoginCacheTTL's
	// reasoning: a repo's default branch changes rarely enough that paying
	// for repos/{o}/{r} on every poll tick would be wasted budget.
	changesDefaultBranchCacheTTL = 10 * time.Minute
)

// handleGitHubChanges serves GET /api/github/changes?days=30&repo=<owner/repo>
// — "did my changes land for this service/environment": every MERGED pull
// request, plus every base-branch commit that has no pull request at all,
// across every repo this cluster's visible rollouts deploy (or just the one
// named by `repo`), within `days`. Open PRs are deliberately excluded, same
// reasoning as GET /api/github/pulls/mine (main_github_pulls_mine.go): the
// human wants to know what shipped, not what's in flight.
//
// This handler only LISTS changes — it does not join them to rollouts/builds.
// That join happens in the frontend, in memory, against whatever rollout
// data it already has: this endpoint has no opinion about which service or
// environment a change belongs to.
//
// ── Rate-limit budget ────────────────────────────────────────────────────
// Per visible repo, on a fresh (uncached) load:
//   - 1 call to repos/{o}/{r} for the default branch (cached
//     changesDefaultBranchCacheTTL per repo, like pullsMineLoginCacheTTL).
//   - up to changesPullsMaxPages calls to pulls?state=closed&sort=updated.
//   - up to changesCommitsMaxPages calls to commits?sha=<default>&since=...
//
// That's <= 1 + 2 + 3 = 6 core-API calls per repo. Every call goes through
// githubapp.UserClient's cached transport (pkg/githubcache), so a repeat
// poll of unchanged data answers 304 and costs nothing further against the
// budget.
func handleGitHubChanges(c *gin.Context) {
	k8sClient, ok := getK8sReadClient(c)
	if !ok {
		return
	}
	visible, err := visibleGitHubSources(c, k8sClient)
	if err != nil {
		log.Printf("Error checking repository visibility for changes: %v", err)
		writeUpstreamError(c, "Failed to check repository visibility", err)
		return
	}

	var repos []string
	if repoParam := c.Query("repo"); repoParam != "" {
		owner, repo, ok := splitOwnerRepo(repoParam)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid repo parameter, expected owner/repo"})
			return
		}
		key := githubapp.NormalizedRepoKey(owner, repo)
		if !visible[key] {
			// Same cluster-scope 404 as the other GitHub endpoints: a repo
			// no visible rollout deploys is not this cluster's to answer
			// for, distinguished from a normal empty result.
			c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "scope": "repo"})
			return
		}
		repos = []string{key}
	} else {
		for r := range visible {
			repos = append(repos, r)
		}
		sort.Strings(repos)
	}
	if len(repos) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "scope": "repo"})
		return
	}

	token := readCookie(c, githubTokenCookie)
	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "github_not_connected"})
		return
	}
	ghClient, err := githubapp.UserClient(token)
	if err != nil {
		writeUpstreamError(c, "Failed to build GitHub client", err)
		return
	}

	ctx := c.Request.Context()
	login, err := cachedLogin(ctx, ghClient, token)
	if err != nil {
		if respondGitHubCommonErrors(c, err, "user") {
			return
		}
		log.Printf("Error fetching GitHub user for changes: %v", err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to fetch GitHub user", "details": err.Error()})
		return
	}

	days := changesDefaultDays
	if d, derr := strconv.Atoi(c.Query("days")); derr == nil && d > 0 {
		days = d
	}
	if days > changesMaxDays {
		days = changesMaxDays
	}
	sinceTime := time.Now().AddDate(0, 0, -days)
	mineOnly := c.Query("mine") == "1"

	var allChanges []*ghChange
	for _, repoKey := range repos {
		owner, repo, ok := splitOwnerRepo(repoKey)
		if !ok {
			continue // defensive only: repoKey came from NormalizedRepoKey, always owner/repo
		}
		changes, cerr := changesForRepo(ctx, ghClient, owner, repo, sinceTime)
		if cerr != nil {
			if isGitHubUnauthorized(cerr) {
				// The token itself is bad — true for every remaining repo
				// too, so stop and answer once, same as every other GitHub
				// endpoint's revoked-token handling.
				c.SetCookie(githubTokenCookie, "", -1, "/", "", true, true)
				c.JSON(http.StatusUnauthorized, gin.H{"error": "github_not_connected"})
				return
			}
			// Any other per-repo failure (this specific repo renamed/deleted
			// on GitHub, a transient 5xx, etc.) degrades gracefully: this is
			// a multi-repo aggregation, not a single-repo-scoped answer, so
			// one repo's trouble doesn't 502 every other repo's data.
			log.Printf("Error fetching changes for %s/%s: %v", owner, repo, cerr)
			continue
		}
		allChanges = append(allChanges, changes...)
	}

	if mineOnly {
		filtered := allChanges[:0:0]
		for _, ch := range allChanges {
			if ch.Author == login {
				filtered = append(filtered, ch)
			}
		}
		allChanges = filtered
	}

	sort.Slice(allChanges, func(i, j int) bool { return allChanges[i].mergedAtTime.After(allChanges[j].mergedAtTime) })
	if len(allChanges) > changesMaxResults {
		allChanges = allChanges[:changesMaxResults]
	}
	if allChanges == nil {
		allChanges = []*ghChange{}
	}

	writeJSONWithETag(c, http.StatusOK, ghChangesResponse{
		User:    login,
		Repos:   repos,
		Since:   sinceTime.Format("2006-01-02"),
		Changes: allChanges,
	})
}

// ghChange is one entry of GET /api/github/changes' `changes` array — either
// a merged pull request (kind "pr") or a base-branch commit with no pull
// request at all (kind "commit").
type ghChange struct {
	Owner          string   `json:"owner"`
	Repo           string   `json:"repo"`
	Kind           string   `json:"kind"` // "pr" | "commit"
	Number         *int     `json:"number,omitempty"`
	Title          string   `json:"title"`
	HTMLURL        string   `json:"htmlUrl"`
	Author         string   `json:"author"`
	MergedAt       *string  `json:"mergedAt"` // commit kind: its committed date
	MergeCommitSHA *string  `json:"mergeCommitSha"`
	HeadSHA        *string  `json:"headSha,omitempty"`
	Base           string   `json:"base"`
	ChangedFiles   *int     `json:"changedFiles,omitempty"`
	ContainedIn    []string `json:"containedIn"`
	ContainedInAll bool     `json:"containedInAll"`

	// mergedAtTime is the sort key; unexported so it never marshals.
	mergedAtTime time.Time
}

type ghChangesResponse struct {
	User    string      `json:"user"`
	Repos   []string    `json:"repos"`
	Since   string      `json:"since"`
	Changes []*ghChange `json:"changes"`
}

// changesForRepo fetches and classifies every change for one repo: the
// default branch, the merged-PR list, and the default-branch commit list,
// then hands them to classifyChanges to tell PRs (of every merge style) apart
// from bare commits.
func changesForRepo(ctx context.Context, ghClient *github.Client, owner, repo string, sinceTime time.Time) ([]*ghChange, error) {
	defaultBranch, err := cachedDefaultBranch(ctx, ghClient, owner, repo)
	if err != nil {
		return nil, err
	}
	if defaultBranch == "" {
		defaultBranch = "main"
	}

	prs, err := fetchMergedPulls(ctx, ghClient, owner, repo, sinceTime)
	if err != nil {
		return nil, err
	}

	commits, cutByCap, err := fetchDefaultBranchCommits(ctx, ghClient, owner, repo, defaultBranch, sinceTime)
	if err != nil {
		return nil, err
	}

	// GitHub's commits list for sha=<default> returns every commit reachable
	// from the branch head, in commit-date order — that includes
	// second-parent (branch-side) commits of every merge commit on the way,
	// which are not themselves "a change on the default branch": they only
	// landed as part of the merge commit that brought them in. Filter down
	// to the first-parent chain before classifying, so a PR's own
	// branch-side commits never show up as separate, spurious changes.
	commits = firstParentChain(commits)

	return classifyChanges(owner, repo, defaultBranch, prs, commits, cutByCap), nil
}

// firstParentChain walks commits (as returned by the GitHub commits API for
// sha=<default>, newest first) starting at commits[0] — the branch head —
// and follows each commit's first parent (parents[0]) only, returning just
// the commits on that chain, still newest first.
//
// A "change" on the default branch is a first-parent commit only: a merge
// commit's second (and later) parents are the branch it merged, not commits
// that landed on the default branch in their own right — they're already
// represented by the merge commit itself. Since GitHub's commits list
// contains every commit reachable from the head (both chain and
// branch-side), those branch-side commits appear in commits but must never
// become their own change entries, and this is the only place that drops
// them.
//
// The walk stops when a parent's sha isn't found among the fetched commits
// — either because it's genuinely the repo's root commit, or because it's
// older than `since`/the page cap and so was never fetched at all. Either
// way, there's nothing further this handler can attribute a change to, and
// classifyChanges's existing cutByCap/containedInAll signal already tells
// the caller the list may be incomplete.
func firstParentChain(commits []*github.RepositoryCommit) []*github.RepositoryCommit {
	if len(commits) == 0 {
		return nil
	}
	bySHA := make(map[string]*github.RepositoryCommit, len(commits))
	for _, rc := range commits {
		bySHA[rc.GetSHA()] = rc
	}

	chain := make([]*github.RepositoryCommit, 0, len(commits))
	seen := make(map[string]bool, len(commits))
	cur := commits[0]
	for cur != nil {
		sha := cur.GetSHA()
		if seen[sha] {
			break // defensive cycle guard; a real git history is acyclic
		}
		seen[sha] = true
		chain = append(chain, cur)

		parents := cur.GetParents()
		if len(parents) == 0 {
			break // repo root
		}
		next, ok := bySHA[parents[0].GetSHA()]
		if !ok {
			break // parent falls outside the fetched window
		}
		cur = next
	}
	return chain
}

// fetchMergedPulls lists repo's closed pull requests (sorted by updated,
// most recent first), paging until either changesPullsMaxPages is reached or
// a page's oldest (last) entry was updated before sinceTime — everything
// past that point is even older, so paging further can only waste budget.
// The result is filtered down to pulls actually merged on/after sinceTime;
// the updated-time early-exit and the merged-time filter are deliberately
// different fields (a PR can be updated — e.g. a comment — long after it
// merged, or merge long after the update window would suggest).
func fetchMergedPulls(ctx context.Context, ghClient *github.Client, owner, repo string, sinceTime time.Time) ([]*github.PullRequest, error) {
	opts := &github.PullRequestListOptions{
		State:       "closed",
		Sort:        "updated",
		Direction:   "desc",
		ListOptions: github.ListOptions{PerPage: 100},
	}
	var all []*github.PullRequest
	for page := 1; page <= changesPullsMaxPages; page++ {
		opts.Page = page
		items, resp, err := ghClient.PullRequests.List(ctx, owner, repo, opts)
		if err != nil {
			return nil, err
		}
		all = append(all, items...)
		if len(items) == 0 {
			break
		}
		last := items[len(items)-1]
		if last.UpdatedAt != nil && last.UpdatedAt.Time.Before(sinceTime) {
			break
		}
		if resp.NextPage == 0 {
			break
		}
	}

	merged := make([]*github.PullRequest, 0, len(all))
	for _, pr := range all {
		if pr.MergedAt != nil && !pr.MergedAt.Time.Before(sinceTime) {
			merged = append(merged, pr)
		}
	}
	return merged, nil
}

// fetchDefaultBranchCommits lists commits on defaultBranch since sinceTime,
// paging up to changesCommitsMaxPages. cutByCap reports whether more pages
// existed beyond the cap — i.e. whether the returned list (and therefore
// every containedIn computed from it) might be missing older commits still
// inside the `since` window, the same "list is truncated, fall back to
// dates" signal main_github_pulls.go's containedInAll uses.
func fetchDefaultBranchCommits(ctx context.Context, ghClient *github.Client, owner, repo, defaultBranch string, sinceTime time.Time) ([]*github.RepositoryCommit, bool, error) {
	opts := &github.CommitsListOptions{
		SHA:         defaultBranch,
		Since:       sinceTime,
		ListOptions: github.ListOptions{PerPage: 100},
	}
	var all []*github.RepositoryCommit
	cutByCap := false
	for page := 1; page <= changesCommitsMaxPages; page++ {
		opts.Page = page
		items, resp, err := ghClient.Repositories.ListCommits(ctx, owner, repo, opts)
		if err != nil {
			return nil, false, err
		}
		all = append(all, items...)
		if resp.NextPage == 0 {
			break
		}
		if page == changesCommitsMaxPages {
			cutByCap = true
		}
	}
	return all, cutByCap, nil
}

// classifyChanges tells apart, for one repo's already-fetched merged-PR list
// and default-branch commit list (newest-first, first-parent-only — see
// firstParentChain, which the caller has already applied):
//
//  1. a commit whose sha IS a listed PR's merge_commit_sha — that PR, however
//     it merged (merge commit, rebase, or squash: for a squash/rebase the
//     merge_commit_sha IS the one commit that landed, so this rule alone
//     already catches most of them).
//  2. otherwise, a single-parent commit whose message's first line starts
//     with a listed PR's title, or ends with "(#N)" for a listed PR number N
//     — a squash merge GitHub's UI produced without preserving
//     merge_commit_sha equality (defensive: in practice rule 1 already
//     covers squash merges, since GitHub always sets merge_commit_sha to the
//     squash commit itself).
//  3. otherwise, a bare commit — pushed straight to the default branch with
//     no pull request. This also covers a merge commit that matches no PR
//     (e.g. merged through some path this handler didn't see, or a plain
//     `git merge` with no PR at all): since firstParentChain already dropped
//     its second-parent (branch-side) commits, the merge commit itself is
//     the only remaining record that anything landed, so it becomes a
//     "commit"-kind change titled by its own subject line rather than
//     vanishing.
//
// containedIn for every change is computed from this same commit list (no
// extra calls): the shas of commits that come BEFORE it in this
// newest-first list, i.e. that happened chronologically AFTER it and so
// already carry it into every subsequent build. containedInAll mirrors
// cutByCap for the whole repo — the whole list may be missing older commits
// still in-window, and every entry's containedIn shares that same
// uncertainty (rather than only certain, positionally-late entries), so the
// frontend is told plainly to fall back to per-release dates instead of
// half-trusting a partially truncated list.
func classifyChanges(owner, repo, defaultBranch string, prs []*github.PullRequest, commits []*github.RepositoryCommit, cutByCap bool) []*ghChange {
	prChanges := make([]*ghChange, len(prs))
	mergeShaIndex := make(map[string]int, len(prs))
	for i, pr := range prs {
		prChanges[i] = prToChange(owner, repo, pr)
		if sha := pr.GetMergeCommitSHA(); sha != "" {
			mergeShaIndex[sha] = i
		}
	}

	positions := make(map[*ghChange]int, len(commits))

	// Pass 1: exact merge_commit_sha equality (rule 1) always wins and is
	// never overwritten below — a commit whose sha IS a PR's reported
	// merge_commit_sha is unambiguously that PR's position, no matter what
	// an older commit's message happens to look like.
	hasExactMatch := make([]bool, len(prs))
	for idx, rc := range commits {
		if i, ok := mergeShaIndex[rc.GetSHA()]; ok {
			positions[prChanges[i]] = idx
			hasExactMatch[i] = true
		}
	}

	// Pass 2: the squash/rebase message heuristic (rule 2, only for PRs pass
	// 1 didn't already place, and only when the commit isn't implausibly
	// older than the PR's merged_at), and bare commits (rule 3 — including
	// untracked merge commits, now that firstParentChain has already
	// stripped their second-parent branch-side commits).
	var bareChanges []*ghChange
	for idx, rc := range commits {
		sha := rc.GetSHA()
		if _, ok := mergeShaIndex[sha]; ok {
			continue // already positioned in pass 1
		}
		if i := matchSquashPR(rc.GetCommit().GetMessage(), prs); i >= 0 && !hasExactMatch[i] && !squashMatchTooOld(rc, prs[i]) {
			if _, already := positions[prChanges[i]]; !already {
				positions[prChanges[i]] = idx
				continue
			}
		}
		bc := bareCommitToChange(owner, repo, defaultBranch, rc)
		positions[bc] = idx
		bareChanges = append(bareChanges, bc)
	}

	all := make([]*ghChange, 0, len(prChanges)+len(bareChanges))
	all = append(all, prChanges...)
	all = append(all, bareChanges...)
	for _, ch := range all {
		if idx, ok := positions[ch]; ok {
			ch.ContainedIn = shasBefore(commits, idx)
		} else {
			ch.ContainedIn = []string{}
		}
		// Defensive: containedIn must never contain the entry's own sha,
		// regardless of how its position was computed above. See the
		// 2026-09-10 QA report (kuberik-testing#2, kuberik-testing-second#2)
		// for the bug this guards against.
		ch.ContainedIn = removeOwnSha(ch.ContainedIn, ch.MergeCommitSHA)
		ch.ContainedInAll = cutByCap
	}
	return all
}

// removeOwnSha strips ownSha out of containedIn if present. shasBefore
// already excludes the commit at its own position, so this should be a
// no-op in practice — but containedIn contradicting its own contract (an
// entry can't be contained in itself) is exactly the class of bug this
// handler must not reintroduce, so it's asserted here too, not just in
// classifyChanges's position bookkeeping.
func removeOwnSha(containedIn []string, ownSha *string) []string {
	if ownSha == nil || *ownSha == "" {
		return containedIn
	}
	for i, s := range containedIn {
		if s == *ownSha {
			out := make([]string, 0, len(containedIn)-1)
			out = append(out, containedIn[:i]...)
			out = append(out, containedIn[i+1:]...)
			return out
		}
	}
	return containedIn
}

// changesSquashMatchGrace bounds how much older than a PR's merged_at a
// commit may be and still be treated as that PR's squash/rebase commit by
// the matchSquashPR title/suffix heuristic (classifyChanges rule 3). A real
// squash commit lands at merge time, modulo clock skew; an unrelated OLDER
// commit that merely happens to share a title prefix (e.g. a bare "Fix
// widget bug" commit predating a later PR titled "Fix widget bug (round 2)")
// must not steal that PR's position — that mix-up is exactly what corrupted
// containedIn for kuberik-testing#2 (f7a46ae) and kuberik-testing-second#2
// (dfdee1e) in the 2026-09-10 QA report.
const changesSquashMatchGrace = 5 * time.Minute

// squashMatchTooOld reports whether rc is implausibly older than pr's
// merged_at to be pr's squash/rebase commit (see changesSquashMatchGrace).
// Missing data (no merged_at, no commit date) is treated as "too old" —
// fails closed into a bare commit rather than risking a false positional
// match.
func squashMatchTooOld(rc *github.RepositoryCommit, pr *github.PullRequest) bool {
	if pr.MergedAt == nil {
		return true
	}
	date := commitDate(rc)
	if date.IsZero() {
		return true
	}
	return date.Before(pr.MergedAt.Time.Add(-changesSquashMatchGrace))
}

// commitDate returns rc's committer date, falling back to its author date,
// or the zero time if neither is set — the same preference order
// bareCommitToChange uses for a bare commit's displayed date.
func commitDate(rc *github.RepositoryCommit) time.Time {
	commit := rc.GetCommit()
	if commit == nil {
		return time.Time{}
	}
	if commit.Committer != nil && commit.Committer.Date != nil {
		return commit.Committer.Date.Time
	}
	if commit.Author != nil && commit.Author.Date != nil {
		return commit.Author.Date.Time
	}
	return time.Time{}
}

// shasBefore returns the shas of commits[0:idx] — the entries that precede
// idx in a newest-first list, i.e. commits that landed chronologically after
// the one at idx.
func shasBefore(commits []*github.RepositoryCommit, idx int) []string {
	out := make([]string, 0, idx)
	for i := 0; i < idx; i++ {
		out = append(out, commits[i].GetSHA())
	}
	return out
}

// matchSquashPR returns the index into prs of the PR whose "(#N)" suffix or
// title prefix matches message's first line, or -1. See classifyChanges
// rule 3. The "(#N)" suffix (GitHub's own squash-merge default commit
// format, naming an exact PR number) is checked across every PR before any
// title-prefix match is considered, since a title prefix is just a
// substring test and can coincidentally match an unrelated commit whose
// message happens to start the same way — the suffix match is the more
// specific, more trustworthy signal and must win when both are available.
func matchSquashPR(message string, prs []*github.PullRequest) int {
	line := firstLine(message)
	for i, pr := range prs {
		if suffix := fmt.Sprintf("(#%d)", pr.GetNumber()); strings.HasSuffix(line, suffix) {
			return i
		}
	}
	for i, pr := range prs {
		if title := pr.GetTitle(); title != "" && strings.HasPrefix(line, title) {
			return i
		}
	}
	return -1
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	return strings.TrimSpace(s)
}

func prToChange(owner, repo string, pr *github.PullRequest) *ghChange {
	number := pr.GetNumber()
	var mergedAt *string
	var mergedAtTime time.Time
	if pr.MergedAt != nil {
		mergedAtTime = pr.MergedAt.Time
		mergedAt = formatGHTimestamp(pr.MergedAt)
	}
	var mergeSha *string
	if sha := pr.GetMergeCommitSHA(); sha != "" {
		mergeSha = &sha
	}
	var headSha *string
	if pr.Head != nil && pr.Head.SHA != nil {
		headSha = pr.Head.SHA
	}
	base := ""
	if pr.Base != nil {
		base = pr.Base.GetRef()
	}
	return &ghChange{
		Owner:          owner,
		Repo:           repo,
		Kind:           "pr",
		Number:         &number,
		Title:          pr.GetTitle(),
		HTMLURL:        pr.GetHTMLURL(),
		Author:         pr.GetUser().GetLogin(),
		MergedAt:       mergedAt,
		MergeCommitSHA: mergeSha,
		HeadSHA:        headSha,
		Base:           base,
		ContainedIn:    []string{},
		mergedAtTime:   mergedAtTime,
	}
}

func bareCommitToChange(owner, repo, defaultBranch string, rc *github.RepositoryCommit) *ghChange {
	sha := rc.GetSHA()
	title := ""
	author := ""
	var mergedAt *string
	var mergedAtTime time.Time

	if commit := rc.GetCommit(); commit != nil {
		title = firstLine(commit.GetMessage())
		var date *github.Timestamp
		if commit.Committer != nil && commit.Committer.Date != nil {
			date = commit.Committer.Date
		} else if commit.Author != nil && commit.Author.Date != nil {
			date = commit.Author.Date
		}
		if date != nil && !date.IsZero() {
			mergedAtTime = date.Time
			mergedAt = formatGHTimestamp(date)
		}
		if commit.Author != nil {
			author = commit.Author.GetName()
		}
	}
	if rc.Author != nil && rc.Author.GetLogin() != "" {
		author = rc.Author.GetLogin()
	}

	return &ghChange{
		Owner:          owner,
		Repo:           repo,
		Kind:           "commit",
		Title:          title,
		HTMLURL:        rc.GetHTMLURL(),
		Author:         author,
		MergedAt:       mergedAt,
		MergeCommitSHA: &sha,
		Base:           defaultBranch,
		ContainedIn:    []string{},
		mergedAtTime:   mergedAtTime,
	}
}

// splitOwnerRepo splits an "owner/repo" string. Used both for the `repo`
// query param (untrusted input, may be malformed) and for re-splitting an
// already-normalized key from visibleGitHubSources (always well-formed,
// since NormalizedRepoKey only ever joins with a single "/").
func splitOwnerRepo(s string) (owner, repo string, ok bool) {
	parts := strings.SplitN(s, "/", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", false
	}
	return parts[0], parts[1], true
}

// defaultBranchCache maps sha256... no — NormalizedRepoKey(owner, repo) ->
// its default branch, for changesDefaultBranchCacheTTL. Unlike loginCache
// (main_github_pulls_mine.go), the key here is not sensitive (a repo name,
// not a token), so it's kept in plain text.
var (
	defaultBranchCacheMu sync.Mutex
	defaultBranchCache   = map[string]defaultBranchCacheEntry{}
)

type defaultBranchCacheEntry struct {
	branch    string
	expiresAt time.Time
}

func cachedDefaultBranch(ctx context.Context, ghClient *github.Client, owner, repo string) (string, error) {
	key := githubapp.NormalizedRepoKey(owner, repo)

	defaultBranchCacheMu.Lock()
	if e, ok := defaultBranchCache[key]; ok && time.Now().Before(e.expiresAt) {
		defaultBranchCacheMu.Unlock()
		return e.branch, nil
	}
	defaultBranchCacheMu.Unlock()

	repoObj, _, err := ghClient.Repositories.Get(ctx, owner, repo)
	if err != nil {
		return "", err
	}
	branch := repoObj.GetDefaultBranch()

	defaultBranchCacheMu.Lock()
	defaultBranchCache[key] = defaultBranchCacheEntry{branch: branch, expiresAt: time.Now().Add(changesDefaultBranchCacheTTL)}
	defaultBranchCacheMu.Unlock()
	return branch, nil
}
