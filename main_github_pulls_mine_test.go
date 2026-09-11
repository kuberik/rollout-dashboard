package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/kuberik/rollout-dashboard/pkg/githubapp"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// resetLoginCacheForTest clears the process-wide login cache so tests using
// distinct tokens never see a stale entry from a previous test.
func resetLoginCacheForTest(t *testing.T) {
	t.Helper()
	loginCacheMu.Lock()
	loginCache = map[string]loginCacheEntry{}
	loginCacheMu.Unlock()
}

// TestGitHubPullsMine_NoVisibleRepos404 covers the empty-cluster-scope case:
// no rollout anywhere names a GitHub source at all, so there is nothing to
// search — the frontend (my-pulls.ts) maps ANY 404 here to "No repository on
// this cluster is linked to GitHub", distinct from "connected, zero PRs in
// range" (a normal 200 with empty arrays). This 404 fires before the token
// check, mirroring the other two endpoints' cluster-scope-first ordering.
func TestGitHubPullsMine_NoVisibleRepos404(t *testing.T) {
	resetLoginCacheForTest(t)
	r := setupGitHubPullsTest(t, nil)
	w := doGitHubPullsRequest(r, "/api/github/pulls/mine", "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body: %s)", w.Code, w.Body.String())
	}
	if !contains(w.Body.String(), `"scope":"repo"`) {
		t.Fatalf("body = %s, want scope=repo", w.Body.String())
	}
}

func TestGitHubPullsMine_NoToken401(t *testing.T) {
	resetLoginCacheForTest(t)
	r := setupGitHubPullsTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/octo/repo"),
	})
	w := doGitHubPullsRequest(r, "/api/github/pulls/mine", "")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 (body: %s)", w.Code, w.Body.String())
	}
	if !contains(w.Body.String(), `"error":"github_not_connected"`) {
		t.Fatalf("body = %s, want error=github_not_connected", w.Body.String())
	}
}

func TestGitHubPullsMine_TokenRevokedClearsCookie(t *testing.T) {
	resetLoginCacheForTest(t)
	r := setupGitHubPullsTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/octo/repo"),
	})
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		fmt.Fprint(w, `{"message":"Bad credentials"}`)
	}))
	defer ts.Close()
	defer githubapp.SetBaseURLForTest(ts.URL + "/")()

	w := doGitHubPullsRequest(r, "/api/github/pulls/mine", "ghu_revoked_token")
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

