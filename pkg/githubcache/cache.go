// Package githubcache gives the dashboard's GitHub clients an HTTP cache that
// spends no rate-limit budget on answers it already has.
//
// ── WHY, IN ONE PARAGRAPH ───────────────────────────────────────────────────
//
// Every GitHub REST response carries an `ETag` (and usually a `Last-Modified`).
// If a later request repeats it in `If-None-Match`, GitHub answers `304 Not
// Modified` with no body — and **a 304 does not count against the rate limit**
// (https://docs.github.com/rest/using-the-rest-api/best-practices#use-conditional-requests-if-appropriate).
// So the cheap request is not "the one we skipped", it is "the one we asked
// conditionally". That is what this package makes every GET do.
//
// ── FOLLOWING THE ORG'S PATTERN, NOT INVENTING ONE ──────────────────────────
//
// `environment-controller` already caches GitHub through `sigs.k8s.io/prow`'s
// `ghcache` (`cmd/main.go`: `ghcache.NewMemCache(baseTransport, 10, …)`), which
// is built on `github.com/cjwagner/httpcache`. This package uses the same
// library and reproduces ghcache's two load-bearing decisions:
//
//  1. **Partition the cache by `Authorization`.** ghcache hashes the header and
//     keeps one cache per hash. The dashboard needs this even more than a
//     controller does: `/api/rollouts/*/commits` acts as the VIEWING USER, so a
//     shared cache would let one operator read a private repo through another
//     operator's cached bytes. Partitioning makes that structurally impossible.
//  2. **Rewrite the upstream `Cache-Control` so entries are stored but never
//     served blind.** GitHub says `private, max-age=60`, which would let a cache
//     answer for a minute WITHOUT asking. ghcache overwrites it with `no-cache`
//     ("store it, always revalidate"), and errors with `no-store` ("never store
//     it — an error cannot be revalidated into a saving").
//
// What this package does NOT take from ghcache is prow's dependency tree
// (prometheus, redis, diskv, logrus) and its request coalescing/throttling,
// which exist for a fleet of bots sharing one token budget. This is a
// single-process dashboard with one cache per human.
//
// ── THE ONE PLACE STALENESS IS ALLOWED, AND WHY IT IS SAFE ──────────────────
//
// A cache that serves a stale answer for MUTABLE data is worse than no cache.
// So `no-cache` (revalidate every time) is the default for everything —
// `/user`, a compare against a branch name, anything whose answer can change
// under a fixed URL.
//
// `GET /repos/{owner}/{repo}/compare/{base}...{head}` where BOTH refs are
// commit shas is the exception: the set of commits between two immutable
// objects, and the diffstat over them, cannot change. That range is given a
// real freshness window (`ImmutableTTL`), so a repeat inside the window costs
// no request at all — not even a conditional one. The window is deliberately
// short rather than infinite because the ANSWER is immutable while the
// READER'S RIGHT TO SEE IT is not: a revoked collaborator keeps their own
// already-fetched bytes for at most one window.
//
// ── WHERE IT SITS IN THE TRANSPORT CHAIN, AND WHY IT MATTERS ────────────────
//
// It goes in `http.Client.Transport`, UNDER go-github's auth round tripper —
// i.e. `github.NewClient(WithTransport(githubcache.Shared()), WithAuthToken(t))`.
// `newClient` applies `WithTransport` first and then wraps whatever is there
// with the token setter, so requests reach this package WITH their final
// `Authorization` header. Both properties depend on that ordering:
//
//   - the partition key exists at all (the header is set by the layer above), and
//   - a client that REFRESHES its credential (a GitHub App installation token is
//     rotated roughly hourly) lands in a new partition instead of reusing an
//     entry fetched under a grant it no longer holds.
//
// Putting the cache ABOVE the auth layer would key every identity's responses
// together under one unauthenticated-looking request. That is the security bug
// this comment exists to prevent.
package githubcache

import (
	"container/list"
	"crypto/sha256"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/cjwagner/httpcache"
)

