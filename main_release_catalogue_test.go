package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	releasev1alpha1 "github.com/kuberik/rollout-dashboard/pkg/apis/release/v1alpha1"
	"github.com/kuberik/rollout-dashboard/pkg/kubernetes"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/interceptor"
)

func relSource(ns, name string) *releasev1alpha1.ReleaseSource {
	return &releasev1alpha1.ReleaseSource{
		ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: name},
		Status:     releasev1alpha1.ReleaseSourceStatus{Count: 2, SliceCount: 1},
	}
}

func relSlice(ns, source string) *releasev1alpha1.ReleaseSlice {
	now := metav1.Now()
	return &releasev1alpha1.ReleaseSlice{
		ObjectMeta: metav1.ObjectMeta{
			Namespace:     ns,
			Name:          source + "-00000",
			Labels:        map[string]string{releasev1alpha1.ReleaseSourceLabel: source},
			ManagedFields: []metav1.ManagedFieldsEntry{{Manager: "release-controller", Operation: metav1.ManagedFieldsOperationUpdate, APIVersion: "kuberik.com/v1alpha1", FieldsType: "FieldsV1", FieldsV1: &metav1.FieldsV1{Raw: []byte(`{}`)}}},
		},
		Source: source,
		Releases: []releasev1alpha1.Release{
			{Tag: "1.0.0", Sequence: 1, Created: now, FirstSeen: now},
			{Tag: "1.1.0", Sequence: 2, Created: now, FirstSeen: now},
		},
	}
}

type catalogueBody struct {
	ReleaseSources *struct {
		Items []struct {
			Metadata struct {
				Namespace   string            `json:"namespace"`
				Name        string            `json:"name"`
				Annotations map[string]string `json:"annotations"`
			} `json:"metadata"`
		} `json:"items"`
	} `json:"releaseSources"`
	ReleaseSlices *struct {
		Items []struct {
			Metadata struct {
				Namespace     string            `json:"namespace"`
				Annotations   map[string]string `json:"annotations"`
				ManagedFields []any             `json:"managedFields"`
			} `json:"metadata"`
			Source   string `json:"source"`
			Releases []struct {
				Tag      string `json:"tag"`
				Sequence int64  `json:"sequence"`
			} `json:"releases"`
		} `json:"items"`
	} `json:"releaseSlices"`
	PartialReads []string `json:"partialReads"`
}

func getCatalogue(t *testing.T, path string) (int, catalogueBody, map[string]json.RawMessage) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	w := httptest.NewRecorder()
	setupRouter().ServeHTTP(w, req)
	var b catalogueBody
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(w.Body.Bytes(), &b); err != nil {
		t.Fatalf("unmarshal: %v (%s)", err, w.Body.String())
	}
	_ = json.Unmarshal(w.Body.Bytes(), &raw)
	return w.Code, b, raw
}

func TestRolloutsList_CarriesReleaseSourcesAndSlices(t *testing.T) {
	hcIsolation(t)
	withHCReadClient(t, nil, rolloutObj("team-a", "app"), relSource("team-a", "app-src"), relSlice("team-a", "app-src"))
	code, b, _ := getCatalogue(t, "/api/rollouts")
	if code != http.StatusOK {
		t.Fatalf("status %d", code)
	}
	if b.ReleaseSources == nil || len(b.ReleaseSources.Items) != 1 || b.ReleaseSources.Items[0].Metadata.Name != "app-src" {
		t.Fatalf("releaseSources = %+v", b.ReleaseSources)
	}
	if b.ReleaseSlices == nil || len(b.ReleaseSlices.Items) != 1 {
		t.Fatalf("releaseSlices = %+v", b.ReleaseSlices)
	}
	sl := b.ReleaseSlices.Items[0]
	if sl.Source != "app-src" || len(sl.Releases) != 2 || sl.Releases[1].Sequence != 2 {
		t.Fatalf("slice payload wrong: %+v", sl)
	}
	if len(sl.Metadata.ManagedFields) != 0 {
		t.Fatalf("managedFields not stripped")
	}
	if sl.Metadata.Annotations[sourceClusterAnnotation] != "hub1" {
		t.Fatalf("slice source-cluster = %q, want hub1", sl.Metadata.Annotations[sourceClusterAnnotation])
	}
	if b.ReleaseSources.Items[0].Metadata.Annotations[sourceClusterAnnotation] != "hub1" {
		t.Fatalf("source not stamped with cluster")
	}
	if len(b.PartialReads) != 0 {
		t.Fatalf("partialReads = %v on a healthy read", b.PartialReads)
	}
}

