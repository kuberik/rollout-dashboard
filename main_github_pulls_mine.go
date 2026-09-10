package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
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
	pullsMineDefaultDays = 30
	pullsMineMaxDays     = 365
	pullsMineMaxResults  = 50
	// pullsMineSearchRepoChunk bounds how many `repo:` qualifiers go into one
	// search query — GitHub's search query has a length/qualifier budget, so
	// a cluster with a large source set is split into multiple sequential
	// search calls rather than one query that GitHub would reject.
	pullsMineSearchRepoChunk = 20
	// pullsMineMaxDetailFetch caps the number of pulls/{n} calls made to
	// backfill mergeCommitSha/headSha/base for merged PRs the search result
	// doesn't carry that data for. Capped, not per-PR, because a user with a
	// long merged history should still get a bounded number of core-API
	// calls per page view.
	pullsMineMaxDetailFetch = 20
	pullsMineDetailWorkers  = 5
	// pullsMineLoginCacheTTL caches Users.Get(token) so a 5-minute poll loop
	// doesn't spend a call on "who am I" every tick.
	pullsMineLoginCacheTTL = 10 * time.Minute
)

// handleGitHubPullsMine serves GET /api/github/pulls/mine?days=30 — "Your
// PRs" (design doc, Approach B): every PR the viewing user authored AND
// merged, across every repo this cluster's visible rollouts deploy, updated
// within `days`. Open (and closed-without-merging) PRs are deliberately
// excluded: the human only cares whether their change landed, not whether
// they have something in flight.
//
// ── Rate-limit budget ────────────────────────────────────────────────────
// The GitHub Search API is budgeted separately from the core API: 30
// requests/minute per authenticated user (vs. 5000/hour core). This handler
// spends:
//   - ONE search call per page view, or ceil(repos/20) when the visible
//     source set exceeds pullsMineSearchRepoChunk repos (a repo: qualifier
//     per repo keeps each query's length under GitHub's cap). At a 5-minute
//     poll interval that is 12 search calls/hour for a <=20-repo cluster —
//     well inside the 1800/hour (30/min) search budget, with headroom for
//     every other tab the same user has open.
//   - Users.Get, but only once per pullsMineLoginCacheTTL (10 min) per
//     token, not per request — a poll tick almost always skips it entirely.
//   - Up to pullsMineMaxDetailFetch (20) core-API pulls/{n} calls, ONLY for
//     PRs the search result reports as merged (search results don't carry
//     merge_commit_sha). These go through githubapp.UserClient's cached
//     transport (pkg/githubcache), so a repeat poll's already-seen merged
//     PRs answer 304 and cost nothing against the core budget either — the
//     real cost is at most 20 calls the FIRST time each PR appears merged.
//
// The response is served through writeJSONWithETag (main_etag.go), same as
// /api/rollouts: "Cache-Control: private, no-cache" (the browser MAY store
// the body but MUST always revalidate) plus a strong ETag, so the frontend's
// plain `fetch` on its 5-minute poll (my-pulls.ts) gets a 304 with no body
// for free whenever nothing changed — no hand-rolled If-None-Match plumbing
// on either side. NOT "no-store": that would tell the browser to keep
// nothing at all, silently defeating the poll-cheaply contract this
// endpoint exists for. A 304 doesn't save the upstream search call itself
// (GitHub still has to be asked whether anything changed) — the saving is
// entirely in what the frontend does with a same-content answer.
func handleGitHubPullsMine(c *gin.Context) {
	k8sClient, ok := getK8sReadClient(c)
	if !ok {
		return
	}
	visible, err := visibleGitHubSources(c, k8sClient)
	if err != nil {
		log.Printf("Error checking repository visibility for pulls/mine: %v", err)
		writeUpstreamError(c, "Failed to check repository visibility", err)
		return
	}
	repos := make([]string, 0, len(visible))
	for r := range visible {
		repos = append(repos, r)
	}
	sort.Strings(repos)
	if len(repos) == 0 {
		// Same cluster-scope 404 shape as the other two GitHub endpoints —
		// nothing to look up at all, distinguished from "connected, zero PRs
		// in range" (a normal 200 with empty arrays below).
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
		log.Printf("Error fetching GitHub user for pulls/mine: %v", err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to fetch GitHub user", "details": err.Error()})
		return
	}

	days := pullsMineDefaultDays
	if d, derr := strconv.Atoi(c.Query("days")); derr == nil && d > 0 {
		days = d
	}
	if days > pullsMineMaxDays {
		days = pullsMineMaxDays
	}
	since := time.Now().AddDate(0, 0, -days).Format("2006-01-02")

	issues, serr := searchMyPulls(ctx, ghClient, login, repos, since)
	if serr != nil {
		log.Printf("Error searching GitHub pull requests for %s: %v", login, serr)
		c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to search GitHub pull requests", "details": serr.Error()})
		return
	}
	pulls := []*ghMinePull{}
	for _, issue := range issues {
		p := issueToMinePull(issue)
		if p == nil || p.State != "merged" {
			// The human doesn't want open (or closed-without-merging) PRs on
			// this list — "Your PRs" now answers "what did I actually land",
			// not "what have I opened". The `is:merged` qualifier in
			// buildMyPullsQuery already asks GitHub for this; this is the
			// belt to that suspenders (a test stub, or a future qualifier
			// GitHub doesn't honor exactly as expected, must not leak an
			// open PR through).
			continue
		}
		pulls = append(pulls, p)
	}
	sort.Slice(pulls, func(i, j int) bool { return pulls[i].updatedAtTime.After(pulls[j].updatedAtTime) })
	if len(pulls) > pullsMineMaxResults {
		pulls = pulls[:pullsMineMaxResults]
	}
	fillMergedPullDetails(ctx, ghClient, pulls)

	// writeJSONWithETag (main_etag.go), NOT a "no-store" response: this is
	// exactly the "poll every 5 min cheaply" contract the frontend relies on
	// (frontend/src/lib/api/my-pulls.ts's doc comment) — it expects the
	// BROWSER's own HTTP cache to hold the ETag and resend it as
	// If-None-Match on the next `fetch`, same as /api/rollouts already does.
	// "no-store" would have told the browser to keep nothing at all,
	// silently defeating that poll cadence — the response still can't be
	// served stale (Cache-Control is "private, no-cache": always
	// revalidated), it's just allowed to be STORED for revalidation.
	writeJSONWithETag(c, http.StatusOK, ghPullsMineResponse{User: login, Repos: repos, Pulls: pulls})
}

// ghMinePull is one entry of GET /api/github/pulls/mine's `pulls` array.
type ghMinePull struct {
	Owner          string  `json:"owner"`
	Repo           string  `json:"repo"`
	Number         int     `json:"number"`
	Title          string  `json:"title"`
	HTMLURL        string  `json:"htmlUrl"`
	State          string  `json:"state"` // "open" | "merged" | "closed"
	OpenedAt       *string `json:"openedAt"`
	MergedAt       *string `json:"mergedAt"`
	MergeCommitSHA *string `json:"mergeCommitSha"`
	HeadSHA        *string `json:"headSha"`
	Base           string  `json:"base"`
	UpdatedAt      *string `json:"updatedAt"`

	// updatedAtTime is the sort key; unexported so it never marshals.
	updatedAtTime time.Time
}

type ghPullsMineResponse struct {
	User  string        `json:"user"`
	Repos []string      `json:"repos"`
	Pulls []*ghMinePull `json:"pulls"`
}

// loginCache maps sha256(token) -> the GitHub login it belongs to, for
// pullsMineLoginCacheTTL. Keyed by a hash, never the raw token, matching
// githubcache.PartitionKey's rationale: nothing that can be replayed as a
// credential is ever kept as a map key in memory.
var (
	loginCacheMu sync.Mutex
	loginCache   = map[string]loginCacheEntry{}
)

type loginCacheEntry struct {
	login     string
	expiresAt time.Time
}

func cachedLogin(ctx context.Context, ghClient *github.Client, token string) (string, error) {
	key := tokenCacheKey(token)

	loginCacheMu.Lock()
	if e, ok := loginCache[key]; ok && time.Now().Before(e.expiresAt) {
		loginCacheMu.Unlock()
		return e.login, nil
	}
	loginCacheMu.Unlock()

	u, _, err := ghClient.Users.Get(ctx, "")
	if err != nil {
		return "", err
	}
	login := u.GetLogin()

	loginCacheMu.Lock()
	loginCache[key] = loginCacheEntry{login: login, expiresAt: time.Now().Add(pullsMineLoginCacheTTL)}
	loginCacheMu.Unlock()
	return login, nil
}

func tokenCacheKey(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// searchMyPulls issues GET /search/issues in chunks of at most
// pullsMineSearchRepoChunk repos, merging every chunk's results. Sequential,
// not parallel — these calls share the same 30/min search budget, and
// bursting them in parallel wouldn't reduce the total spent against it.
func searchMyPulls(ctx context.Context, ghClient *github.Client, login string, repos []string, since string) ([]*github.Issue, error) {
	var all []*github.Issue
	for i := 0; i < len(repos); i += pullsMineSearchRepoChunk {
		end := i + pullsMineSearchRepoChunk
		if end > len(repos) {
			end = len(repos)
		}
		q := buildMyPullsQuery(login, repos[i:end], since)
		result, _, err := ghClient.Search.Issues(ctx, q, &github.SearchOptions{
			Sort:        "updated",
			Order:       "desc",
			ListOptions: github.ListOptions{PerPage: pullsMineMaxResults},
		})
		if err != nil {
			return nil, err
		}
		if result != nil {
			all = append(all, result.Issues...)
		}
	}
	return all, nil
}

func buildMyPullsQuery(login string, repos []string, since string) string {
	var b strings.Builder
	// is:merged narrows the search itself to what the human actually wants —
	// "did my changes land" — not just "is:pr", which used to also return
	// open (and closed-without-merging) PRs.
	b.WriteString("is:pr is:merged author:")
	b.WriteString(login)
	for _, r := range repos {
		b.WriteString(" repo:")
		b.WriteString(r)
	}
	b.WriteString(" updated:>=")
	b.WriteString(since)
	return b.String()
}

// issueToMinePull maps one /search/issues result to a ghMinePull. Returns nil
// if the issue's repository can't be parsed (defensive only — every issue in
// a search scoped by `repo:` qualifiers carries a repository_url).
func issueToMinePull(issue *github.Issue) *ghMinePull {
	owner, repo, ok := parseIssueRepo(issue)
	if !ok {
		return nil
	}
	state := issue.GetState() // "open" or "closed" per the Issues API
	var mergedAt *string
	if issue.PullRequestLinks != nil && issue.PullRequestLinks.MergedAt != nil && !issue.PullRequestLinks.MergedAt.IsZero() {
		state = "merged"
		mergedAt = formatGHTimestamp(issue.PullRequestLinks.MergedAt)
	}
	return &ghMinePull{
		Owner:         owner,
		Repo:          repo,
		Number:        issue.GetNumber(),
		Title:         issue.GetTitle(),
		HTMLURL:       issue.GetHTMLURL(),
		State:         state,
		OpenedAt:      formatGHTimestamp(issue.CreatedAt),
		MergedAt:      mergedAt,
		UpdatedAt:     formatGHTimestamp(issue.UpdatedAt),
		updatedAtTime: issue.GetUpdatedAt().Time,
	}
}

func parseIssueRepo(issue *github.Issue) (owner, repo string, ok bool) {
	const marker = "/repos/"
	u := issue.GetRepositoryURL()
	i := strings.LastIndex(u, marker)
	if i < 0 {
		return "", "", false
	}
	parts := strings.SplitN(u[i+len(marker):], "/", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", false
	}
	return parts[0], parts[1], true
}

// fillMergedPullDetails backfills mergeCommitSha/headSha/base for up to
// pullsMineMaxDetailFetch merged PRs (in pulls' order — i.e. the most
// recently updated merged PRs first, since pulls is already sorted+capped),
// fetched concurrently through a bounded worker pool. A PR search result has
// no merge_commit_sha; this is the one extra fact worth paying for.
func fillMergedPullDetails(ctx context.Context, ghClient *github.Client, pulls []*ghMinePull) {
	var targets []*ghMinePull
	for _, p := range pulls {
		if p.State != "merged" {
			continue
		}
		targets = append(targets, p)
		if len(targets) >= pullsMineMaxDetailFetch {
			break
		}
	}
	if len(targets) == 0 {
		return
	}

	sem := make(chan struct{}, pullsMineDetailWorkers)
	var wg sync.WaitGroup
	for _, p := range targets {
		wg.Add(1)
		sem <- struct{}{}
		go func(p *ghMinePull) {
			defer wg.Done()
			defer func() { <-sem }()
			pr, _, err := ghClient.PullRequests.Get(ctx, p.Owner, p.Repo, p.Number)
			if err != nil {
				log.Printf("Error fetching merge detail for %s/%s#%d (pulls/mine): %v", p.Owner, p.Repo, p.Number, err)
				return
			}
			if sha := pr.GetMergeCommitSHA(); sha != "" {
				p.MergeCommitSHA = &sha
			}
			if pr.Head != nil && pr.Head.SHA != nil {
				headSha := *pr.Head.SHA
				p.HeadSHA = &headSha
			}
			if pr.Base != nil {
				p.Base = pr.Base.GetRef()
			}
		}(p)
	}
	wg.Wait()
}
