package kubernetes

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/kuberik/rollout-dashboard/pkg/auth"
)

func newTestGinContext(t *testing.T, token string) *gin.Context {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest(http.MethodGet, "/api/rollouts", nil)
	c.Request = req
	if token != "" {
		c.Set(auth.TokenContextKey, token)
	}
	return c
}

// withFakeChecker swaps checkListRolloutsPermission for the duration of the
// test and restores it on cleanup, so tests never hit a live apiserver.
func withFakeChecker(t *testing.T, fn func(c *gin.Context, ns string) (bool, error)) {
	t.Helper()
	original := checkListRolloutsPermission
	checkListRolloutsPermission = fn
	t.Cleanup(func() { checkListRolloutsPermission = original })
}

func resetVisibilityCache() {
	visibilityMu.Lock()
	visibilityCache = map[string]visibilityEntry{}
	visibilityMu.Unlock()
}

func TestCanListRolloutsInNamespace_NoToken(t *testing.T) {
	resetVisibilityCache()
	calls := 0
	withFakeChecker(t, func(c *gin.Context, ns string) (bool, error) {
		calls++
		return false, nil
	})

	c := newTestGinContext(t, "")
	allowed, err := CanListRolloutsInNamespace(c, "team-a")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !allowed {
		t.Fatalf("expected service-account (no-token) mode to allow every namespace")
	}
	if calls != 0 {
		t.Fatalf("expected the SSAR checker to be skipped entirely when no token is present, got %d calls", calls)
	}
}

func TestCanListRolloutsInNamespace_Allowed(t *testing.T) {
	resetVisibilityCache()
	calls := 0
	withFakeChecker(t, func(c *gin.Context, ns string) (bool, error) {
		calls++
		if ns != "team-a" {
			t.Fatalf("unexpected namespace %q", ns)
		}
		return true, nil
	})

	c := newTestGinContext(t, "user-token")
	allowed, err := CanListRolloutsInNamespace(c, "team-a")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !allowed {
		t.Fatalf("expected namespace to be allowed")
	}

	// Second call within the TTL must be served from cache, not re-check.
	allowed, err = CanListRolloutsInNamespace(c, "team-a")
	if err != nil {
		t.Fatalf("unexpected error on cached call: %v", err)
	}
	if !allowed {
		t.Fatalf("expected cached result to still be allowed")
	}
	if calls != 1 {
		t.Fatalf("expected exactly 1 SSAR call (second lookup should hit cache), got %d", calls)
	}
}

func TestCanListRolloutsInNamespace_Denied(t *testing.T) {
	resetVisibilityCache()
	calls := 0
	withFakeChecker(t, func(c *gin.Context, ns string) (bool, error) {
		calls++
		return false, nil
	})

	c := newTestGinContext(t, "user-token")
	allowed, err := CanListRolloutsInNamespace(c, "secret-ns")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if allowed {
		t.Fatalf("expected namespace to be denied")
	}

	// Denial is cached too — a second lookup must not re-check.
	allowed, err = CanListRolloutsInNamespace(c, "secret-ns")
	if err != nil {
		t.Fatalf("unexpected error on cached call: %v", err)
	}
	if allowed {
		t.Fatalf("expected cached denial to remain denied")
	}
	if calls != 1 {
		t.Fatalf("expected exactly 1 SSAR call, got %d", calls)
	}
}

func TestCanListRolloutsInNamespace_DifferentUsersNotShared(t *testing.T) {
	resetVisibilityCache()
	withFakeChecker(t, func(c *gin.Context, ns string) (bool, error) {
		token := auth.GetTokenFromContext(c)
		return token == "trusted-user", nil
	})

	trusted := newTestGinContext(t, "trusted-user")
	untrusted := newTestGinContext(t, "untrusted-user")

	allowed, err := CanListRolloutsInNamespace(trusted, "team-a")
	if err != nil || !allowed {
		t.Fatalf("expected trusted user to be allowed, got allowed=%v err=%v", allowed, err)
	}

	allowed, err = CanListRolloutsInNamespace(untrusted, "team-a")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if allowed {
		t.Fatalf("expected untrusted user's cache entry to be independent of the trusted user's")
	}
}

func TestAllowedNamespaces_MixedResult(t *testing.T) {
	resetVisibilityCache()
	withFakeChecker(t, func(c *gin.Context, ns string) (bool, error) {
		return ns == "allowed-ns", nil
	})

	c := newTestGinContext(t, "user-token")
	result, err := AllowedNamespaces(c, []string{"allowed-ns", "denied-ns", "allowed-ns"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result["allowed-ns"] {
		t.Fatalf("expected allowed-ns to be allowed")
	}
	if result["denied-ns"] {
		t.Fatalf("expected denied-ns to be denied")
	}
}

func TestFilterByNamespace(t *testing.T) {
	type item struct {
		Namespace string
		Name      string
	}
	items := []item{
		{Namespace: "a", Name: "one"},
		{Namespace: "b", Name: "two"},
		{Namespace: "a", Name: "three"},
	}
	allowed := map[string]bool{"a": true, "b": false}

	got := FilterByNamespace(items, func(i item) string { return i.Namespace }, allowed)
	if len(got) != 2 {
		t.Fatalf("expected 2 items to survive the filter, got %d: %+v", len(got), got)
	}
	for _, i := range got {
		if i.Namespace != "a" {
			t.Fatalf("expected only namespace \"a\" items, got %+v", i)
		}
	}
}