// Options tunes the shared transport. The zero value is filled in by New.
type Options struct {
	// Maximum number of Authorization partitions kept at once. Each connected
	// user is one partition; the least recently used is dropped past this.
	MaxPartitions int
	// Byte budget for one partition's stored responses.
	MaxBytesPerPartition int
	// Freshness window granted to an immutable sha-to-sha compare. Zero means
	// "no window" — revalidate everything, always.
	ImmutableTTL time.Duration
}

const (
	defaultMaxPartitions        = 32
	defaultMaxBytesPerPartition = 32 << 20 // 32 MiB
	defaultImmutableTTL         = 10 * time.Minute
)

func (o Options) withDefaults() Options {
	if o.MaxPartitions <= 0 {
		o.MaxPartitions = defaultMaxPartitions
	}
	if o.MaxBytesPerPartition <= 0 {
		o.MaxBytesPerPartition = defaultMaxBytesPerPartition
	}
	if o.ImmutableTTL < 0 {
		o.ImmutableTTL = 0
	} else if o.ImmutableTTL == 0 {
		o.ImmutableTTL = defaultImmutableTTL
	}
	return o
}

// New builds a caching round tripper on top of base (nil means
// http.DefaultTransport).
func New(base http.RoundTripper, opts Options) http.RoundTripper {
	if base == nil {
		base = http.DefaultTransport
	}
	opts = opts.withDefaults()
	policy := &policyTransport{base: base, immutableTTL: opts.ImmutableTTL}
	return &partitionedTransport{
		max:   opts.MaxPartitions,
		lru:   list.New(),
		byKey: map[string]*list.Element{},
		newPartition: func() http.RoundTripper {
			t := httpcache.NewTransport(newLRUCache(opts.MaxBytesPerPartition))
			t.Transport = policy
			return t
		},
	}
}

var (
	sharedOnce sync.Once
	shared     http.RoundTripper
)

// Shared is the process-wide transport. One cache for the whole dashboard means
// two browser tabs asking the same question spend one conditional request.
func Shared() http.RoundTripper {
	sharedOnce.Do(func() { shared = New(nil, Options{}) })
	return shared
}

// ── partitioning ────────────────────────────────────────────────────────────

type partitionedTransport struct {
	mu           sync.Mutex
	max          int
	lru          *list.List // front = most recently used; values are string keys
	byKey        map[string]*list.Element
	partitions   map[string]http.RoundTripper
	newPartition func() http.RoundTripper
}

// PartitionKey is the cache partition a request belongs to: a hash of its
// credential, so the key can never leak the credential itself.
func PartitionKey(r *http.Request) string {
	return fmt.Sprintf("%x", sha256.Sum256([]byte(r.Header.Get("Authorization"))))
}

func (p *partitionedTransport) partitionFor(key string) http.RoundTripper {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.partitions == nil {
		p.partitions = map[string]http.RoundTripper{}
	}
	if el, ok := p.byKey[key]; ok {
		p.lru.MoveToFront(el)
		return p.partitions[key]
	}
	rt := p.newPartition()
	p.partitions[key] = rt
	p.byKey[key] = p.lru.PushFront(key)
	for p.lru.Len() > p.max {
		oldest := p.lru.Back()
		if oldest == nil {
			break
		}
		p.lru.Remove(oldest)
		victim := oldest.Value.(string)
		delete(p.partitions, victim)
		delete(p.byKey, victim)
	}
	return rt
}

func (p *partitionedTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	return p.partitionFor(PartitionKey(r)).RoundTrip(r)
}

// ── cache policy ────────────────────────────────────────────────────────────

// policyTransport rewrites response headers on their way back INTO the cache,
// which is where the caching policy is actually decided (httpcache only obeys
// what the response tells it). Same technique as ghcache's upstreamTransport.
type policyTransport struct {
	base         http.RoundTripper
	immutableTTL time.Duration
}

