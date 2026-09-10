package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/go-github/v88/github"
	"github.com/kuberik/rollout-dashboard/pkg/githubapp"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// resetDefaultBranchCacheForTest clears the process-wide default-branch
// cache so tests reusing a repo name (but a fresh stub server) never see a
// stale/cached hit from a previous test, mirroring resetLoginCacheForTest
// (main_github_pulls_mine_test.go).
func resetDefaultBranchCacheForTest(t *testing.T) {
	t.Helper()
	defaultBranchCacheMu.Lock()
	defaultBranchCache = map[string]defaultBranchCacheEntry{}
	defaultBranchCacheMu.Unlock()
}

// setupGitHubChangesTest wires the fake Kubernetes client and clears both
// process-wide caches (login, default-branch) this handler uses, so tests
// never leak state into one another.
func setupGitHubChangesTest(t *testing.T, objs []client.Object) *gin.Engine {
	t.Helper()
	resetLoginCacheForTest(t)
	resetDefaultBranchCacheForTest(t)
	return setupGitHubPullsTest(t, objs)
}

func TestGitHubChanges_NoVisibleRepos404(t *testing.T) {
	r := setupGitHubChangesTest(t, nil)
	w := doGitHubPullsRequest(r, "/api/github/changes", "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body: %s)", w.Code, w.Body.String())
	}
	if !contains(w.Body.String(), `"scope":"repo"`) {
		t.Fatalf("body = %s, want scope=repo", w.Body.String())
	}
}

func TestGitHubChanges_NoToken401(t *testing.T) {
	r := setupGitHubChangesTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/octo/repo"),
	})
	w := doGitHubPullsRequest(r, "/api/github/changes", "")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 (body: %s)", w.Code, w.Body.String())
	}
	if !contains(w.Body.String(), `"error":"github_not_connected"`) {
		t.Fatalf("body = %s, want error=github_not_connected", w.Body.String())
	}
}

func TestGitHubChanges_RepoParamNotInCluster404(t *testing.T) {
	r := setupGitHubChangesTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/octo/repo"),
	})
	// No stub server needed: the cluster-scope check runs before any GitHub call.
	w := doGitHubPullsRequest(r, "/api/github/changes?repo=other-owner/other-repo", "ghu_test_token")
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body: %s)", w.Code, w.Body.String())
	}
	if !contains(w.Body.String(), `"scope":"repo"`) {
		t.Fatalf("body = %s, want scope=repo", w.Body.String())
	}
}