func TestRolloutsList_ReleaseCatalogueHonoursNamespaceFilter(t *testing.T) {
	hcIsolation(t)
	withHCReadClient(t, nil, rolloutObj("team-a", "app"), relSource("team-a", "s"), relSlice("team-a", "s"),
		relSource("team-b", "s"), relSlice("team-b", "s"))
	_, b, _ := getCatalogue(t, "/api/rollouts?namespace=team-b")
	if b.ReleaseSlices == nil || len(b.ReleaseSlices.Items) != 1 || b.ReleaseSlices.Items[0].Metadata.Namespace != "team-b" {
		t.Fatalf("namespace filter leaked: %+v", b.ReleaseSlices)
	}
}

func TestRolloutsList_ReleaseCatalogueVisibilityDropsDeniedNamespace(t *testing.T) {
	hcIsolation(t)
	withHCReadClient(t, nil, rolloutObj("team-a", "app"), rolloutObj("team-b", "app"),
		relSource("team-a", "s"), relSlice("team-a", "s"), relSource("team-b", "s"), relSlice("team-b", "s"))
	t.Cleanup(kubernetes.SetListRolloutsPermissionCheckForTest(func(_ *gin.Context, ns string) (bool, error) {
		return ns == "team-a", nil
	}))
	req := httptest.NewRequest(http.MethodGet, "/api/rollouts", nil)
	req.Header.Set("Authorization", "Bearer tok-a")
	w := httptest.NewRecorder()
	setupRouter().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	var b catalogueBody
	if err := json.Unmarshal(w.Body.Bytes(), &b); err != nil {
		t.Fatal(err)
	}
	if len(b.ReleaseSlices.Items) != 1 || b.ReleaseSlices.Items[0].Metadata.Namespace != "team-a" {
		t.Fatalf("slices = %+v, want only team-a", b.ReleaseSlices.Items)
	}
	if len(b.ReleaseSources.Items) != 1 || b.ReleaseSources.Items[0].Metadata.Namespace != "team-a" {
		t.Fatalf("sources = %+v, want only team-a", b.ReleaseSources.Items)
	}
}

func noMatchFor(kind string) error {
	return &meta.NoKindMatchError{GroupKind: schema.GroupKind{Group: "kuberik.com", Kind: kind}, SearchedVersions: []string{"v1alpha1"}}
}

func TestRolloutsList_ReleaseCRDMissingIsNullNotAnError(t *testing.T) {
	hcIsolation(t)
	funcs := interceptor.Funcs{List: func(ctx context.Context, c client.WithWatch, list client.ObjectList, opts ...client.ListOption) error {
		switch list.(type) {
		case *releasev1alpha1.ReleaseSourceList:
			return noMatchFor("ReleaseSource")
		case *releasev1alpha1.ReleaseSliceList:
			return noMatchFor("ReleaseSlice")
		}
		return c.List(ctx, list, opts...)
	}}
	withHCReadClient(t, &funcs, rolloutObj("team-a", "app"))
	code, b, raw := getCatalogue(t, "/api/rollouts")
	if code != http.StatusOK {
		t.Fatalf("status %d, want 200 when the catalogue CRDs are absent", code)
	}
	for _, k := range []string{"releaseSources", "releaseSlices"} {
		if v, ok := raw[k]; !ok || !isNullList(v) {
			t.Fatalf("%s = %s (present=%v), want null / items:null (same as rolloutDependencies)", k, v, ok)
		}
	}
	if len(b.PartialReads) != 0 {
		t.Fatalf("absent CRD reported as partial read: %v", b.PartialReads)
	}
}

func TestRolloutsList_ReleaseRealFailureIsReportedPartial(t *testing.T) {
	hcIsolation(t)
	funcs := interceptor.Funcs{List: func(ctx context.Context, c client.WithWatch, list client.ObjectList, opts ...client.ListOption) error {
		if _, ok := list.(*releasev1alpha1.ReleaseSliceList); ok {
			return fmt.Errorf("etcd timeout")
		}
		return c.List(ctx, list, opts...)
	}}
	withHCReadClient(t, &funcs, rolloutObj("team-a", "app"), relSource("team-a", "s"))
	code, b, raw := getCatalogue(t, "/api/rollouts")
	if code != http.StatusOK {
		t.Fatalf("status %d", code)
	}
	if !isNullList(raw["releaseSlices"]) {
		t.Fatalf("releaseSlices = %s, want null", raw["releaseSlices"])
	}
	if len(b.PartialReads) != 1 || b.PartialReads[0] != "releaseSlices" {
		t.Fatalf("partialReads = %v, want [releaseSlices]", b.PartialReads)
	}
	if b.ReleaseSources == nil || len(b.ReleaseSources.Items) != 1 {
		t.Fatalf("healthy releaseSources lost")
	}
}

