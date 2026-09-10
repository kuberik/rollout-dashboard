package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
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
		switch req.URL.Path {
		case "/repos/octo/repo/commits/" + fullSha:
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
		case "/repos/octo/repo":
			fmt.Fprint(w, `{"default_branch": "main"}`)
		case "/repos/octo/repo/commits":
			// GitHub's since= is inclusive, so this list (newest-first)
			// includes the commit itself as the oldest entry — the handler
			// must exclude it and preserve the newest-first ordering for the
			// two genuinely later commits.
			fmt.Fprintf(w, `[
				{"sha": "newer2000000000000000000000000000000002"},
				{"sha": "newer1000000000000000000000000000000001"},
				{"sha": %q}
			]`, fullSha)
		default:
			t.Fatalf("unexpected path %s", req.URL.Path)
		}
	}))
	defer ts.Close()
	defer githubapp.SetBaseURLForTest(ts.URL + "/")()

	w := doGitHubPullsRequest(r, "/api/github/repos/octo/repo/commits/"+fullSha, "ghu_full_token")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
	// containedIn is mutable (grows as new commits land), so a full sha no
	// longer earns a straight max-age — it must revalidate every time.
	if got := w.Header().Get("Cache-Control"); got != "private, no-cache" {
		t.Fatalf("Cache-Control = %q, want %q (containedIn is mutable even for a full sha)", got, "private, no-cache")
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
	ci, ok := body["containedIn"].([]interface{})
	if !ok || len(ci) != 2 {
		t.Fatalf("containedIn = %v, want the two later commits (self excluded)", body["containedIn"])
	}
	if ci[0] != "newer2000000000000000000000000000000002" || ci[1] != "newer1000000000000000000000000000000001" {
		t.Fatalf("containedIn = %v, want newest-first ordering preserved", ci)
	}
	if body["containedInAll"] != false {
		t.Fatalf("containedInAll = %v, want false (well under the cap)", body["containedInAll"])
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
		switch req.URL.Path {
		case "/repos/octo/repo/commits/" + short:
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
		case "/repos/octo/repo":
			fmt.Fprint(w, `{"default_branch": "trunk"}`)
		case "/repos/octo/repo/commits":
			// Nothing landed since — the walk resolves to just the commit
			// itself, excluded, so containedIn is empty.
			fmt.Fprintf(w, `[{"sha": %q}]`, full)
		default:
			t.Fatalf("unexpected path %s", req.URL.Path)
		}
	}))
	defer ts.Close()
	defer githubapp.SetBaseURLForTest(ts.URL + "/")()

	w := doGitHubPullsRequest(r, "/api/github/repos/octo/repo/commits/"+short, "ghu_short_token")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
	// The resolved sha is full-length, so the FACTS are still immutable, but
	// containedIn is not — the short input form doesn't change that.
	if got := w.Header().Get("Cache-Control"); got != "private, no-cache" {
		t.Fatalf("Cache-Control = %q, want %q", got, "private, no-cache")
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
	if ci, ok := body["containedIn"].([]interface{}); !ok || len(ci) != 0 {
		t.Fatalf("containedIn = %v, want empty (only the commit itself was in the walk, and it is excluded)", body["containedIn"])
	}
	if body["containedInAll"] != false {
		t.Fatalf("containedInAll = %v, want false", body["containedInAll"])
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

// TestGitHubCommit_ContainedInPaginationCutAt300 mirrors
// TestGitHubPullRequest_PaginationCutAt300 (main_github_pulls_test.go): 4
// pages of 100 commits (400 available) must stop at maxContainedInCommits
// and report containedInAll=true, exactly commitsSinceMerge's own cap
// semantics reused here.
func TestGitHubCommit_ContainedInPaginationCutAt300(t *testing.T) {
	r := setupGitHubPullsTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/octo/repo"),
	})
	const fullSha = "0123456789abcdef0123456789abcdef01234567"

	pages := 0
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch req.URL.Path {
		case "/repos/octo/repo/commits/" + fullSha:
			fmt.Fprintf(w, `{
				"sha": %q,
				"html_url": "https://github.com/octo/repo/commit/%s",
				"author": {"login": "alice"},
				"commit": {
					"message": "Old commit",
					"committer": {"name": "GitHub", "date": "2026-01-01T00:00:00Z"}
				}
			}`, fullSha, fullSha)
		case "/repos/octo/repo":
			fmt.Fprint(w, `{"default_branch": "main"}`)
		case "/repos/octo/repo/commits":
			pages++
			page := 1
			if p := req.URL.Query().Get("page"); p != "" {
				page, _ = strconv.Atoi(p)
			}
			// 4 pages of 100 = 400 available commits; the handler must stop
			// at 300 (never reaching page 4 at all) and report
			// containedInAll=true.
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

	w := doGitHubPullsRequest(r, "/api/github/repos/octo/repo/commits/"+fullSha, "ghu_paginate_token")
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
	for _, s := range ci {
		if s == fullSha {
			t.Fatalf("containedIn contains the commit's own sha, want it excluded")
		}
	}
	if body["containedInAll"] != true {
		t.Fatalf("containedInAll = %v, want true (cut at cap)", body["containedInAll"])
	}
	if pages < 3 {
		t.Fatalf("expected at least 3 pages fetched, got %d", pages)
	}
}
