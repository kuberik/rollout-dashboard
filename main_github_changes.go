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

	return classifyChanges(owner, repo, defaultBranch, prs, commits, cutByCap), nil
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
// and default-branch commit list (newest-first, as GitHub returns them):
//
//  1. a commit whose sha IS a listed PR's merge_commit_sha — that PR, however
//     it merged (merge commit, rebase, or squash: for a squash/rebase the
//     merge_commit_sha IS the one commit that landed, so this rule alone
//     already catches most of them).
//  2. otherwise, a commit with more than one parent — an untracked merge
//     commit (e.g. a PR merged through some path this handler didn't see, or
//     a merge from a branch with no open/closed PR at all) — skipped
//     entirely: it is not itself a "change" a human authored, and whatever
//     PR it belonged to (if any) is either already caught by rule 1 or is
//     outside this handler's data.
//  3. otherwise, a single-parent commit whose message's first line starts
//     with a listed PR's title, or ends with "(#N)" for a listed PR number N
//     — a squash merge GitHub's UI produced without preserving
//     merge_commit_sha equality (defensive: in practice rule 1 already
//     covers squash merges, since GitHub always sets merge_commit_sha to the
//     squash commit itself).
//  4. otherwise, a bare commit — pushed straight to the default branch with
//     no pull request.
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

	var bareChanges []*ghChange
	positions := make(map[*ghChange]int, len(commits))
	for idx, rc := range commits {
		sha := rc.GetSHA()
		if i, ok := mergeShaIndex[sha]; ok {
			positions[prChanges[i]] = idx
			continue
		}
		if len(rc.GetParents()) > 1 {
			continue // untracked merge commit
		}
		if i := matchSquashPR(rc.GetCommit().GetMessage(), prs); i >= 0 {
			positions[prChanges[i]] = idx
			continue
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
		ch.ContainedInAll = cutByCap
	}
	return all
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

// matchSquashPR returns the index into prs of the PR whose title or "(#N)"
// suffix matches message's first line, or -1. See classifyChanges rule 3.
func matchSquashPR(message string, prs []*github.PullRequest) int {
	line := firstLine(message)
	for i, pr := range prs {
		if title := pr.GetTitle(); title != "" && strings.HasPrefix(line, title) {
			return i
		}
		if suffix := fmt.Sprintf("(#%d)", pr.GetNumber()); strings.HasSuffix(line, suffix) {
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