// changesFixtureServer builds the stub GitHub server shared by the
// classification/ordering/cap tests below: one repo ("octo/repo") whose
// default branch is "main", four merged PRs (of every merge style this
// handler distinguishes), and a hand-ordered commit history exercising every
// classifyChanges rule.
//
// Commit history, newest (index 0) to oldest, as returned by
// GET .../commits (mirrors real GitHub's most-recent-first order):
//
//	0  mergesha1   (2 parents) == PR #1's merge_commit_sha -> PR #1 (merge commit)
//	1  baresha1    (1 parent)  "Add readme"                -> bare commit
//	2  realsha2    (1 parent)  "Fix widget bug (#2)"       -> PR #2 (squash: "(#2)" suffix match; PR #2's own reported merge_commit_sha, "phantomsha2", never appears in this history at all — the squash-message rule is the ONLY way to attribute it)
//	3  mergedanon  (2 parents) matches no PR                -> skipped entirely (untracked merge commit)
//	4  baresha2    (1 parent)  "Update docs"               -> bare commit
//	5  mergesha3   (2 parents) == PR #3's merge_commit_sha -> PR #3 (merge commit)
//
// PR #4's reported merge_commit_sha ("phantomsha4") also never appears in
// this history — it stays a "pr" change with containedIn == [].
func changesFixtureServer(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch req.URL.Path {
		case "/user":
			fmt.Fprint(w, `{"login":"alice"}`)
		case "/repos/octo/repo":
			fmt.Fprint(w, `{"default_branch":"main"}`)
		case "/repos/octo/repo/pulls":
			fmt.Fprint(w, `[
				{"number":1,"title":"Merge feature X","html_url":"https://github.com/octo/repo/pull/1","state":"closed","updated_at":"2026-09-08T00:00:00Z","merged_at":"2026-09-08T00:00:00Z","merge_commit_sha":"mergesha1","base":{"ref":"main"},"head":{"sha":"headsha1"},"user":{"login":"alice"}},
				{"number":2,"title":"Bugfix for widget","html_url":"https://github.com/octo/repo/pull/2","state":"closed","updated_at":"2026-09-07T00:00:00Z","merged_at":"2026-09-07T00:00:00Z","merge_commit_sha":"phantomsha2","base":{"ref":"main"},"head":{"sha":"headsha2"},"user":{"login":"bob"}},
				{"number":3,"title":"Merge pull request #3 from feature-branch","html_url":"https://github.com/octo/repo/pull/3","state":"closed","updated_at":"2026-09-05T00:00:00Z","merged_at":"2026-09-05T00:00:00Z","merge_commit_sha":"mergesha3","base":{"ref":"main"},"head":{"sha":"headsha3"},"user":{"login":"carol"}},
				{"number":4,"title":"Unmatched PR","html_url":"https://github.com/octo/repo/pull/4","state":"closed","updated_at":"2026-09-06T00:00:00Z","merged_at":"2026-09-06T00:00:00Z","merge_commit_sha":"phantomsha4","base":{"ref":"main"},"head":{"sha":"headsha4"},"user":{"login":"dave"}}
			]`)
		case "/repos/octo/repo/commits":
			fmt.Fprint(w, `[
				{"sha":"mergesha1","html_url":"https://github.com/octo/repo/commit/mergesha1","parents":[{"sha":"p1a"},{"sha":"p1b"}],"commit":{"message":"Merge pull request #1","committer":{"date":"2026-09-08T00:00:00Z"}}},
				{"sha":"baresha1","html_url":"https://github.com/octo/repo/commit/baresha1","parents":[{"sha":"p1"}],"commit":{"message":"Add readme","committer":{"date":"2026-09-07T12:00:00Z"},"author":{"name":"Eve","date":"2026-09-07T12:00:00Z"}}},
				{"sha":"realsha2","html_url":"https://github.com/octo/repo/commit/realsha2","parents":[{"sha":"p2"}],"commit":{"message":"Fix widget bug (#2)","committer":{"date":"2026-09-07T00:00:00Z"}},"author":{"login":"bob"}},
				{"sha":"mergedanon","html_url":"https://github.com/octo/repo/commit/mergedanon","parents":[{"sha":"pa"},{"sha":"pb"}],"commit":{"message":"Merge branch 'untracked'","committer":{"date":"2026-09-06T12:00:00Z"}}},
				{"sha":"baresha2","html_url":"https://github.com/octo/repo/commit/baresha2","parents":[{"sha":"p3"}],"commit":{"message":"Update docs","committer":{"date":"2026-09-06T00:00:00Z"},"author":{"name":"Frank","date":"2026-09-06T00:00:00Z"}}},
				{"sha":"mergesha3","html_url":"https://github.com/octo/repo/commit/mergesha3","parents":[{"sha":"p4a"},{"sha":"p4b"}],"commit":{"message":"Merge pull request #3","committer":{"date":"2026-09-05T00:00:00Z"}}}
			]`)
		default:
			t.Fatalf("unexpected path %s", req.URL.Path)
		}
	}))
}

// findChange locates the change in body.Changes matching pred, or fails.
func findChange(t *testing.T, changes []map[string]interface{}, pred func(map[string]interface{}) bool) map[string]interface{} {
	t.Helper()
	for _, ch := range changes {
		if pred(ch) {
			return ch
		}
	}
	t.Fatalf("no matching change found in %v", changes)
	return nil
}

func shaStrings(t *testing.T, v interface{}) []string {
	t.Helper()
	raw, ok := v.([]interface{})
	if !ok {
		t.Fatalf("containedIn = %v (%T), want []interface{}", v, v)
	}
	out := make([]string, len(raw))
	for i, x := range raw {
		out[i], _ = x.(string)
	}
	return out
}

