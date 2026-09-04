package kubernetes

import (
	"crypto/sha256"
	"encoding/hex"
	"log"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/kuberik/rollout-dashboard/pkg/auth"
	"golang.org/x/sync/errgroup"
)

// Per-user read visibility — see the boundary doc comment in context.go.
//
// GetReadClient reads as the dashboard's own service account, which typically
// has broad read access. CanListRolloutsInNamespace is the check every
// namespaced object read through that client must pass, per-namespace, before
// it is allowed into a response for an OIDC-authenticated request: can the
// signed-in operator themselves `list rollouts` in that namespace? That's a
// SelfSubjectAccessReview run under the operator's own bearer token (never the
// shared client's identity), cached for visibilityTTL so a page that touches
// N objects in the same namespace doesn't cost N SelfSubjectAccessReview round
// trips.
//
// No token on the request (service-account mode: unauthenticated curl, a
// spoke's own default-client fan-out leg) means every namespace is allowed —
// identical to the pre-existing behavior, and correct: that caller already is
// the trusted identity, not a viewer whose RBAC needs re-checking.

const visibilityTTL = 5 * time.Minute

type visibilityEntry struct {
	allowed bool
	expires time.Time
}

var (
	visibilityMu    sync.Mutex
	visibilityCache = map[string]visibilityEntry{}
)

// visibilityCacheKey never retains the raw bearer token — only its hash — so a
// leak of process memory (a heap dump, a debug endpoint) can't recover live
// credentials from this cache.
func visibilityCacheKey(token, namespace string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:]) + "/" + namespace
}

// checkListRolloutsPermission is the real SelfSubjectAccessReview call,
// factored out as a package var so tests can substitute a fake and exercise
// CanListRolloutsInNamespace's caching/no-token logic without a live cluster.
var checkListRolloutsPermission = func(c *gin.Context, ns string) (bool, error) {
	writeClient, err := GetWriteClient(c)
	if err != nil {
		return false, err
	}
	return writeClient.CheckRolloutPermission(c.Request.Context(), "list", ns, "")
}

// CanListRolloutsInNamespace answers whether the caller behind c may list
// Rollouts in namespace ns, per SelfSubjectAccessReview under their own OIDC
// token, cached per (token, namespace) for 5 minutes. Always true when no
// token is present on the request (service-account mode).
func CanListRolloutsInNamespace(c *gin.Context, ns string) (bool, error) {
	token := auth.GetTokenFromContext(c)
	if token == "" {
		return true, nil
	}

	key := visibilityCacheKey(token, ns)

	visibilityMu.Lock()
	if entry, ok := visibilityCache[key]; ok && time.Now().Before(entry.expires) {
		visibilityMu.Unlock()
		return entry.allowed, nil
	}
	visibilityMu.Unlock()

	allowed, err := checkListRolloutsPermission(c, ns)
	if err != nil {
		return false, err
	}

	visibilityMu.Lock()
	visibilityCache[key] = visibilityEntry{allowed: allowed, expires: time.Now().Add(visibilityTTL)}
	visibilityMu.Unlock()

	return allowed, nil
}

// AllowedNamespaces evaluates CanListRolloutsInNamespace for each of the given
// namespaces (deduplicated) and returns the subset that are allowed, as a set.
// Used by cluster-wide read routes (e.g. /api/rollouts) to filter an
// already-fetched, shared-client-read result down to what the caller may see.
// Checks run concurrently (bounded by errgroup's default unlimited — namespace
// counts here are small, and repeat calls hit the cache) so N distinct
// namespaces cost one round trip each, not N sequential ones.
func AllowedNamespaces(c *gin.Context, namespaces []string) (map[string]bool, error) {
	// Distinct namespaces as a slice: the goroutines below must not write into
	// the map this loop is still iterating (a real race, caught by -race on
	// 2026-09-04), so the keys are fixed first and the answers go into a
	// separate map under the mutex.
	seen := make(map[string]struct{}, len(namespaces))
	keys := make([]string, 0, len(namespaces))
	for _, ns := range namespaces {
		if _, dup := seen[ns]; dup {
			continue
		}
		seen[ns] = struct{}{}
		keys = append(keys, ns)
	}

	allowedByNS := make(map[string]bool, len(keys))
	var mu sync.Mutex
	g, _ := errgroup.WithContext(c.Request.Context())
	for _, ns := range keys {
		ns := ns
		g.Go(func() error {
			allowed, err := CanListRolloutsInNamespace(c, ns)
			if err != nil {
				return err
			}
			mu.Lock()
			allowedByNS[ns] = allowed
			mu.Unlock()
			return nil
		})
	}
	if err := g.Wait(); err != nil {
		return nil, err
	}
	return allowedByNS, nil
}

// FilterEventsByVisibility trims a coalesced batch of change events (from
// EventHub, see eventhub.go) down to the ones the caller behind c may see,
// using the same "list rollouts in this namespace" SelfSubjectAccessReview as
// every other namespaced read (CanListRolloutsInNamespace) — the change
// stream must not leak the existence of an object in a namespace the caller
// couldn't otherwise list. No-op when the request carries no OIDC token
// (service-account mode streams every event, matching every other read
// path's no-token behavior). A single denied/erroring namespace only drops
// that namespace's events, never the whole batch.
func FilterEventsByVisibility(c *gin.Context, events []ChangeEvent) []ChangeEvent {
	token := auth.GetTokenFromContext(c)
	if token == "" {
		return events
	}
	out := make([]ChangeEvent, 0, len(events))
	for _, ev := range events {
		allowed, err := CanListRolloutsInNamespace(c, ev.Namespace)
		if err != nil {
			log.Printf("Error checking event-stream visibility for namespace %q: %v", ev.Namespace, err)
			continue
		}
		if allowed {
			out = append(out, ev)
		}
	}
	return out
}

// FilterByNamespace returns the subset of items whose namespace (per
// namespaceOf) is present and true in allowed. Used to trim an
// already-fetched typed list down to the namespaces a viewer may see.
func FilterByNamespace[T any](items []T, namespaceOf func(T) string, allowed map[string]bool) []T {
	out := make([]T, 0, len(items))
	for _, item := range items {
		if allowed[namespaceOf(item)] {
			out = append(out, item)
		}
	}
	return out
}
