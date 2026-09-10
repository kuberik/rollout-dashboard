package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	rolloutv1alpha1 "github.com/kuberik/rollout-controller/api/v1alpha1"

	"github.com/gin-gonic/gin"
	"github.com/kuberik/rollout-dashboard/pkg/githubapp"
	"github.com/kuberik/rollout-dashboard/pkg/kubernetes"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// rolloutWithSource builds a rollout whose status.source is set, the only
// signal handleGitHubPullRequest's cluster-scope check has for "does some
// visible rollout deploy this repo".
func rolloutWithSource(namespace, name, source string) *rolloutv1alpha1.Rollout {
	r := rolloutObj(namespace, name)
	r.Status.Source = &source
	return r
}

// setupGitHubPullsTest wires a fake Kubernetes read client (seeded with objs)
// and points every githubapp.UserClient at the given stub GitHub server for
// the duration of the test.
func setupGitHubPullsTest(t *testing.T, objs []client.Object) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)

	fakeClient, err := kubernetes.NewTestClient(objs...)
	if err != nil {
		t.Fatalf("NewTestClient: %v", err)
	}
	t.Cleanup(kubernetes.SetReadClientForTest(fakeClient))

	return setupRouter()
}

func doGitHubPullsRequest(r *gin.Engine, path, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	if token != "" {
		req.AddCookie(&http.Cookie{Name: githubTokenCookie, Value: token})
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestGitHubPullRequest_NotInCluster404(t *testing.T) {
	r := setupGitHubPullsTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/some-owner/some-repo"),
	})
	// No stub server needed: the cluster-scope check runs before any GitHub call.
	w := doGitHubPullsRequest(r, "/api/github/pulls/other-owner/other-repo/1", "ghu_test_token")
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body: %s)", w.Code, w.Body.String())
	}
	if !contains(w.Body.String(), `"error":"not_found"`) {
		t.Fatalf("body = %s, want error=not_found", w.Body.String())
	}
}

func TestGitHubPullRequest_NoToken401(t *testing.T) {
	r := setupGitHubPullsTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/octo/repo"),
	})
	w := doGitHubPullsRequest(r, "/api/github/pulls/octo/repo/1", "")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 (body: %s)", w.Code, w.Body.String())
	}
	if !contains(w.Body.String(), `"error":"github_not_connected"`) {
		t.Fatalf("body = %s, want error=github_not_connected", w.Body.String())
	}
}

func TestGitHubPullRequest_Open(t *testing.T) {
	r := setupGitHubPullsTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/octo/repo"),
	})

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path != "/repos/octo/repo/pulls/42" {
			t.Fatalf("unexpected path %s", req.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"number":42,"title":"Add feature","html_url":"https://github.com/octo/repo/pull/42","state":"open","user":{"login":"alice"}}`)
	}))
	defer ts.Close()
	defer githubapp.SetBaseURLForTest(ts.URL + "/")()

	w := doGitHubPullsRequest(r, "/api/github/pulls/octo/repo/42", "ghu_open_token")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
	var body map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v (body: %s)", err, w.Body.String())
	}
	if body["state"] != "open" {
		t.Fatalf("state = %v, want open", body["state"])
	}
	if body["author"] != "alice" {
		t.Fatalf("author = %v, want alice", body["author"])
	}
	if body["mergedAt"] != nil {
		t.Fatalf("mergedAt = %v, want nil", body["mergedAt"])
	}
	if ci, ok := body["containedIn"].([]interface{}); !ok || len(ci) != 0 {
		t.Fatalf("containedIn = %v, want empty list", body["containedIn"])
	}
	if body["containedInAll"] != false {
		t.Fatalf("containedInAll = %v, want false", body["containedInAll"])
	}
	if got := w.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("Cache-Control = %q, want %q", got, "private, no-store")
	}
}

func TestGitHubPullRequest_Closed(t *testing.T) {
	r := setupGitHubPullsTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/octo/repo"),
	})

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"number":7,"title":"Abandoned","html_url":"https://github.com/octo/repo/pull/7","state":"closed","user":{"login":"bob"}}`)
	}))
	defer ts.Close()
	defer githubapp.SetBaseURLForTest(ts.URL + "/")()

	w := doGitHubPullsRequest(r, "/api/github/pulls/octo/repo/7", "ghu_closed_token")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
	var body map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if body["state"] != "closed" {
		t.Fatalf("state = %v, want closed", body["state"])
	}
}