func TestGitHubPullsMine_Happy(t *testing.T) {
	resetLoginCacheForTest(t)
	r := setupGitHubPullsTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/octo/repo-a"),
		rolloutWithSource("team-b", "app-2", "https://github.com/octo/repo-b"),
	})

	var searchQuery string
	var pullsCalls atomic.Int64
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case req.URL.Path == "/user":
			fmt.Fprint(w, `{"login":"alice"}`)
		case req.URL.Path == "/search/issues":
			searchQuery = req.URL.Query().Get("q")
			fmt.Fprint(w, `{"total_count":2,"incomplete_results":false,"items":[
				{"number":10,"title":"Open one","html_url":"https://github.com/octo/repo-a/pull/10","state":"open","repository_url":"https://api.github.com/repos/octo/repo-a","created_at":"2026-09-01T00:00:00Z","updated_at":"2026-09-05T00:00:00Z"},
				{"number":20,"title":"Merged one","html_url":"https://github.com/octo/repo-b/pull/20","state":"closed","repository_url":"https://api.github.com/repos/octo/repo-b","created_at":"2026-08-01T00:00:00Z","updated_at":"2026-09-06T00:00:00Z","pull_request":{"merged_at":"2026-09-02T00:00:00Z"}}
			]}`)
		case req.URL.Path == "/repos/octo/repo-b/pulls/20":
			pullsCalls.Add(1)
			fmt.Fprint(w, `{"number":20,"title":"Merged one","state":"closed","merged_at":"2026-09-02T00:00:00Z","merge_commit_sha":"cafef00d","base":{"ref":"main"},"head":{"sha":"headsha20"},"user":{"login":"alice"}}`)
		default:
			t.Fatalf("unexpected path %s", req.URL.Path)
		}
	}))
	defer ts.Close()
	defer githubapp.SetBaseURLForTest(ts.URL + "/")()

	w := doGitHubPullsRequest(r, "/api/github/pulls/mine?days=30", "ghu_mine_token")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
	// NOT "no-store": the frontend (my-pulls.ts) relies on the browser's own
	// HTTP cache to hold the ETag and resend it as If-None-Match on its
	// 5-minute poll, same as /api/rollouts (main_etag.go's writeJSONWithETag).
	if got := w.Header().Get("Cache-Control"); got != "private, no-cache" {
		t.Fatalf("Cache-Control = %q, want %q", got, "private, no-cache")
	}
	etag := w.Header().Get("ETag")
	if etag == "" {
		t.Fatalf("expected an ETag header")
	}
	if !contains(searchQuery, "is:merged") || !contains(searchQuery, "author:alice") || !contains(searchQuery, "repo:octo/repo-a") || !contains(searchQuery, "repo:octo/repo-b") || !contains(searchQuery, "updated:>=") {
		t.Fatalf("search query = %q, missing expected qualifiers", searchQuery)
	}

	var body struct {
		User  string `json:"user"`
		Repos []string
		Pulls []map[string]interface{}
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v (body: %s)", err, w.Body.String())
	}
	if body.User != "alice" {
		t.Fatalf("user = %q, want alice", body.User)
	}
	if len(body.Repos) != 2 || body.Repos[0] != "octo/repo-a" || body.Repos[1] != "octo/repo-b" {
		t.Fatalf("repos = %v, want [octo/repo-a octo/repo-b]", body.Repos)
	}
	// The open PR (#10) is in the stub's search response (proving the
	// handler's own merged-only filter — not just the search qualifier —
	// is what keeps it out, since a real GitHub server honoring is:merged
	// would never have returned it in the first place) but must not appear
	// in the response: the human only wants to see what landed.
	if len(body.Pulls) != 1 {
		t.Fatalf("len(pulls) = %d, want 1 (open PR #10 must be filtered out)", len(body.Pulls))
	}
	if body.Pulls[0]["number"] != float64(20) {
		t.Fatalf("pulls[0].number = %v, want 20", body.Pulls[0]["number"])
	}
	if body.Pulls[0]["state"] != "merged" {
		t.Fatalf("pulls[0].state = %v, want merged", body.Pulls[0]["state"])
	}
	if body.Pulls[0]["mergeCommitSha"] != "cafef00d" {
		t.Fatalf("pulls[0].mergeCommitSha = %v, want cafef00d (backfilled via pulls/{n})", body.Pulls[0]["mergeCommitSha"])
	}
	if body.Pulls[0]["base"] != "main" {
		t.Fatalf("pulls[0].base = %v, want main", body.Pulls[0]["base"])
	}
	if got := pullsCalls.Load(); got != 1 {
		t.Fatalf("pulls/{n} detail calls = %d, want 1 (only the merged PR)", got)
	}

	// A second request carrying the ETag as If-None-Match gets a 304 with no
	// body — the browser's own conditional-GET machinery does this for free
	// on the frontend's plain `fetch`, this just proves the server side.
	req := httptest.NewRequest(http.MethodGet, "/api/github/pulls/mine?days=30", nil)
	req.AddCookie(&http.Cookie{Name: githubTokenCookie, Value: "ghu_mine_token"})
	req.Header.Set("If-None-Match", etag)
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req)
	if w2.Code != http.StatusNotModified {
		t.Fatalf("second request status = %d, want 304 (body: %s)", w2.Code, w2.Body.String())
	}
	if w2.Body.Len() != 0 {
		t.Fatalf("304 response body = %q, want empty", w2.Body.String())
	}
}

func TestGitHubPullsMine_SearchBatchedPastTwentyRepos(t *testing.T) {
	resetLoginCacheForTest(t)
	// 25 distinct source repos -> the visible set exceeds
	// pullsMineSearchRepoChunk (20), so the handler must issue 2 search
	// calls, not 1, and merge+sort+cap the combined results.
	var objs []client.Object
	for i := 0; i < 25; i++ {
		objs = append(objs, rolloutWithSource("team-a", fmt.Sprintf("app-%d", i), fmt.Sprintf("https://github.com/octo/repo-%02d", i)))
	}
	r := setupGitHubPullsTest(t, objs)

	var searchCalls atomic.Int64
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case req.URL.Path == "/user":
			fmt.Fprint(w, `{"login":"alice"}`)
		case req.URL.Path == "/search/issues":
			n := searchCalls.Add(1)
			// Each call returns 40 distinct, all-MERGED issues (80 total
			// across both chunks) — merged-only is now the whole point of
			// this endpoint, so an all-open fixture would exercise nothing
			// here (everything would be filtered out). This still exercises
			// the cross-chunk merge, sort, and 50-cap; the generic
			// pulls/{n} handler below absorbs whatever detail-fetch calls
			// the merged results trigger (bounded by pullsMineMaxDetailFetch
			// regardless of how many of the 80 are merged).
			var items []string
			base := int(n) * 1000
			for i := 0; i < 40; i++ {
				num := base + i
				updated := fmt.Sprintf("2026-09-%02dT00:00:00Z", 1+(i%27))
				items = append(items, fmt.Sprintf(`{"number":%d,"title":"pr %d","html_url":"https://github.com/octo/repo-00/pull/%d","state":"closed","repository_url":"https://api.github.com/repos/octo/repo-00","created_at":"2026-08-01T00:00:00Z","updated_at":"%s","pull_request":{"merged_at":"%s"}}`, num, num, num, updated, updated))
			}
			fmt.Fprintf(w, `{"total_count":%d,"items":[%s]}`, len(items), joinJSON(items))
		case strings.HasPrefix(req.URL.Path, "/repos/octo/repo-00/pulls/"):
			fmt.Fprint(w, `{"state":"closed","merged_at":"2026-09-01T00:00:00Z","merge_commit_sha":"deadbeef","base":{"ref":"main"},"head":{"sha":"headsha"},"user":{"login":"alice"}}`)
		default:
			t.Fatalf("unexpected path %s", req.URL.Path)
		}
	}))
	defer ts.Close()
	defer githubapp.SetBaseURLForTest(ts.URL + "/")()

	w := doGitHubPullsRequest(r, "/api/github/pulls/mine", "ghu_batch_token")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
	if got := searchCalls.Load(); got != 2 {
		t.Fatalf("search calls = %d, want 2 (25 repos, chunk size 20)", got)
	}
	var body struct {
		Pulls []map[string]interface{}
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(body.Pulls) != pullsMineMaxResults {
		t.Fatalf("len(pulls) = %d, want %d (capped)", len(body.Pulls), pullsMineMaxResults)
	}
}