func TestGitHubChanges_Classification(t *testing.T) {
	r := setupGitHubChangesTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/octo/repo"),
	})
	ts := changesFixtureServer(t)
	defer ts.Close()
	defer githubapp.SetBaseURLForTest(ts.URL + "/")()

	w := doGitHubPullsRequest(r, "/api/github/changes?days=3650", "ghu_classify_token")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}

	var body struct {
		User    string
		Repos   []string
		Since   string
		Changes []map[string]interface{}
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v (body: %s)", err, w.Body.String())
	}
	if body.User != "alice" {
		t.Fatalf("user = %q, want alice", body.User)
	}
	if len(body.Repos) != 1 || body.Repos[0] != "octo/repo" {
		t.Fatalf("repos = %v, want [octo/repo]", body.Repos)
	}

	// mergedanon (untracked 2-parent merge commit) must not appear as its
	// own change; every other commit/PR must.
	if len(body.Changes) != 6 {
		t.Fatalf("len(changes) = %d, want 6 (got %v)", len(body.Changes), body.Changes)
	}
	for _, ch := range body.Changes {
		if ch["mergeCommitSha"] == "mergedanon" {
			t.Fatalf("untracked merge commit mergedanon leaked into changes: %v", ch)
		}
	}

	byNumber := func(n float64) func(map[string]interface{}) bool {
		return func(ch map[string]interface{}) bool { return ch["number"] == n }
	}
	byTitle := func(title string) func(map[string]interface{}) bool {
		return func(ch map[string]interface{}) bool { return ch["title"] == title }
	}

	// PR #1: a real 2-parent merge commit, matched by merge_commit_sha
	// equality (classifyChanges rule 1) even though it has 2 parents (rule
	// 2, "skip merge commits", must not shadow rule 1).
	pr1 := findChange(t, body.Changes, byNumber(1))
	if pr1["kind"] != "pr" {
		t.Fatalf("pr1.kind = %v, want pr", pr1["kind"])
	}
	if pr1["mergeCommitSha"] != "mergesha1" {
		t.Fatalf("pr1.mergeCommitSha = %v, want mergesha1", pr1["mergeCommitSha"])
	}
	if pr1["author"] != "alice" {
		t.Fatalf("pr1.author = %v, want alice", pr1["author"])
	}
	if got := shaStrings(t, pr1["containedIn"]); len(got) != 0 {
		t.Fatalf("pr1.containedIn = %v, want [] (nothing newer)", got)
	}
	if pr1["containedInAll"] != false {
		t.Fatalf("pr1.containedInAll = %v, want false (list not cut)", pr1["containedInAll"])
	}

	// PR #2: squash — its own reported merge_commit_sha ("phantomsha2") is
	// NOT in the commit history at all, so only the "(#2)" suffix match
	// (rule 3) can find it.
	pr2 := findChange(t, body.Changes, byNumber(2))
	if pr2["kind"] != "pr" {
		t.Fatalf("pr2.kind = %v, want pr", pr2["kind"])
	}
	if pr2["author"] != "bob" {
		t.Fatalf("pr2.author = %v, want bob", pr2["author"])
	}
	if got := shaStrings(t, pr2["containedIn"]); len(got) != 2 || got[0] != "mergesha1" || got[1] != "baresha1" {
		t.Fatalf("pr2.containedIn = %v, want [mergesha1 baresha1]", got)
	}

	// PR #3: another real merge commit, further back in history.
	pr3 := findChange(t, body.Changes, byNumber(3))
	if pr3["kind"] != "pr" {
		t.Fatalf("pr3.kind = %v, want pr", pr3["kind"])
	}
	wantPr3Contained := []string{"mergesha1", "baresha1", "realsha2", "mergedanon", "baresha2"}
	if got := shaStrings(t, pr3["containedIn"]); fmt.Sprint(got) != fmt.Sprint(wantPr3Contained) {
		t.Fatalf("pr3.containedIn = %v, want %v (includes the untracked merge commit's own sha, which still landed on the branch even though it isn't its own change entry)", got, wantPr3Contained)
	}

	// PR #4: merged, but its reported merge_commit_sha never appears in the
	// fetched commit history (simulating e.g. a base other than default, or
	// a commit older than the fetch window) and no commit message matches
	// it either — containedIn must degrade to empty, not error.
	pr4 := findChange(t, body.Changes, byNumber(4))
	if pr4["kind"] != "pr" {
		t.Fatalf("pr4.kind = %v, want pr", pr4["kind"])
	}
	if got := shaStrings(t, pr4["containedIn"]); len(got) != 0 {
		t.Fatalf("pr4.containedIn = %v, want [] (merge commit not found in history)", got)
	}

	// Bare commits: no PR at all.
	readme := findChange(t, body.Changes, byTitle("Add readme"))
	if readme["kind"] != "commit" {
		t.Fatalf("readme.kind = %v, want commit", readme["kind"])
	}
	if readme["number"] != nil {
		t.Fatalf("readme.number = %v, want absent", readme["number"])
	}
	if readme["mergeCommitSha"] != "baresha1" {
		t.Fatalf("readme.mergeCommitSha = %v, want baresha1 (its own sha)", readme["mergeCommitSha"])
	}
	if readme["author"] != "Eve" {
		t.Fatalf("readme.author = %v, want Eve (git author name, no linked GitHub user)", readme["author"])
	}
	if got := shaStrings(t, readme["containedIn"]); len(got) != 1 || got[0] != "mergesha1" {
		t.Fatalf("readme.containedIn = %v, want [mergesha1]", got)
	}

	docs := findChange(t, body.Changes, byTitle("Update docs"))
	if docs["kind"] != "commit" {
		t.Fatalf("docs.kind = %v, want commit", docs["kind"])
	}
	wantDocsContained := []string{"mergesha1", "baresha1", "realsha2", "mergedanon"}
	if got := shaStrings(t, docs["containedIn"]); fmt.Sprint(got) != fmt.Sprint(wantDocsContained) {
		t.Fatalf("docs.containedIn = %v, want %v", got, wantDocsContained)
	}
}