func TestGitHubPullRequest_MergedContainsCommits(t *testing.T) {
	r := setupGitHubPullsTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/octo/repo"),
	})

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case req.URL.Path == "/repos/octo/repo/pulls/99":
			fmt.Fprint(w, `{
				"number":99,"title":"Ship it","html_url":"https://github.com/octo/repo/pull/99",
				"state":"closed","merged_at":"2026-01-01T00:00:00Z","merge_commit_sha":"deadbeef01",
				"base":{"ref":"main"},"user":{"login":"carol"}
			}`)
		case req.URL.Path == "/repos/octo/repo/commits":
			if got := req.URL.Query().Get("sha"); got != "main" {
				t.Fatalf("sha query = %q, want main", got)
			}
			if got := req.URL.Query().Get("since"); got == "" {
				t.Fatalf("since query missing")
			}
			fmt.Fprint(w, `[{"sha":"deadbeef01"},{"sha":"cafebabe02"}]`)
		default:
			t.Fatalf("unexpected path %s", req.URL.Path)
		}
	}))
	defer ts.Close()
	defer githubapp.SetBaseURLForTest(ts.URL + "/")()

	w := doGitHubPullsRequest(r, "/api/github/pulls/octo/repo/99", "ghu_merged_token")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
	var body map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if body["state"] != "merged" {
		t.Fatalf("state = %v, want merged", body["state"])
	}
	if body["mergeCommitSha"] != "deadbeef01" {
		t.Fatalf("mergeCommitSha = %v, want deadbeef01", body["mergeCommitSha"])
	}
	if body["base"] != "main" {
		t.Fatalf("base = %v, want main", body["base"])
	}
	ci, ok := body["containedIn"].([]interface{})
	if !ok || len(ci) != 2 {
		t.Fatalf("containedIn = %v, want 2 shas", body["containedIn"])
	}
	if body["containedInAll"] != false {
		t.Fatalf("containedInAll = %v, want false", body["containedInAll"])
	}
}

func TestGitHubPullRequest_PaginationCutAt300(t *testing.T) {
	r := setupGitHubPullsTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/octo/repo"),
	})

	pages := 0
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch req.URL.Path {
		case "/repos/octo/repo/pulls/5":
			fmt.Fprint(w, `{
				"number":5,"title":"Big PR","html_url":"https://github.com/octo/repo/pull/5",
				"state":"closed","merged_at":"2026-01-01T00:00:00Z","merge_commit_sha":"sha-p1-000",
				"base":{"ref":"main"},"user":{"login":"dave"}
			}`)
		case "/repos/octo/repo/commits":
			pages++
			page := 1
			if p := req.URL.Query().Get("page"); p != "" {
				page, _ = strconv.Atoi(p)
			}
			// 4 pages of 100 = 400 available commits; the handler must stop
			// at 300 and report containedInAll=true.
			commits := make([]map[string]string, 0, 100)
			for i := 0; i < 100; i++ {
				commits = append(commits, map[string]string{"sha": fmt.Sprintf("sha-p%d-%03d", page, i)})
			}
			if page < 4 {
				w.Header().Set("Link", fmt.Sprintf(`<http://%s%s?page=%d>; rel="next"`, req.Host, req.URL.Path, page+1))
			}
			b, _ := json.Marshal(commits)
			w.Write(b)
		default:
			t.Fatalf("unexpected path %s", req.URL.Path)
		}
	}))
	defer ts.Close()
	defer githubapp.SetBaseURLForTest(ts.URL + "/")()

	w := doGitHubPullsRequest(r, "/api/github/pulls/octo/repo/5", "ghu_paginate_token")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
	var body map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	ci, ok := body["containedIn"].([]interface{})
	if !ok || len(ci) != 300 {
		t.Fatalf("containedIn length = %v, want 300", body["containedIn"])
	}
	if body["containedInAll"] != true {
		t.Fatalf("containedInAll = %v, want true (cut at cap)", body["containedInAll"])
	}
	if pages < 3 {
		t.Fatalf("expected at least 3 pages fetched, got %d", pages)
	}
}

func TestGitHubPullRequest_TokenRevokedClearsCookie(t *testing.T) {
	r := setupGitHubPullsTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/octo/repo"),
	})

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		fmt.Fprint(w, `{"message":"Bad credentials"}`)
	}))
	defer ts.Close()
	defer githubapp.SetBaseURLForTest(ts.URL + "/")()

	w := doGitHubPullsRequest(r, "/api/github/pulls/octo/repo/1", "ghu_revoked_token")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 (body: %s)", w.Code, w.Body.String())
	}
	if !contains(w.Body.String(), `"error":"github_not_connected"`) {
		t.Fatalf("body = %s, want error=github_not_connected", w.Body.String())
	}
	found := false
	for _, c := range w.Result().Cookies() {
		if c.Name == githubTokenCookie && c.MaxAge < 0 {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected %s cookie to be cleared, got %v", githubTokenCookie, w.Result().Cookies())
	}
}

func TestGitHubPullRequest_DottedRepoNameNotTruncated(t *testing.T) {
	// Regression guard for the ParseRepoURL fix: a rollout sourced from a
	// dotted repo name must still be found by the cluster-scope check.
	r := setupGitHubPullsTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/octo/foo.js"),
	})

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path != "/repos/octo/foo.js/pulls/3" {
			t.Fatalf("unexpected path %s (dotted repo name was mis-scoped)", req.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"number":3,"title":"t","html_url":"https://github.com/octo/foo.js/pull/3","state":"open","user":{"login":"eve"}}`)
	}))
	defer ts.Close()
	defer githubapp.SetBaseURLForTest(ts.URL + "/")()

	w := doGitHubPullsRequest(r, "/api/github/pulls/octo/foo.js/3", "ghu_dotted_token")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
}