func TestFanOut_MergesSpokeReleaseSlicesWithClusterAnnotation(t *testing.T) {
	spoke := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/cluster" {
			fmt.Fprint(w, `{"name":"spoke"}`)
			return
		}
		fmt.Fprint(w, `{"rollouts":{"items":[]},"releaseSlices":{"items":[{"metadata":{"name":"s-00000","namespace":"team-a"},"source":"s","sealed":false,"releases":[]}]},"releaseSources":null}`)
	}))
	defer spoke.Close()
	swapFanoutState(t, 2*time.Second)

	localURL := "https://kuberik.hub.example"
	envs := envsWithSpoke(localURL, spoke.URL)
	local := func() map[string]json.RawMessage {
		d := localDataWith(envs)
		d["releaseSlices"] = json.RawMessage(`{"items":[{"metadata":{"name":"h-00000","namespace":"team-a"},"source":"h"}]}`)
		return d
	}
	var merged map[string]json.RawMessage
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		merged, _, _ = fanOutRollouts(context.Background(), local(), localURL, "")
		if jsonHasName(t, merged["releaseSlices"], "s-00000") {
			break
		}
		waitForFanoutBackground()
		time.Sleep(30 * time.Millisecond)
	}
	var list struct {
		Items []struct {
			Metadata struct {
				Name        string            `json:"name"`
				Annotations map[string]string `json:"annotations"`
			} `json:"metadata"`
		} `json:"items"`
	}
	if err := json.Unmarshal(merged["releaseSlices"], &list); err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, it := range list.Items {
		got[it.Metadata.Name] = it.Metadata.Annotations[sourceClusterAnnotation]
	}
	if got["s-00000"] != "spoke" || got["h-00000"] == "" || got["h-00000"] == "spoke" {
		t.Fatalf("cluster stamping wrong: %v", got)
	}
}

func TestMergedKeysIncludeReleaseCatalogue(t *testing.T) {
	for _, want := range []string{"releaseSources", "releaseSlices"} {
		found := false
		for _, k := range mergedKeys {
			found = found || k == want
		}
		if !found {
			t.Errorf("%s missing from mergedKeys", want)
		}
	}
}

// isNullList: a list that could not be read or does not exist. The fan-out
// annotator re-marshals a null list as {"items":null}, exactly as it does for
// rolloutDependencies; the client reads both as "no catalogue".
func isNullList(v json.RawMessage) bool {
	if string(v) == "null" {
		return true
	}
	var l struct {
		Items []json.RawMessage `json:"items"`
	}
	return json.Unmarshal(v, &l) == nil && l.Items == nil
}

// A spoke whose releaseSlices read failed says so in its leg's partialReads;
// the hub must surface that as "<cluster>/releaseSlices" next to its own bare
// keys, or the failed read looks like an empty catalogue.
func TestFanOut_SpokePartialReadsReachHubQualified(t *testing.T) {
	spoke := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/cluster" {
			fmt.Fprint(w, `{"name":"prod"}`)
			return
		}
		fmt.Fprint(w, `{"rollouts":{"items":[]},"releaseSlices":null,"partialReads":["releaseSlices"]}`)
	}))
	defer spoke.Close()
	swapFanoutState(t, 2*time.Second)
	localURL := "https://kuberik.hub.example"
	envs := envsWithSpoke(localURL, spoke.URL)
	var partials []string
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		_, _, _, partials = fanOutRolloutsWithPartials(context.Background(), localDataWith(envs), localURL, "")
		if len(partials) > 0 {
			break
		}
		waitForFanoutBackground()
		time.Sleep(30 * time.Millisecond)
	}
	if len(partials) != 1 || partials[0] != "prod/releaseSlices" {
		t.Fatalf("partials = %v, want [prod/releaseSlices]", partials)
	}
}