func TestGitHubChanges_SinceFiltering(t *testing.T) {
	r := setupGitHubChangesTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/octo/repo"),
	})
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch req.URL.Path {
		case "/user":
			fmt.Fprint(w, `{"login":"alice"}`)
		case "/repos/octo/repo":
			fmt.Fprint(w, `{"default_branch":"main"}`)
		case "/repos/octo/repo/pulls":
			// #1 merged 5 days ago (in range for days=10); #2 merged 400
			// days ago (out of range) — both updated recently so the
			// updated_at early-exit in fetchMergedPulls doesn't hide #2
			// before the merged_at filter gets a chance to drop it.
			fmt.Fprintf(w, `[
				{"number":1,"title":"Recent","html_url":"https://github.com/octo/repo/pull/1","state":"closed","updated_at":"%s","merged_at":"%s","merge_commit_sha":"recentsha","base":{"ref":"main"},"head":{"sha":"h1"},"user":{"login":"alice"}},
				{"number":2,"title":"Old","html_url":"https://github.com/octo/repo/pull/2","state":"closed","updated_at":"%s","merged_at":"%s","merge_commit_sha":"oldsha","base":{"ref":"main"},"head":{"sha":"h2"},"user":{"login":"alice"}}
			]`,
				time.Now().AddDate(0, 0, -5).Format(time.RFC3339), time.Now().AddDate(0, 0, -5).Format(time.RFC3339),
				time.Now().AddDate(0, 0, -1).Format(time.RFC3339), time.Now().AddDate(0, 0, -400).Format(time.RFC3339))
		case "/repos/octo/repo/commits":
			fmt.Fprint(w, `[]`)
		default:
			t.Fatalf("unexpected path %s", req.URL.Path)
		}
	}))
	defer ts.Close()
	defer githubapp.SetBaseURLForTest(ts.URL + "/")()

	w := doGitHubPullsRequest(r, "/api/github/changes?days=10", "ghu_since_token")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
	var body struct {
		Changes []map[string]interface{}
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v (body: %s)", err, w.Body.String())
	}
	if len(body.Changes) != 1 {
		t.Fatalf("len(changes) = %d, want 1 (the 400-day-old merge must be filtered by days=10)", len(body.Changes))
	}
	if body.Changes[0]["number"] != float64(1) {
		t.Fatalf("changes[0].number = %v, want 1", body.Changes[0]["number"])
	}
}