func TestGitHubPullsMine_MergedDetailFetchCappedAtTwenty(t *testing.T) {
	resetLoginCacheForTest(t)
	r := setupGitHubPullsTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/octo/repo"),
	})

	var detailCalls atomic.Int64
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case req.URL.Path == "/user":
			fmt.Fprint(w, `{"login":"alice"}`)
		case req.URL.Path == "/search/issues":
			// 30 merged PRs, all in one search page (per_page=50), each with
			// a distinct updated_at so sort order is deterministic — only
			// the first pullsMineMaxDetailFetch (20) may get a pulls/{n}
			// detail call.
			var items []string
			for i := 0; i < 30; i++ {
				num := 100 + i
				updated := fmt.Sprintf("2026-09-%02dT00:00:00Z", 30-i) // descending: #100 is most recently updated
				items = append(items, fmt.Sprintf(`{"number":%d,"title":"pr %d","html_url":"https://github.com/octo/repo/pull/%d","state":"closed","repository_url":"https://api.github.com/repos/octo/repo","created_at":"2026-08-01T00:00:00Z","updated_at":"%s","pull_request":{"merged_at":"2026-08-15T00:00:00Z"}}`, num, num, num, updated))
			}
			fmt.Fprintf(w, `{"total_count":30,"items":[%s]}`, joinJSON(items))
		case len(req.URL.Path) > len("/repos/octo/repo/pulls/") && req.URL.Path[:len("/repos/octo/repo/pulls/")] == "/repos/octo/repo/pulls/":
			detailCalls.Add(1)
			fmt.Fprint(w, `{"number":1,"state":"closed","merged_at":"2026-08-15T00:00:00Z","merge_commit_sha":"deadbeef","base":{"ref":"main"},"head":{"sha":"headsha"},"user":{"login":"alice"}}`)
		default:
			t.Fatalf("unexpected path %s", req.URL.Path)
		}
	}))
	defer ts.Close()
	defer githubapp.SetBaseURLForTest(ts.URL + "/")()

	w := doGitHubPullsRequest(r, "/api/github/pulls/mine", "ghu_cap_token")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
	if got := detailCalls.Load(); got != pullsMineMaxDetailFetch {
		t.Fatalf("detail calls = %d, want %d (capped)", got, pullsMineMaxDetailFetch)
	}

	var body struct {
		Pulls []map[string]interface{}
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(body.Pulls) != 30 {
		t.Fatalf("len(pulls) = %d, want 30", len(body.Pulls))
	}
	filled, unfilled := 0, 0
	for _, p := range body.Pulls {
		if p["mergeCommitSha"] != nil {
			filled++
		} else {
			unfilled++
		}
	}
	if filled != pullsMineMaxDetailFetch {
		t.Fatalf("filled = %d, want %d", filled, pullsMineMaxDetailFetch)
	}
	if unfilled != 30-pullsMineMaxDetailFetch {
		t.Fatalf("unfilled = %d, want %d", unfilled, 30-pullsMineMaxDetailFetch)
	}
}

// joinJSON joins pre-encoded JSON object strings with commas for building a
// items array by hand in tests above.
func joinJSON(items []string) string {
	out := ""
	for i, it := range items {
		if i > 0 {
			out += ","
		}
		out += it
	}
	return out
}
