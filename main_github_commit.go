package main

import (
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
type ghCommit struct {
	SHA         string `json:"sha"`
	Subject     string `json:"subject"`
	Author      string `json:"author"`
	CommittedAt string `json:"committedAt"`
	HTMLURL     string `json:"htmlUrl"`
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
// scope=sha when GitHub itself says the commit doesn't exist, and the same
// immutable-object cache reasoning — a commit is immutable the moment it
// exists, so a request that resolved to a full 40-char sha gets `private,
// max-age=600`; anything else (GitHub could not resolve it to a full sha)
// gets `no-store`.
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
		if respondGitHubCommonErrors(c, cerr, "sha") {
			return
		}
		log.Printf("Error fetching commit %s/%s@%s: %v", owner, repo, sha, cerr)
		c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to fetch commit", "details": cerr.Error()})
		return
	}

	if resolvedSha := commit.GetSHA(); len(resolvedSha) == 40 {
		c.Header("Cache-Control", "private, max-age=600")
	} else {
		c.Header("Cache-Control", "private, no-store")
	}

	c.JSON(http.StatusOK, commitFromRepositoryCommit(commit))
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
	if d := gitCommit.GetCommitter().GetDate(); !d.IsZero() {
		committedAt = d.Format(time.RFC3339)
	} else if d := gitCommit.GetAuthor().GetDate(); !d.IsZero() {
		committedAt = d.Format(time.RFC3339)
	}

	return ghCommit{
		SHA:         commit.GetSHA(),
		Subject:     subject,
		Author:      author,
		CommittedAt: committedAt,
		HTMLURL:     commit.GetHTMLURL(),
	}
}