func TestGitHubChanges_PaginationCutSetsContainedInAll(t *testing.T) {
	r := setupGitHubChangesTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/octo/repo"),
	})

	commitPages := 0
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch req.URL.Path {
		case "/user":
			fmt.Fprint(w, `{"login":"alice"}`)
		case "/repos/octo/repo":
			fmt.Fprint(w, `{"default_branch":"main"}`)
		case "/repos/octo/repo/pulls":
			fmt.Fprint(w, `[]`)
		case "/repos/octo/repo/commits":
			commitPages++
			page := 1
			if p := req.URL.Query().Get("page"); p != "" {
				page = atoiOrOne(p)
			}
			commits := make([]map[string]interface{}, 0, 100)
			for i := 0; i < 100; i++ {
				commits = append(commits, map[string]interface{}{
					"sha":    fmt.Sprintf("sha-p%d-%03d", page, i),
					"commit": map[string]interface{}{"message": "bare commit", "committer": map[string]string{"date": "2026-09-01T00:00:00Z"}},
				})
			}
			// 4 pages of 100 available, but changesCommitsMaxPages is 3 —
			// the handler must stop at 3 and report containedInAll=true on
			// every change from this repo.
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

	w := doGitHubPullsRequest(r, "/api/github/changes?days=3650", "ghu_cap_token")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
	if commitPages < 3 {
		t.Fatalf("expected at least 3 commit pages fetched, got %d", commitPages)
	}
	var body struct {
		Changes []map[string]interface{}
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v (body: %s)", err, w.Body.String())
	}
	// changesMaxResults (100) caps the response, so we only see the first
	// (newest) 100 of the 300 bare commits fetched, but every one of them
	// must carry containedInAll=true — the repo's history is known to be
	// incomplete beyond what was fetched.
	if len(body.Changes) == 0 {
		t.Fatalf("expected at least one change")
	}
	for _, ch := range body.Changes {
		if ch["containedInAll"] != true {
			t.Fatalf("change %v: containedInAll = %v, want true (cut at page cap)", ch["mergeCommitSha"], ch["containedInAll"])
		}
	}
}

func atoiOrOne(s string) int {
	n := 1
	fmt.Sscanf(s, "%d", &n)
	return n
}

func TestGitHubChanges_MineFilter(t *testing.T) {
	r := setupGitHubChangesTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/octo/repo"),
	})
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch req.URL.Path {
		case "/user":
			fmt.Fprint(w, `{"login":"alice"}`)
		case "/repos/octo/repo":
			fmt.Fprint(w, `{"default_branch":"main"}`)
		case "/repos/octo/repo/pulls":
			fmt.Fprint(w, `[
				{"number":1,"title":"Mine","html_url":"https://github.com/octo/repo/pull/1","state":"closed","updated_at":"2026-09-08T00:00:00Z","merged_at":"2026-09-08T00:00:00Z","merge_commit_sha":"minesha","base":{"ref":"main"},"head":{"sha":"h1"},"user":{"login":"alice"}},
				{"number":2,"title":"Not mine","html_url":"https://github.com/octo/repo/pull/2","state":"closed","updated_at":"2026-09-07T00:00:00Z","merged_at":"2026-09-07T00:00:00Z","merge_commit_sha":"notminesha","base":{"ref":"main"},"head":{"sha":"h2"},"user":{"login":"bob"}}
			]`)
		case "/repos/octo/repo/commits":
			fmt.Fprint(w, `[]`)
		default:
			t.Fatalf("unexpected path %s", req.URL.Path)
		}
	}))
	defer ts.Close()
	defer githubapp.SetBaseURLForTest(ts.URL + "/")()

	w := doGitHubPullsRequest(r, "/api/github/changes?days=3650&mine=1", "ghu_mine_token")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
	var body struct {
		User    string
		Changes []map[string]interface{}
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v (body: %s)", err, w.Body.String())
	}
	if body.User != "alice" {
		t.Fatalf("user = %q, want alice", body.User)
	}
	if len(body.Changes) != 1 {
		t.Fatalf("len(changes) = %d, want 1 (mine=1 must drop bob's PR)", len(body.Changes))
	}
	if body.Changes[0]["author"] != "alice" {
		t.Fatalf("changes[0].author = %v, want alice", body.Changes[0]["author"])
	}
}

