package kubernetes

import (
	"context"
	"time"

	"encoding/json"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/rest"
	"reflect"
	"sigs.k8s.io/controller-runtime/pkg/cache"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sync"
	"testing"

	releasev1alpha1 "github.com/kuberik/rollout-dashboard/pkg/apis/release/v1alpha1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestReleaseKindsAreCachedAndCarryObjects(t *testing.T) {
	src, slice := &releasev1alpha1.ReleaseSource{}, &releasev1alpha1.ReleaseSlice{}
	if got := kindOf(src); got != "ReleaseSource" {
		t.Errorf("kindOf(source) = %q", got)
	}
	if got := kindOf(slice); got != "ReleaseSlice" {
		t.Errorf("kindOf(slice) = %q", got)
	}
	optional := map[string]bool{}
	for _, o := range optionalCachedObjects() {
		optional[kindOf(o)] = true
	}
	for o := range cachedByObject() {
		if optional[kindOf(o)] {
			t.Errorf("%s must not be in cachedByObject (cache.New fails without its CRD)", kindOf(o))
		}
	}
	for _, k := range []string{"ReleaseSource", "ReleaseSlice"} {
		if !optional[k] {
			t.Errorf("%s not in optionalCachedObjects", k)
		}
		mk, ok := objectCarryingKinds[k]
		if !ok {
			t.Fatalf("%s not in objectCarryingKinds", k)
		}
		if kindOf(mk()) != k {
			t.Errorf("objectCarryingKinds[%s] builds %T", k, mk())
		}
	}
}

func TestReleaseTypesRegisteredAndDeepCopy(t *testing.T) {
	scheme, err := buildScheme()
	if err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"ReleaseSource", "ReleaseSlice", "ReleaseSliceList"} {
		if !scheme.Recognizes(releasev1alpha1.GroupVersion.WithKind(k)) {
			t.Errorf("%s not registered under kuberik.com/v1alpha1", k)
		}
	}
	now := metav1.Now()
	v, u := "1.0.0", "https://x"
	orig := &releasev1alpha1.ReleaseSlice{
		ObjectMeta: metav1.ObjectMeta{Name: "s-00000", Namespace: "ns"},
		Source:     "s", Sealed: true, NewestCreated: &now,
		Releases: []releasev1alpha1.Release{{Tag: "1", Version: &v, URL: &u, Sequence: 3, Created: now, FirstSeen: now,
			Requires: map[string]string{"api": ">=1"}, Metadata: map[string]string{"a": "b"}}},
	}
	cp := orig.DeepCopy()
	if !reflect.DeepEqual(orig, cp) {
		t.Fatal("deepcopy differs")
	}
	*cp.Releases[0].Version = "2.0.0"
	cp.Releases[0].Requires["api"] = "x"
	if *orig.Releases[0].Version != "1.0.0" || orig.Releases[0].Requires["api"] != ">=1" {
		t.Fatal("deepcopy shares memory with original")
	}
	b, err := json.Marshal(orig)
	if err != nil {
		t.Fatal(err)
	}
	var back releasev1alpha1.ReleaseSlice
	if err := json.Unmarshal(b, &back); err != nil {
		t.Fatal(err)
	}
	if back.Releases[0].Sequence != 3 || !back.Sealed {
		t.Fatalf("json round trip lost fields: %+v", back)
	}
}

// mapperFor builds a RESTMapper knowing exactly the given objects' kinds.
func mapperFor(t *testing.T, objs ...client.Object) *meta.DefaultRESTMapper {
	t.Helper()
	scheme, err := buildScheme()
	if err != nil {
		t.Fatal(err)
	}
	m := meta.NewDefaultRESTMapper(nil)
	for _, o := range objs {
		gvks, _, err := scheme.ObjectKinds(o)
		if err != nil || len(gvks) == 0 {
			t.Fatalf("no kind for %T: %v", o, err)
		}
		m.Add(gvks[0], meta.RESTScopeNamespace)
	}
	return m
}

func requiredObjs() []client.Object {
	var out []client.Object
	for o := range cachedByObject() {
		out = append(out, o)
	}
	return out
}

// The cache must build on a cluster whose mapper lacks the release CRDs.
func TestCacheBuildsWithoutReleaseCRDs(t *testing.T) {
	scheme, err := buildScheme()
	if err != nil {
		t.Fatal(err)
	}
	m := mapperFor(t, requiredObjs()...)
	c, err := cache.New(&rest.Config{Host: "http://127.0.0.1:1"}, cache.Options{
		Scheme: scheme, Mapper: m, ByObject: cachedByObject(),
	})
	if err != nil {
		t.Fatalf("cache.New failed without release CRDs: %v", err)
	}
	// Reads of an unmapped optional kind fail with a no-match error the
	// handler classifies as "CRD not installed".
	err = c.List(context.Background(), &releasev1alpha1.ReleaseSliceList{})
	if !IsCRDNotInstalled(err) {
		t.Fatalf("list of unmapped kind: err = %v, want IsCRDNotInstalled", err)
	}
	// And the control: adding a release kind to ByObject WOULD have failed.
	bad := cachedByObject()
	bad[&releasev1alpha1.ReleaseSlice{}] = cache.ByObject{}
	if _, err := cache.New(&rest.Config{Host: "http://127.0.0.1:1"}, cache.Options{Scheme: scheme, Mapper: m, ByObject: bad}); err == nil {
		t.Fatal("expected cache.New to fail with an unmapped ByObject kind (premise of the fix)")
	}
}

