package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kuberik/rollout-dashboard/pkg/githubapp"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

func TestGitHubCommit_NotInCluster404ScopeRepo(t *testing.T) {
	r := setupGitHubPullsTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/some-owner/some-repo"),
	})
	w := doGitHubPullsRequest(r, "/api/github/repos/other-owner/other-repo/commits/0123456789abcdef0123456789abcdef01234567", "ghu_test_token")
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body: %s)", w.Code, w.Body.String())
	}
	if !contains(w.Body.String(), `"scope":"repo"`) {
		t.Fatalf("body = %s, want scope=repo", w.Body.String())
	}
}

func TestGitHubCommit_NoToken401(t *testing.T) {
	r := setupGitHubPullsTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/octo/repo"),
	})
	w := doGitHubPullsRequest(r, "/api/github/repos/octo/repo/commits/0123456789abcdef0123456789abcdef01234567", "")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 (body: %s)", w.Code, w.Body.String())
	}
	if !contains(w.Body.String(), `"error":"github_not_connected"`) {
		t.Fatalf("body = %s, want error=github_not_connected", w.Body.String())
	}
}

func TestGitHubCommit_FullSha_Happy(t *testing.T) {
	r := setupGitHubPullsTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/octo/repo"),
	})
	const fullSha = "0123456789abcdef0123456789abcdef01234567"

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if req.URL.Path != "/repos/octo/repo/commits/"+fullSha {
			t.Fatalf("unexpected path %s", req.URL.Path)
		}
		fmt.Fprintf(w, `{
			"sha": %q,
			"html_url": "https://github.com/octo/repo/commit/%s",
			"author": {"login": "alice"},
			"commit": {
				"message": "Fix the flaky retry loop\n\nLonger body explaining why.",
				"author": {"name": "Alice Author", "date": "2026-02-01T00:00:00Z"},
				"committer": {"name": "GitHub", "date": "2026-02-02T00:00:00Z"}
			}
		}`, fullSha, fullSha)
	}))
	defer ts.Close()
	defer githubapp.SetBaseURLForTest(ts.URL + "/")()

	w := doGitHubPullsRequest(r, "/api/github/repos/octo/repo/commits/"+fullSha, "ghu_full_token")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
	if got := w.Header().Get("Cache-Control"); got != "private, max-age=600" {
		t.Fatalf("Cache-Control = %q, want %q (full sha is immutable)", got, "private, max-age=600")
	}
	var body map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v (body: %s)", err, w.Body.String())
	}
	if body["sha"] != fullSha {
		t.Fatalf("sha = %v, want %s", body["sha"], fullSha)
	}
	if body["subject"] != "Fix the flaky retry loop" {
		t.Fatalf("subject = %v, want just the first line", body["subject"])
	}
	// The linked GitHub user's login wins over the git author's plain name.
	if body["author"] != "alice" {
		t.Fatalf("author = %v, want alice", body["author"])
	}
	// COMMITTER date, not author date.
	if body["committedAt"] != "2026-02-02T00:00:00Z" {
		t.Fatalf("committedAt = %v, want the committer date", body["committedAt"])
	}
	if body["htmlUrl"] != "https://github.com/octo/repo/commit/"+fullSha {
		t.Fatalf("htmlUrl = %v", body["htmlUrl"])
	}
}

func TestGitHubCommit_ShortShaResolvesAndFallsBackToGitAuthorName(t *testing.T) {
	r := setupGitHubPullsTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/octo/repo"),
	})
	const short = "0123456"
	const full = "0123456789abcdef0123456789abcdef01234567"

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if req.URL.Path != "/repos/octo/repo/commits/"+short {
			t.Fatalf("unexpected path %s", req.URL.Path)
		}
		// No linked GitHub user (a bot commit, or an email GitHub can't
		// match) — the git author's own name is the fallback.
		fmt.Fprintf(w, `{
			"sha": %q,
			"html_url": "https://github.com/octo/repo/commit/%s",
			"commit": {
				"message": "Bump dependency",
				"author": {"name": "dependabot[bot]", "date": "2026-02-03T00:00:00Z"}
			}
		}`, full, full)
	}))
	defer ts.Close()
	defer githubapp.SetBaseURLForTest(ts.URL + "/")()

	w := doGitHubPullsRequest(r, "/api/github/repos/octo/repo/commits/"+short, "ghu_short_token")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
	// The resolved sha is full-length, so the response is still treated as
	// immutable — the short input form doesn't change the underlying fact.
	if got := w.Header().Get("Cache-Control"); got != "private, max-age=600" {
		t.Fatalf("Cache-Control = %q, want %q", got, "private, max-age=600")
	}
	var body map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if body["sha"] != full {
		t.Fatalf("sha = %v, want the resolved full sha", body["sha"])
	}
	if body["author"] != "dependabot[bot]" {
		t.Fatalf("author = %v, want the git author name fallback", body["author"])
	}
	// No committer date in this fixture — falls back to the author date.
	if body["committedAt"] != "2026-02-03T00:00:00Z" {
		t.Fatalf("committedAt = %v, want the author date fallback", body["committedAt"])
	}
}

func TestGitHubCommit_ShaNotFound404ScopeSha(t *testing.T) {
	r := setupGitHubPullsTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/octo/repo"),
	})
	const short = "deadbee"

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		fmt.Fprint(w, `{"message":"Not Found"}`)
	}))
	defer ts.Close()
	defer githubapp.SetBaseURLForTest(ts.URL + "/")()

	w := doGitHubPullsRequest(r, "/api/github/repos/octo/repo/commits/"+short, "ghu_missingsha_token")
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body: %s)", w.Code, w.Body.String())
	}
	if !contains(w.Body.String(), `"scope":"sha"`) {
		t.Fatalf("body = %s, want scope=sha", w.Body.String())
	}
}

func TestGitHubCommit_TokenRevokedClearsCookie(t *testing.T) {
	r := setupGitHubPullsTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/octo/repo"),
	})
	const fullSha = "0123456789abcdef0123456789abcdef01234567"

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		fmt.Fprint(w, `{"message":"Bad credentials"}`)
	}))
	defer ts.Close()
	defer githubapp.SetBaseURLForTest(ts.URL + "/")()

	w := doGitHubPullsRequest(r, "/api/github/repos/octo/repo/commits/"+fullSha, "ghu_revoked_token")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 (body: %s)", w.Code, w.Body.String())
	}
	found := false
	for _, ck := range w.Result().Cookies() {
		if ck.Name == githubTokenCookie && ck.MaxAge < 0 {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected %s cookie to be cleared", githubTokenCookie)
	}
}

func TestGitHubCommit_InvalidSha400(t *testing.T) {
	r := setupGitHubPullsTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/octo/repo"),
	})
	w := doGitHubPullsRequest(r, "/api/github/repos/octo/repo/commits/not-a-sha!!", "ghu_test_token")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body: %s)", w.Code, w.Body.String())
	}
}
