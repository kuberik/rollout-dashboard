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

func TestGitHubCommitPulls_NotInCluster404ScopeRepo(t *testing.T) {
	r := setupGitHubPullsTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/some-owner/some-repo"),
	})
	w := doGitHubPullsRequest(r, "/api/github/repos/other-owner/other-repo/commits/0123456789abcdef0123456789abcdef01234567/pulls", "ghu_test_token")
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body: %s)", w.Code, w.Body.String())
	}
	if !contains(w.Body.String(), `"scope":"repo"`) {
		t.Fatalf("body = %s, want scope=repo", w.Body.String())
	}
}

func TestGitHubCommitPulls_NoToken401(t *testing.T) {
	r := setupGitHubPullsTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/octo/repo"),
	})
	w := doGitHubPullsRequest(r, "/api/github/repos/octo/repo/commits/0123456789abcdef0123456789abcdef01234567/pulls", "")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 (body: %s)", w.Code, w.Body.String())
	}
	if !contains(w.Body.String(), `"error":"github_not_connected"`) {
		t.Fatalf("body = %s, want error=github_not_connected", w.Body.String())
	}
}

func TestGitHubCommitPulls_FullSha_Happy(t *testing.T) {
	r := setupGitHubPullsTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/octo/repo"),
	})
	const fullSha = "0123456789abcdef0123456789abcdef01234567"

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if req.URL.Path != "/repos/octo/repo/commits/"+fullSha+"/pulls" {
			t.Fatalf("unexpected path %s", req.URL.Path)
		}
		fmt.Fprint(w, `[
			{"number":5,"title":"Fix bug","html_url":"https://github.com/octo/repo/pull/5","state":"closed","merged_at":"2026-02-01T00:00:00Z","user":{"login":"alice"}},
			{"number":6,"title":"Still open","html_url":"https://github.com/octo/repo/pull/6","state":"open","user":{"login":"bob"}}
		]`)
	}))
	defer ts.Close()
	defer githubapp.SetBaseURLForTest(ts.URL + "/")()

	w := doGitHubPullsRequest(r, "/api/github/repos/octo/repo/commits/"+fullSha+"/pulls", "ghu_full_token")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
	if got := w.Header().Get("Cache-Control"); got != "private, max-age=600" {
		t.Fatalf("Cache-Control = %q, want %q (full sha is immutable)", got, "private, max-age=600")
	}
	var body []map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v (body: %s)", err, w.Body.String())
	}
	if len(body) != 2 {
		t.Fatalf("len(body) = %d, want 2", len(body))
	}
	if body[0]["state"] != "merged" || body[0]["author"] != "alice" || body[0]["number"] != float64(5) {
		t.Fatalf("body[0] = %v", body[0])
	}
	if body[0]["mergedAt"] != "2026-02-01T00:00:00Z" {
		t.Fatalf("body[0].mergedAt = %v", body[0]["mergedAt"])
	}
	if body[1]["state"] != "open" || body[1]["mergedAt"] != nil {
		t.Fatalf("body[1] = %v", body[1])
	}
}

func TestGitHubCommitPulls_ShortShaResolves(t *testing.T) {
	r := setupGitHubPullsTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/octo/repo"),
	})
	const short = "0123456"
	const full = "0123456789abcdef0123456789abcdef01234567"

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch req.URL.Path {
		case "/repos/octo/repo/commits/" + short:
			fmt.Fprintf(w, `{"sha":"%s"}`, full)
		case "/repos/octo/repo/commits/" + full + "/pulls":
			fmt.Fprint(w, `[{"number":9,"title":"t","html_url":"https://github.com/octo/repo/pull/9","state":"open","user":{"login":"eve"}}]`)
		default:
			t.Fatalf("unexpected path %s", req.URL.Path)
		}
	}))
	defer ts.Close()
	defer githubapp.SetBaseURLForTest(ts.URL + "/")()

	w := doGitHubPullsRequest(r, "/api/github/repos/octo/repo/commits/"+short+"/pulls", "ghu_short_token")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
	// The resolved sha is full-length, so the response is still treated as
	// immutable — the short input form doesn't change the underlying fact.
	if got := w.Header().Get("Cache-Control"); got != "private, max-age=600" {
		t.Fatalf("Cache-Control = %q, want %q", got, "private, max-age=600")
	}
	var body []map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(body) != 1 || body[0]["number"] != float64(9) {
		t.Fatalf("body = %v", body)
	}
}

func TestGitHubCommitPulls_ShaNotFound404ScopeSha(t *testing.T) {
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

	w := doGitHubPullsRequest(r, "/api/github/repos/octo/repo/commits/"+short+"/pulls", "ghu_missingsha_token")
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body: %s)", w.Code, w.Body.String())
	}
	if !contains(w.Body.String(), `"scope":"sha"`) {
		t.Fatalf("body = %s, want scope=sha", w.Body.String())
	}
}

func TestGitHubCommitPulls_TokenRevokedClearsCookie(t *testing.T) {
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

	w := doGitHubPullsRequest(r, "/api/github/repos/octo/repo/commits/"+fullSha+"/pulls", "ghu_revoked_token")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 (body: %s)", w.Code, w.Body.String())
	}
	found := false
	for _, c := range w.Result().Cookies() {
		if c.Name == githubTokenCookie && c.MaxAge < 0 {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected %s cookie to be cleared", githubTokenCookie)
	}
}
