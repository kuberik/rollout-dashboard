package main

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/go-github/v88/github"
	"github.com/kuberik/rollout-dashboard/pkg/githubapp"
	"github.com/kuberik/rollout-dashboard/pkg/githubcache"
)

// ghCommitPull is one entry of GET
// /api/github/repos/:owner/:repo/commits/:sha/pulls' array response — the
// reverse mapping from a build sha to the PR(s) that landed it, used by the
// revisions/build page to show a PR title behind a sha.
type ghCommitPull struct {
	Number   int     `json:"number"`
	Title    string  `json:"title"`
	HTMLURL  string  `json:"htmlUrl"`
	State    string  `json:"state"` // "open" | "merged" | "closed"
	MergedAt *string `json:"mergedAt"`
	Author   string  `json:"author"`
}

// handleGitHubCommitPulls serves GET
// /api/github/repos/:owner/:repo/commits/:sha/pulls via GitHub's
// repos/{o}/{r}/commits/{sha}/pulls, one call.
//
// A full 40-char commit sha names an immutable object — the set of PRs that
// contain it can only ever grow the instant it's first merged, and never
// changes for a sha already on a branch (a sha's parents/tree/content never
// change; the ONLY way "which PRs contain this commit" changes over time is
// while the commit is brand new and its containing PR/branch hasn't
// propagated yet, which GitHub itself accounts for by simply returning fewer
// PRs at first ask). So it gets a real browser-cacheable freshness window
// (`private, max-age=600`) instead of the `no-store` every other endpoint
// here uses — same reasoning as githubcache's ImmutableTTL for sha-to-sha
// compares.
//
// A short sha is NOT immutable to look up by itself (the same short prefix
// could — vanishingly rarely — collide, and more importantly GitHub's
// short-sha endpoint is itself a lookup, not a fact), so it's resolved to a
// full sha via GET /repos/{o}/{r}/commits/{sha} first; only the resolved,
// full-length answer is treated as cacheable. A short sha GitHub can't
// resolve is a 404 scope=sha, distinguished from scope=repo (the cluster
// doesn't deploy this repo at all) so the frontend can tell "wrong sha" from
// "wrong repo".
func handleGitHubCommitPulls(c *gin.Context) {
	owner := c.Param("owner")
	repo := c.Param("repo")
	sha := c.Param("sha")

	if !githubcache.IsCommitSHA(sha) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid commit sha"})
		return
	}
	full := len(sha) == 40

	k8sClient, ok := getK8sReadClient(c)
	if !ok {
		return
	}
	visible, err := visibleGitHubSources(c, k8sClient)
	if err != nil {
		log.Printf("Error checking repository visibility for %s/%s commits/%s/pulls: %v", owner, repo, sha, err)
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
	resolvedSha := sha
	if !full {
		commit, _, cerr := ghClient.Repositories.GetCommit(ctx, owner, repo, sha, nil)
		if cerr != nil {
			if respondGitHubCommonErrors(c, cerr, "sha") {
				return
			}
			log.Printf("Error resolving short sha %s for %s/%s: %v", sha, owner, repo, cerr)
			c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to resolve commit sha", "details": cerr.Error()})
			return
		}
		if commit.GetSHA() != "" {
			resolvedSha = commit.GetSHA()
			full = len(resolvedSha) == 40
		}
	}

	prs, _, err := ghClient.PullRequests.ListPullRequestsWithCommit(ctx, owner, repo, resolvedSha, &github.ListOptions{PerPage: 100})
	if err != nil {
		if respondGitHubCommonErrors(c, err, "sha") {
			return
		}
		log.Printf("Error listing pull requests for %s/%s@%s: %v", owner, repo, resolvedSha, err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to fetch pull requests for commit", "details": err.Error()})
		return
	}

	if full {
		c.Header("Cache-Control", "private, max-age=600")
	} else {
		c.Header("Cache-Control", "private, no-store")
	}

	out := make([]ghCommitPull, 0, len(prs))
	for _, pr := range prs {
		out = append(out, commitPullFromPR(pr))
	}
	c.JSON(http.StatusOK, out)
}

func commitPullFromPR(pr *github.PullRequest) ghCommitPull {
	state := pr.GetState() // "open" or "closed"
	var mergedAt *string
	if pr.MergedAt != nil {
		state = "merged"
		mergedAt = formatGHTimestamp(pr.MergedAt)
	}
	return ghCommitPull{
		Number:   pr.GetNumber(),
		Title:    pr.GetTitle(),
		HTMLURL:  pr.GetHTMLURL(),
		State:    state,
		MergedAt: mergedAt,
		Author:   pr.GetUser().GetLogin(),
	}
}