func (u *policyTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	resp, err := u.base.RoundTrip(r)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		// An error has no ETag worth keeping: it cannot be revalidated into a
		// cheap answer, and holding a fixed 403 risks refusing a user who has
		// since been granted access.
		resp.Header.Set("Cache-Control", "no-store")
		return resp, nil
	}
	// 200 and 304 alike. `Cache-Control` is an end-to-end header, so the value
	// written onto a 304 also refreshes the stored entry's window.
	if u.immutableTTL > 0 && IsImmutableRequest(r) {
		resp.Header.Set("Cache-Control", fmt.Sprintf("max-age=%d", int(u.immutableTTL.Seconds())))
	} else {
		resp.Header.Set("Cache-Control", "no-cache")
	}
	return resp, nil
}

var (
	comparePathRe = regexp.MustCompile(`^/?repos/[^/]+/[^/]+/compare/([^/]+)$`)
	shaRe         = regexp.MustCompile(`^[0-9a-fA-F]{7,40}$`)
)

// IsCommitSHA reports whether a git ref is a commit sha — i.e. names an object
// that can never change — as opposed to a branch or tag name, which moves.
// This is the whole basis on which anything here is allowed to skip asking
// GitHub, so it is deliberately strict: hex only, 7 to 40 characters.
func IsCommitSHA(ref string) bool {
	return shaRe.MatchString(ref)
}

// IsImmutableRequest reports whether a request's answer is fixed for all time:
// a compare of two commit shas. A compare against a branch or tag name is NOT
// immutable — the ref moves — and neither is any other endpoint.
func IsImmutableRequest(r *http.Request) bool {
	if r.Method != http.MethodGet || r.URL == nil {
		return false
	}
	if r.URL.RawQuery != "" {
		// Pagination or per_page changes what the answer contains; keep the
		// simple case simple and revalidate anything else.
		return false
	}
	m := comparePathRe.FindStringSubmatch(r.URL.EscapedPath())
	if m == nil {
		return false
	}
	base, head, ok := strings.Cut(m[1], "...")
	if !ok {
		return false
	}
	return IsCommitSHA(base) && IsCommitSHA(head)
}

// ── bounded in-memory store ─────────────────────────────────────────────────

// lruCache is httpcache.Cache with a byte budget. httpcache's own MemoryCache
// is an unbounded map; a dashboard left open on a busy repo would grow it
// forever, and a compare response with a large `files` array is not small.
type lruCache struct {
	mu      sync.Mutex
	max     int
	size    int
	ll      *list.List
	entries map[string]*list.Element
}

type cacheEntry struct {
	key string
	val []byte
}

func newLRUCache(maxBytes int) *lruCache {
	return &lruCache{max: maxBytes, ll: list.New(), entries: map[string]*list.Element{}}
}

func (c *lruCache) Get(key string) ([]byte, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	el, ok := c.entries[key]
	if !ok {
		return nil, false
	}
	c.ll.MoveToFront(el)
	return el.Value.(*cacheEntry).val, true
}

func (c *lruCache) Set(key string, val []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if el, ok := c.entries[key]; ok {
		e := el.Value.(*cacheEntry)
		c.size += len(val) - len(e.val)
		e.val = val
		c.ll.MoveToFront(el)
	} else {
		c.entries[key] = c.ll.PushFront(&cacheEntry{key: key, val: val})
		c.size += len(val)
	}
	for c.size > c.max {
		oldest := c.ll.Back()
		if oldest == nil {
			break
		}
		e := c.ll.Remove(oldest).(*cacheEntry)
		delete(c.entries, e.key)
		c.size -= len(e.val)
	}
}

func (c *lruCache) Delete(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if el, ok := c.entries[key]; ok {
		e := c.ll.Remove(el).(*cacheEntry)
		delete(c.entries, e.key)
		c.size -= len(e.val)
	}
}

// httpcacheXFromCache is the header cjwagner/httpcache stamps on a response it
// rebuilt from a cache entry. Named here so a caller (and the tests) can assert
// on it without importing the library.
const httpcacheXFromCache = httpcache.XFromCache
