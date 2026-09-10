package main

import (
	"context"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/go-github/v88/github"
	"github.com/kuberik/rollout-dashboard/pkg/githubapp"
	"github.com/kuberik/rollout-dashboard/pkg/githubcache"
)

// ghCommit is the response body of GET
// /api/github/repos/:owner/:repo/commits/:sha — the single-commit lookup the
// changes page uses to print a title and a "committed N ago by @who"
// subtitle behind a BARE sha (CHANGES-2026-09-10.md item 4): a build whose
// revision landed with no PR this cluster's own change feed can attach to it,
// so there is nothing to show but the sha itself until this endpoint answers.
//
// containedIn / containedInAll answer the other half of that same question —
// "did the head move past this" as opposed to "is this built" — with exactly
// main_github_pulls.go's commitsSinceMerge semantics: the default-branch
// commits strictly AFTER this one (commit's own sha excluded), capped at
// maxContainedInCommits, with containedInAll true iff the walk was cut at
// that cap (i.e. there may be MORE commits after this one than are listed —
// still definitely "moved past", just an incomplete tally of by how much).
type ghCommit struct {
	SHA            string   `json:"sha"`
	Subject        string   `json:"subject"`
	Author         string   `json:"author"`
	CommittedAt    string   `json:"committedAt"`
	HTMLURL        string   `json:"htmlUrl"`
	ContainedIn    []string `json:"containedIn"`
	ContainedInAll bool     `json:"containedInAll"`
}

// handleGitHubCommit serves GET /api/github/repos/:owner/:repo/commits/:sha
// via GitHub's repos/{o}/{r}/commits/{sha}, one call. Unlike
// handleGitHubCommitPulls (main_github_commit_pulls.go), which needs a
// separate resolve step because `PullRequests.ListPullRequestsWithCommit`
// only accepts a full sha, `Repositories.GetCommit` itself resolves a short
// OR full sha in the same round trip — the response's own `sha` field is
// always the resolved, full-length form.
//
// Same conventions as handleGitHubCommitPulls: cluster-scoped via
// visibleGitHubSources (404 scope=repo before any GitHub call is made), the
// viewing user's own token (never the shared service-account client), a 404
// scope=sha when GitHub itself says the commit doesn't exist.
//
// Cache-Control: the commit FACTS (sha/subject/author/committedAt/htmlUrl)
// are immutable the moment the commit exists, which is what earned a full
// 40-char sha `private, max-age=600` before containedIn existed. containedIn
// is not immutable in the same way — it grows every time a new commit lands
// on the default branch, on exactly the resolved commit's own timescale, not
// this endpoint's. A stale cached response would keep reporting "not moved
// past yet" long after the head moved past it, which is the one thing this
// field exists to tell a bare-commit change page. So a full-sha response now
// gets `private, no-cache` instead: still cacheable (a conditional GET can
// still 304 off ETag/Last-Modified from the transport), but never served
// without revalidating first. Anything that didn't resolve to a full sha
// keeps `no-store`, unchanged.
func handleGitHubCommit(c *gin.Context) {
	owner := c.Param("owner")
	repo := c.Param("repo")
	sha := c.Param("sha")

	if !githubcache.IsCommitSHA(sha) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid commit sha"})
		return
	}

	k8sClient, ok := getK8sReadClient(c)
	if !ok {
		return
	}
	visible, err := visibleGitHubSources(c, k8sClient)
	if err != nil {
		log.Printf("Error checking repository visibility for %s/%s commits/%s: %v", owner, repo, sha, err)
		writeUpstreamError(c, "Failed to check repository visibility", err)
		return
	}
	if !visible[githubapp.NormalizedRepoKey(owner, repo)] {
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
	commit, _, cerr := ghClient.Repositories.GetCommit(ctx, owner, repo, sha, nil)
	if cerr != nil {
		if respondGitHubCommitLookupErrors(c, cerr, "sha") {
			return
		}
		log.Printf("Error fetching commit %s/%s@%s: %v", owner, repo, sha, cerr)
		c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to fetch commit", "details": cerr.Error()})
		return
	}

	result := commitFromRepositoryCommit(commit)

	resolvedSha := commit.GetSHA()
	if len(resolvedSha) != 40 {
		// GitHub could not resolve this to a full sha at all — no immutable
		// object to reason a containedIn walk from either.
		c.Header("Cache-Control", "private, no-store")
		c.JSON(http.StatusOK, result)
		return
	}
	c.Header("Cache-Control", "private, no-cache")

	if ts := committedAtTime(commit); !ts.IsZero() {
		defaultBranch, dberr := cachedDefaultBranch(ctx, ghClient, owner, repo)
		if dberr != nil {
			log.Printf("Error fetching default branch for %s/%s@%s containedIn: %v", owner, repo, resolvedSha, dberr)
			writeUpstreamError(c, "Failed to fetch default branch", dberr)
			return
		}
		if defaultBranch == "" {
			defaultBranch = "main"
		}
		containedIn, containedInAll, cierr := commitsAfterCommit(ctx, ghClient, owner, repo, defaultBranch, resolvedSha, ts)
		if cierr != nil {
			log.Printf("Error listing commits after %s/%s@%s: %v", owner, repo, resolvedSha, cierr)
			c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to fetch commit range from GitHub", "details": cierr.Error()})
			return
		}
		result.ContainedIn = containedIn
		result.ContainedInAll = containedInAll
	}

	c.JSON(http.StatusOK, result)
}