func TestGitHubChanges_ETag304(t *testing.T) {
	r := setupGitHubChangesTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/octo/repo"),
	})
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch req.URL.Path {
		case "/user":
			fmt.Fprint(w, `{"login":"alice"}`)
		case "/repos/octo/repo":
			fmt.Fprint(w, `{"default_branch":"main"}`)
		case "/repos/octo/repo/pulls":
			fmt.Fprint(w, `[]`)
		case "/repos/octo/repo/commits":
			fmt.Fprint(w, `[]`)
		default:
			t.Fatalf("unexpected path %s", req.URL.Path)
		}
	}))
	defer ts.Close()
	defer githubapp.SetBaseURLForTest(ts.URL + "/")()

	w := doGitHubPullsRequest(r, "/api/github/changes?days=30", "ghu_etag_token")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
	if got := w.Header().Get("Cache-Control"); got != "private, no-cache" {
		t.Fatalf("Cache-Control = %q, want %q", got, "private, no-cache")
	}
	etag := w.Header().Get("ETag")
	if etag == "" {
		t.Fatalf("expected an ETag header")
	}

	req := httptest.NewRequest(http.MethodGet, "/api/github/changes?days=30", nil)
	req.AddCookie(&http.Cookie{Name: githubTokenCookie, Value: "ghu_etag_token"})
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

