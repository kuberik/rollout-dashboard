package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/kuberik/rollout-dashboard/pkg/githubapp"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

func clusterErrorsOf(t *testing.T, body []byte) []ClusterError {
	t.Helper()
	var resp struct {
		ClusterErrors []ClusterError `json:"clusterErrors"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		t.Fatalf("decode: %v (%s)", err, body)
	}
	return resp.ClusterErrors
}

// The PR endpoints fan out to spokes to learn which repos the user may see.
// A spoke that cannot answer must be reported in the same clusterErrors field
// /api/rollouts uses, not dropped.
func TestGitHubPullRequest_ReportsClusterErrors(t *testing.T) {
	swapFanoutState(t, 2*time.Second)
	localURL := "https://kuberik.hub.example"
	t.Setenv("DASHBOARD_URL", localURL)
	spoke := deadSpokeURL(t)
	r := setupGitHubPullsTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/octo/repo"),
		envObj("team-a", localURL, spoke),
	})
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if req.URL.Path == "/repos/octo/repo/pulls/42" {
			fmt.Fprint(w, `{"number":42,"title":"x","state":"open","user":{"login":"a"},"head":{"sha":"abc1234def"}}`)
			return
		}
		fmt.Fprint(w, `{"total_count":0,"check_runs":[]}`)
	}))
	defer ts.Close()
	defer githubapp.SetBaseURLForTest(ts.URL + "/")()

	w := doGitHubPullsRequest(r, "/api/github/pulls/octo/repo/42", "ghu_tok")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	errs := clusterErrorsOf(t, w.Body.Bytes())
	if len(errs) != 1 || errs[0].URL != spoke {
		t.Fatalf("clusterErrors = %+v, want the dead spoke %s", errs, spoke)
	}
}

func TestGitHubPullsMine_ReportsClusterErrors(t *testing.T) {
	swapFanoutState(t, 2*time.Second)
	resetLoginCacheForTest(t)
	localURL := "https://kuberik.hub.example"
	t.Setenv("DASHBOARD_URL", localURL)
	spoke := deadSpokeURL(t)
	r := setupGitHubPullsTest(t, []client.Object{
		rolloutWithSource("team-a", "app-1", "https://github.com/octo/repo-a"),
		envObj("team-a", localURL, spoke),
	})
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch req.URL.Path {
		case "/user":
			fmt.Fprint(w, `{"login":"alice"}`)
		default:
			fmt.Fprint(w, `{"total_count":0,"incomplete_results":false,"items":[]}`)
		}
	}))
	defer ts.Close()
	defer githubapp.SetBaseURLForTest(ts.URL + "/")()

	w := doGitHubPullsRequest(r, "/api/github/pulls/mine?days=30", "ghu_mine_tok")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	errs := clusterErrorsOf(t, w.Body.Bytes())
	if len(errs) != 1 || errs[0].URL != spoke {
		t.Fatalf("clusterErrors = %+v, want the dead spoke %s", errs, spoke)
	}
}

// A repo deployed only on a spoke that cannot answer is not "not deployed
// here": the 404 must say which spoke could not be read.
func TestGitHubPullRequest_404CarriesClusterErrors(t *testing.T) {
	swapFanoutState(t, 2*time.Second)
	localURL := "https://kuberik.hub.example"
	t.Setenv("DASHBOARD_URL", localURL)
	spoke := deadSpokeURL(t)
	r := setupGitHubPullsTest(t, []client.Object{
		rolloutObj("team-a", "app-1"), // no source: nothing local deploys octo/only-on-spoke
		envObj("team-a", localURL, spoke),
	})
	w := doGitHubPullsRequest(r, "/api/github/pulls/octo/only-on-spoke/42", "ghu_tok")
	if w.Code != http.StatusNotFound {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	errs := clusterErrorsOf(t, w.Body.Bytes())
	if len(errs) != 1 || errs[0].URL != spoke {
		t.Fatalf("404 clusterErrors = %+v, want the dead spoke %s", errs, spoke)
	}
}

func TestGitHubPullsMine_404CarriesClusterErrors(t *testing.T) {
	swapFanoutState(t, 2*time.Second)
	localURL := "https://kuberik.hub.example"
	t.Setenv("DASHBOARD_URL", localURL)
	spoke := deadSpokeURL(t)
	r := setupGitHubPullsTest(t, []client.Object{
		rolloutObj("team-a", "app-1"),
		envObj("team-a", localURL, spoke),
	})
	w := doGitHubPullsRequest(r, "/api/github/pulls/mine?days=30", "ghu_tok")
	if w.Code != http.StatusNotFound {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	errs := clusterErrorsOf(t, w.Body.Bytes())
	if len(errs) != 1 || errs[0].URL != spoke {
		t.Fatalf("404 clusterErrors = %+v, want the dead spoke %s", errs, spoke)
	}
}