// commitsAfterCommit lists the shas on defaultBranch strictly AFTER sha —
// the default-branch commits whose committed date is >= committedAt (the
// same commits?sha=<default>&since=<committedAt> walk as
// commitsSinceMerge in main_github_pulls.go, sharing its pagination and
// maxContainedInCommits cap), with sha itself excluded even though GitHub's
// `since` is inclusive and so would otherwise hand it back as the walk's own
// first entry.
func commitsAfterCommit(ctx context.Context, ghClient *github.Client, owner, repo, defaultBranch, sha string, committedAt time.Time) (containedIn []string, containedInAll bool, err error) {
	shas, cutAt300, err := commitsSinceMerge(ctx, ghClient, owner, repo, defaultBranch, committedAt)
	if err != nil {
		return nil, false, err
	}
	containedIn = make([]string, 0, len(shas))
	for _, s := range shas {
		if s == sha {
			continue
		}
		containedIn = append(containedIn, s)
	}
	return containedIn, cutAt300, nil
}

// commitFromRepositoryCommit narrows a *github.RepositoryCommit down to the
// four facts the changes page's bare-sha subtitle needs.
func commitFromRepositoryCommit(commit *github.RepositoryCommit) ghCommit {
	gitCommit := commit.GetCommit()

	// The commit message's SUBJECT is its first line only — the body (if
	// any) is not this endpoint's concern, same convention as every git
	// tool's own one-line log format.
	subject := strings.TrimSpace(gitCommit.GetMessage())
	if i := strings.IndexByte(subject, '\n'); i >= 0 {
		subject = strings.TrimSpace(subject[:i])
	}

	// The linked GitHub USER — a real handle, the "@who" the frontend
	// prints — when the commit's git author email resolves to one. A bot
	// commit, or an email GitHub can't match to an account, still carries a
	// git author NAME, so that is the fallback rather than an empty string.
	author := commit.GetAuthor().GetLogin()
	if author == "" {
		author = gitCommit.GetAuthor().GetName()
	}

	// COMMITTER date, not author date: a rebased or squash-merged commit's
	// author date can be long stale while the committer date is when it
	// actually landed on the branch this build was cut from. Falls back to
	// the author date only when no committer date exists at all.
	var committedAt string
	if ts := committedAtTime(commit); !ts.IsZero() {
		committedAt = ts.Format(time.RFC3339)
	}

	return ghCommit{
		SHA:         commit.GetSHA(),
		Subject:     subject,
		Author:      author,
		CommittedAt: committedAt,
		HTMLURL:     commit.GetHTMLURL(),
		// The handler fills these in separately (a second GitHub round trip,
		// only worth making once we know this resolved to a full sha) —
		// always non-nil in the response either way.
		ContainedIn:    []string{},
		ContainedInAll: false,
	}
}

// committedAtTime is commitFromRepositoryCommit's and commitsAfterCommit's
// shared "when did this actually land" reasoning: COMMITTER date first (a
// rebased or squash-merged commit's author date can be long stale), falling
// back to the author date only when no committer date exists at all. Zero
// time means neither was present.
func committedAtTime(commit *github.RepositoryCommit) time.Time {
	gitCommit := commit.GetCommit()
	if d := gitCommit.GetCommitter().GetDate(); !d.IsZero() {
		return d.Time
	}
	if d := gitCommit.GetAuthor().GetDate(); !d.IsZero() {
		return d.Time
	}
	return time.Time{}
}