// TestGitHubChanges_ContainedInExcludesOwnMergeSha reproduces the
// kuberik-testing#2 (f7a46ae) row from the 2026-09-10 QA report: a PR with a
// real merge commit (exact merge_commit_sha match, classifyChanges rule 1)
// plus a much OLDER, unrelated commit on the same branch whose message
// happens to start with that PR's title. Before the fix, matchSquashPR's
// prefix match on the older commit overwrote the PR's already-correct
// position (set by the exact-sha pass) with the older commit's position,
// which made containedIn (computed from that wrong position) include the
// PR's own merge commit sha — contradicting containedIn's contract that an
// entry never contains itself.
func TestGitHubChanges_ContainedInExcludesOwnMergeSha(t *testing.T) {
	r := setupGitHubChangesTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/octo/repo"),
	})
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch req.URL.Path {
		case "/user":
			fmt.Fprint(w, `{"login":"alice"}`)
		case "/repos/octo/repo":
			fmt.Fprint(w, `{"default_branch":"main"}`)
		case "/repos/octo/repo/pulls":
			fmt.Fprint(w, `[
				{"number":2,"title":"Bump app version to v1.4.0","html_url":"https://github.com/octo/repo/pull/2","state":"closed","updated_at":"2026-09-09T10:00:00Z","merged_at":"2026-09-09T10:00:00Z","merge_commit_sha":"f7a46ae","base":{"ref":"main"},"head":{"sha":"headsha2"},"user":{"login":"alice"}}
			]`)
		case "/repos/octo/repo/commits":
			// Newest first: the real merge commit (idx 0, exact sha match),
			// an unrelated bare commit (idx 1), then a much older commit
			// (idx 2) whose message merely starts with the PR's title —
			// the false-positive matchSquashPR would otherwise latch onto.
			fmt.Fprint(w, `[
				{"sha":"f7a46ae","html_url":"https://github.com/octo/repo/commit/f7a46ae","parents":[{"sha":"pa"},{"sha":"pb"}],"commit":{"message":"Merge pull request #2 from bump-version","committer":{"date":"2026-09-09T10:00:00Z"}}},
				{"sha":"midsha","html_url":"https://github.com/octo/repo/commit/midsha","parents":[{"sha":"p1"}],"commit":{"message":"chore: cleanup","committer":{"date":"2026-09-08T00:00:00Z"}},"author":{"name":"Eve","date":"2026-09-08T00:00:00Z"}},
				{"sha":"staleSha","html_url":"https://github.com/octo/repo/commit/staleSha","parents":[{"sha":"p0"}],"commit":{"message":"Bump app version to v1.4.0-rc1 (early attempt)","committer":{"date":"2026-01-01T00:00:00Z"}},"author":{"name":"Frank","date":"2026-01-01T00:00:00Z"}}
			]`)
		default:
			t.Fatalf("unexpected path %s", req.URL.Path)
		}
	}))
	defer ts.Close()
	defer githubapp.SetBaseURLForTest(ts.URL + "/")()

	w := doGitHubPullsRequest(r, "/api/github/changes?days=3650", "ghu_f7a46ae_token")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
	var body struct {
		Changes []map[string]interface{}
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v (body: %s)", err, w.Body.String())
	}
	if len(body.Changes) != 3 {
		t.Fatalf("len(changes) = %d, want 3 (got %v)", len(body.Changes), body.Changes)
	}

	pr2 := findChange(t, body.Changes, func(ch map[string]interface{}) bool { return ch["number"] == float64(2) })
	if pr2["mergeCommitSha"] != "f7a46ae" {
		t.Fatalf("pr2.mergeCommitSha = %v, want f7a46ae", pr2["mergeCommitSha"])
	}
	got := shaStrings(t, pr2["containedIn"])
	for _, sha := range got {
		if sha == "f7a46ae" {
			t.Fatalf("pr2.containedIn = %v, contains its own merge commit sha f7a46ae", got)
		}
	}
	if len(got) != 0 {
		t.Fatalf("pr2.containedIn = %v, want [] (its real merge commit is the newest entry, nothing precedes it)", got)
	}

	// staleSha must NOT have stolen pr2's position — it's its own bare
	// commit, positioned at the true end of history.
	stale := findChange(t, body.Changes, func(ch map[string]interface{}) bool { return ch["mergeCommitSha"] == "staleSha" })
	if stale["kind"] != "commit" {
		t.Fatalf("staleSha.kind = %v, want commit (must not be misattributed to PR #2)", stale["kind"])
	}
	wantStaleContained := []string{"f7a46ae", "midsha"}
	if got := shaStrings(t, stale["containedIn"]); fmt.Sprint(got) != fmt.Sprint(wantStaleContained) {
		t.Fatalf("staleSha.containedIn = %v, want %v", got, wantStaleContained)
	}
}

