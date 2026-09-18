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

// compareStub serves GET /repos/o/r/compare/{basehead} with the given status
// and commit shas, plus the pulls/{n} and check-runs calls the handler makes.
func compareStub(t *testing.T, number int, base, defaultBranch, mergeSha, status string, shas []string, total int) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case req.URL.Path == fmt.Sprintf("/repos/octo/repo/pulls/%d", number):
			fmt.Fprintf(w, `{
				"number":%d,"title":"t","html_url":"https://github.com/octo/repo/pull/%d",
				"state":"closed","merged_at":"2026-01-01T00:00:00Z","merge_commit_sha":%q,
				"base":{"ref":%q,"repo":{"default_branch":%q}},"user":{"login":"gio"}
			}`, number, number, mergeSha, base, defaultBranch)
		case req.URL.Path == fmt.Sprintf("/repos/octo/repo/compare/%s...%s", mergeSha, defaultBranch):
			// ⭐ THE ASSERTION THAT MATTERS MOST IS THE PATH ITSELF: the compare
			// runs against the DEFAULT branch, never the PR's own base.
			items := ""
			for i, s := range shas {
				if i > 0 {
					items += ","
				}
				items += fmt.Sprintf(`{"sha":%q}`, s)
			}
			fmt.Fprintf(w, `{"status":%q,"total_commits":%d,"commits":[%s]}`, status, total, items)
		case req.URL.Path == fmt.Sprintf("/repos/octo/repo/commits/%s/check-runs", mergeSha):
			fmt.Fprint(w, `{"total_count":0,"check_runs":[]}`)
		default:
			t.Fatalf("unexpected path %s", req.URL.Path)
		}
	}))
}

func pullBody(t *testing.T, number int, base, def, mergeSha, status string, shas []string, total int) map[string]interface{} {
	t.Helper()
	r := setupGitHubPullsTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/octo/repo"),
	})
	ts := compareStub(t, number, base, def, mergeSha, status, shas, total)
	defer ts.Close()
	defer githubapp.SetBaseURLForTest(ts.URL + "/")()

	w := doGitHubPullsRequest(r, fmt.Sprintf("/api/github/pulls/octo/repo/%d", number), "ghu_tok")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d (body: %s)", w.Code, w.Body.String())
	}
	var body map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return body
}

// ⭐ THE REPORTED CASE, ANSWERED INSTEAD OF DECLINED. caffeinelabs/app#8864
// merged one feature branch into another while every rollout deploys from
// `main`. Its merge commit IS an ancestor of `main` — measured live, 24 commits
// back — so containment is perfectly knowable and used to come back "unknown".
func TestGitHubPullRequest_StackedButLandedOnDefaultIsKnown(t *testing.T) {
	body := pullBody(t, 8864, "giorgio/agent-feedback-model", "main", "75d69ad",
		"ahead", []string{"a33ea40", "b11cc22"}, 2)

	if body["containedInUnknown"] != false {
		t.Fatalf("containedInUnknown = %v, want false — the change IS on the deploy branch", body["containedInUnknown"])
	}
	if body["containedInAll"] != false {
		t.Fatalf("containedInAll = %v, want false — the range was complete", body["containedInAll"])
	}
	// The merge commit itself plus its two descendants: `compare` returns only
	// what comes AFTER the merge, and the handler unions the merge sha back in.
	ci, _ := body["containedIn"].([]interface{})
	if len(ci) != 3 || ci[0] != "75d69ad" {
		t.Fatalf("containedIn = %v, want the merge sha then its two descendants", body["containedIn"])
	}
}

// ⛔ NOT LANDED IS A REAL ANSWER, NOT AN UNKNOWN ONE. When the stack has not
// merged to the deploy branch, nothing built from it carries the change, and an
// AUTHORITATIVE empty set says exactly that.
func TestGitHubPullRequest_StackedNotYetOnDefaultIsAuthoritativelyEmpty(t *testing.T) {
	body := pullBody(t, 9000, "giorgio/stack", "main", "aaa1111",
		"diverged", nil, 0)

	if body["containedInUnknown"] != false {
		t.Fatalf("containedInUnknown = %v, want false — we KNOW it is not there", body["containedInUnknown"])
	}
	if body["containedInAll"] != false {
		t.Fatalf("containedInAll = %v, want false — an authoritative empty set", body["containedInAll"])
	}
	// ⚠️ NOT literally empty: the merge commit itself is the one revision we
	// are certain carries the change, so it stays. What matters is that nothing
	// ON THE DEPLOY BRANCH is claimed — every build cut from `main` is
	// authoritatively "not built", which is exactly true until the stack lands.
	ci, _ := body["containedIn"].([]interface{})
	if len(ci) != 1 || ci[0] != "aaa1111" {
		t.Fatalf("containedIn = %v, want just the merge sha", body["containedIn"])
	}
}

// Truncation is reported by the API, not inferred from a page counter.
func TestGitHubPullRequest_CompareTruncationSetsContainedInAll(t *testing.T) {
	body := pullBody(t, 7000, "main", "main", "ccc3333",
		"ahead", []string{"d1", "d2"}, 400)

	if body["containedInAll"] != true {
		t.Fatalf("containedInAll = %v, want true — total_commits exceeded the returned page", body["containedInAll"])
	}
	if body["containedInUnknown"] != false {
		t.Fatalf("containedInUnknown = %v, want false — truncated is not unknown", body["containedInUnknown"])
	}
}
