package main

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/go-github/v88/github"
)

// formatGHTimestamp renders a *github.Timestamp as RFC3339, or nil when the
// field is absent — the shape every nullable GitHub-sourced time field in
// these responses uses (mirrors handleGitHubPullRequest's existing
// mergedAt/openedAt handling in main_github_pulls.go).
func formatGHTimestamp(t *github.Timestamp) *string {
	if t == nil || t.IsZero() {
		return nil
	}
	s := t.Format(time.RFC3339)
	return &s
}

// isGitHubUnauthorized reports whether err is GitHub answering 401 — a
// revoked/expired user token, distinct from a 404/403 "you can't see this".
func isGitHubUnauthorized(err error) bool {
	var ghErr *github.ErrorResponse
	return errors.As(err, &ghErr) && ghErr.Response != nil && ghErr.Response.StatusCode == http.StatusUnauthorized
}

// respondGitHubCommonErrors is the shared upstream-error translation for the
// PR-view GitHub endpoints (main_github_pulls_mine.go,
// main_github_commit_pulls.go): a 404/403 from GitHub becomes a 404 scoped to
// notFoundScope (never distinguished further — "doesn't exist" and "you
// can't see it" must answer identically so this never confirms a private
// repo's existence), and a 401 drops the gh_token cookie so the frontend
// reconnects, same as handleGitHubPullRequest. The cluster-scope 404
// (scope=repo, decided from this cluster's own visible-source set before any
// GitHub call is made) is NOT this function's concern — callers check that
// first and never reach here for it.
//
// Returns true if it wrote a response; false means the caller should fall
// through to its own generic upstream-error handling.
func respondGitHubCommonErrors(c *gin.Context, err error, notFoundScope string) bool {
	return respondGitHubUpstreamErrors(c, err, notFoundScope, false)
}

// respondGitHubCommitLookupErrors is respondGitHubCommonErrors plus one case
// unique to looking a commit up by sha: GitHub's repos/{o}/{r}/commits/{sha}
// (and .../commits/{sha}/pulls) answer a sha it cannot resolve — a short sha
// with no match, most commonly — with 422 "No commit found for SHA", not
// 404. Only the two commit-lookup endpoints (main_github_commit.go,
// main_github_commit_pulls.go) call this instead of
// respondGitHubCommonErrors: a 422 from any OTHER GitHub endpoint means
// "your request was malformed", which must stay a real upstream failure
// (502), not get reinterpreted as a 404.
func respondGitHubCommitLookupErrors(c *gin.Context, err error, notFoundScope string) bool {
	return respondGitHubUpstreamErrors(c, err, notFoundScope, true)
}

func respondGitHubUpstreamErrors(c *gin.Context, err error, notFoundScope string, treat422AsNotFound bool) bool {
	var ghErr *github.ErrorResponse
	if errors.As(err, &ghErr) && ghErr.Response != nil {
		switch ghErr.Response.StatusCode {
		case http.StatusNotFound, http.StatusForbidden:
			c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "scope": notFoundScope})
			return true
		case http.StatusUnprocessableEntity:
			if treat422AsNotFound {
				c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "scope": notFoundScope})
				return true
			}
		case http.StatusUnauthorized:
			c.SetCookie(githubTokenCookie, "", -1, "/", "", true, true)
			c.JSON(http.StatusUnauthorized, gin.H{"error": "github_not_connected"})
			return true
		}
	}
	return false
}