// TestGitHubChanges_StaleTitlePrefixDoesNotStealSquashPosition reproduces
// the kuberik-testing-second#2 (dfdee1e) row from the 2026-09-10 QA report:
// a squash-merged PR whose reported merge_commit_sha never appears in the
// fetched commit window at all (so only the matchSquashPR "(#N)"-suffix
// heuristic can place it), plus a much older, unrelated commit whose message
// happens to start with the same PR title. The older commit must fall back
// to being its own bare change instead of overwriting the PR's
// heuristically-assigned position.
func TestGitHubChanges_StaleTitlePrefixDoesNotStealSquashPosition(t *testing.T) {
	r := setupGitHubChangesTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/octo/repo"),
	})
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch req.URL.Path {
		case "/user":
			fmt.Fprint(w, `{"login":"alice"}`)
		case "/repos/octo/repo":
			fmt.Fprint(w, `{"default_branch":"main"}`)
		case "/repos/octo/repo/pulls":
			fmt.Fprint(w, `[
				{"number":2,"title":"Fix retry loop","html_url":"https://github.com/octo/repo/pull/2","state":"closed","updated_at":"2026-09-09T09:00:00Z","merged_at":"2026-09-09T09:00:00Z","merge_commit_sha":"phantomsha2","base":{"ref":"main"},"head":{"sha":"headsha2"},"user":{"login":"alice"}}
			]`)
		case "/repos/octo/repo/commits":
			// Newest first: the true squash commit (idx 0, only findable via
			// the "(#2)" suffix — PR #2's own reported merge_commit_sha,
			// "phantomsha2", never appears here), a bare commit (idx 1),
			// then a much older commit (idx 2) whose message starts with
			// the same PR title but is otherwise unrelated.
			fmt.Fprint(w, `[
				{"sha":"dfdee1e","html_url":"https://github.com/octo/repo/commit/dfdee1e","parents":[{"sha":"p2"}],"commit":{"message":"Fix retry loop (#2)","committer":{"date":"2026-09-09T09:00:00Z"}},"author":{"login":"alice"}},
				{"sha":"midsha2","html_url":"https://github.com/octo/repo/commit/midsha2","parents":[{"sha":"p1"}],"commit":{"message":"docs: update readme","committer":{"date":"2026-09-08T00:00:00Z"}},"author":{"name":"Eve","date":"2026-09-08T00:00:00Z"}},
				{"sha":"staleSha2","html_url":"https://github.com/octo/repo/commit/staleSha2","parents":[{"sha":"p0"}],"commit":{"message":"Fix retry loop in old subsystem","committer":{"date":"2026-01-01T00:00:00Z"}},"author":{"name":"Frank","date":"2026-01-01T00:00:00Z"}}
			]`)
		default:
			t.Fatalf("unexpected path %s", req.URL.Path)
		}
	}))
	defer ts.Close()
	defer githubapp.SetBaseURLForTest(ts.URL + "/")()

	w := doGitHubPullsRequest(r, "/api/github/changes?days=3650", "ghu_dfdee1e_token")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
	var body struct {
		Changes []map[string]interface{}
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v (body: %s)", err, w.Body.String())
	}
	if len(body.Changes) != 3 {
		t.Fatalf("len(changes) = %d, want 3 (got %v)", len(body.Changes), body.Changes)
	}

	pr2 := findChange(t, body.Changes, func(ch map[string]interface{}) bool { return ch["number"] == float64(2) })
	if pr2["kind"] != "pr" {
		t.Fatalf("pr2.kind = %v, want pr", pr2["kind"])
	}
	got := shaStrings(t, pr2["containedIn"])
	for _, sha := range got {
		if sha == "dfdee1e" {
			t.Fatalf("pr2.containedIn = %v, contains its own squash commit sha dfdee1e", got)
		}
	}
	if len(got) != 0 {
		t.Fatalf("pr2.containedIn = %v, want [] (its squash commit is the newest entry)", got)
	}

	stale := findChange(t, body.Changes, func(ch map[string]interface{}) bool { return ch["mergeCommitSha"] == "staleSha2" })
	if stale["kind"] != "commit" {
		t.Fatalf("staleSha2.kind = %v, want commit (must not be misattributed to PR #2)", stale["kind"])
	}
	wantStaleContained := []string{"dfdee1e", "midsha2"}
	if got := shaStrings(t, stale["containedIn"]); fmt.Sprint(got) != fmt.Sprint(wantStaleContained) {
		t.Fatalf("staleSha2.containedIn = %v, want %v", got, wantStaleContained)
	}
}

// TestMatchSquashPR_SuffixPreferredOverTitlePrefix locks in classifyChanges
// rule 3's tie-break: when a single commit message coincidentally matches
// one PR's title-prefix AND another PR's "(#N)" suffix, the suffix match
// wins, regardless of the two PRs' order in the list. The suffix names an
// exact PR number and is the more specific signal; a title prefix is just a
// substring test that can coincidentally match an unrelated PR.
func TestMatchSquashPR_SuffixPreferredOverTitlePrefix(t *testing.T) {
	prA := &github.PullRequest{Number: github.Ptr(5), Title: github.Ptr("Fix bug now")}
	prB := &github.PullRequest{Number: github.Ptr(3), Title: github.Ptr("Something else entirely")}

	// "Fix bug now (#3)" starts with prA's title ("Fix bug now") but ends
	// with prB's "(#3)" suffix. prB (index 1) must win even though prA
	// (index 0) is checked first for a naive single-pass, prefix-first scan.
	got := matchSquashPR("Fix bug now (#3)", []*github.PullRequest{prA, prB})
	if got != 1 {
		t.Fatalf("matchSquashPR = %d, want 1 (prB, matched by its (#3) suffix over prA's coincidental title prefix)", got)
	}
}