type fakeGetter struct{ got []string }

func (f *fakeGetter) GetInformer(_ context.Context, obj client.Object, _ ...cache.InformerGetOption) (cache.Informer, error) {
	f.got = append(f.got, kindOf(obj))
	return nil, nil
}

func TestOptionalInformersRegisterLate(t *testing.T) {
	scheme, _ := buildScheme()
	m := mapperFor(t, requiredObjs()...)
	g := &fakeGetter{}
	var attached []string
	attach := func(kind string, _ cache.Informer) { attached = append(attached, kind) }

	pending := registerOptionalInformers(context.Background(), g, m, scheme, optionalCachedObjects(), attach)
	if len(pending) != 2 || len(g.got) != 0 {
		t.Fatalf("pending=%d informers=%v, want 2 pending and none started", len(pending), g.got)
	}
	// release-controller installed later: only the source resolves first.
	m.Add(releasev1alpha1.GroupVersion.WithKind("ReleaseSource"), meta.RESTScopeNamespace)
	pending = registerOptionalInformers(context.Background(), g, m, scheme, pending, attach)
	if len(pending) != 1 || len(attached) != 1 || attached[0] != "ReleaseSource" {
		t.Fatalf("after source: pending=%d attached=%v", len(pending), attached)
	}
	m.Add(releasev1alpha1.GroupVersion.WithKind("ReleaseSlice"), meta.RESTScopeNamespace)
	pending = registerOptionalInformers(context.Background(), g, m, scheme, pending, attach)
	if len(pending) != 0 || len(attached) != 2 {
		t.Fatalf("after slice: pending=%d attached=%v", len(pending), attached)
	}
}

func TestReleaseSourceLastSyncTimeOnlyUpdateIsNotPublished(t *testing.T) {
	t1, t2 := metav1.NewTime(time.Unix(100, 0)), metav1.NewTime(time.Unix(160, 0))
	a := &releasev1alpha1.ReleaseSource{ObjectMeta: metav1.ObjectMeta{Name: "s", ResourceVersion: "1"},
		Status: releasev1alpha1.ReleaseSourceStatus{Count: 3, LastSyncTime: &t1}}
	b := a.DeepCopy()
	b.ResourceVersion = "2"
	b.Status.LastSyncTime = &t2
	b.ManagedFields = []metav1.ManagedFieldsEntry{{Manager: "x"}}
	if shouldPublishUpdate("ReleaseSource", a, b) {
		t.Fatal("lastSyncTime-only update must not publish")
	}
	b.Status.Count = 4
	if !shouldPublishUpdate("ReleaseSource", a, b) {
		t.Fatal("count change must publish")
	}
	c := a.DeepCopy()
	c.Labels = map[string]string{"x": "y"}
	if !shouldPublishUpdate("ReleaseSource", a, c) {
		t.Fatal("metadata change must publish")
	}
}

// The CRDs appear AFTER startup: the background poll registers each informer
// as discovery resolves it, with no restart.
func TestOptionalInformersStartWhenCRDsAppearAfterStartup(t *testing.T) {
	scheme, _ := buildScheme()
	m := &lockedMapper{DefaultRESTMapper: mapperFor(t, requiredObjs()...)}
	g := &syncGetter{}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() {
		retryOptionalInformers(ctx, 5*time.Millisecond, g, m, scheme, optionalCachedObjects(), func(string, cache.Informer) {})
		close(done)
	}()
	time.Sleep(30 * time.Millisecond)
	if n := g.count(); n != 0 {
		t.Fatalf("informers started before the CRDs existed: %d", n)
	}
	m.add(releasev1alpha1.GroupVersion.WithKind("ReleaseSource"))
	m.add(releasev1alpha1.GroupVersion.WithKind("ReleaseSlice"))
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("the poll never picked up the CRDs")
	}
	if n := g.count(); n != 2 {
		t.Fatalf("informers started = %d, want 2", n)
	}
}

type syncGetter struct {
	mu sync.Mutex
	n  int
}

func (s *syncGetter) GetInformer(context.Context, client.Object, ...cache.InformerGetOption) (cache.Informer, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.n++
	return nil, nil
}

func (s *syncGetter) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.n
}

// lockedMapper lets a test install CRDs while the poll reads the mapper.
type lockedMapper struct {
	*meta.DefaultRESTMapper
	mu sync.Mutex
}

func (l *lockedMapper) add(gvk schema.GroupVersionKind) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.DefaultRESTMapper.Add(gvk, meta.RESTScopeNamespace)
}

func (l *lockedMapper) RESTMapping(gk schema.GroupKind, versions ...string) (*meta.RESTMapping, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.DefaultRESTMapper.RESTMapping(gk, versions...)
}
