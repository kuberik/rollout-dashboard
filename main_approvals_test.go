package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	rolloutv1alpha1 "github.com/kuberik/rollout-controller/api/v1alpha1"
	releasev1alpha1 "github.com/kuberik/rollout-dashboard/pkg/apis/release/v1alpha1"
	"github.com/kuberik/rollout-dashboard/pkg/kubernetes"
	authorizationv1 "k8s.io/api/authorization/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	k8stesting "k8s.io/client-go/testing"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/interceptor"
)

const approvalNS = "shop"

func approvalRollout() *rolloutv1alpha1.Rollout {
	r := rolloutObj(approvalNS, "checkout")
	r.UID = "rollout-uid-1"
	r.Status.Candidates = []rolloutv1alpha1.ReleaseCandidate{{Tag: "v1.42.0"}, {Tag: "v1.41.0"}}
	return r
}

// approvalEnv wires the seams a handler test needs and returns the router.
type approvalEnv struct {
	fc       *kubernetes.Client
	router   *gin.Engine
	verified bool
}

func newApprovalEnv(t *testing.T, fc *kubernetes.Client, identity string) *approvalEnv {
	t.Helper()
	gin.SetMode(gin.TestMode)
	env := &approvalEnv{fc: fc}
	t.Cleanup(kubernetes.SetReadClientForTest(fc))
	t.Cleanup(kubernetes.SetListRolloutsPermissionCheckForTest(func(*gin.Context, string) (bool, error) { return true, nil }))
	prevW, prevI, prevL, prevV := writeClientFn, approverIdentityFn, approvalsListClientFn, approvalByVerified
	writeClientFn = func(*gin.Context) (*kubernetes.Client, error) { return fc, nil }
	approverIdentityFn = func(context.Context, *kubernetes.Client) (string, bool, error) {
		return identity, strings.HasPrefix(identity, "system:serviceaccount:"), nil
	}
	approvalsListClientFn = func() (*kubernetes.Client, error) { return fc, nil }
	approvalByVerified = func(context.Context) bool { return env.verified }
	t.Cleanup(func() { writeClientFn, approverIdentityFn, approvalsListClientFn, approvalByVerified = prevW, prevI, prevL, prevV })
	env.router = setupRouter()
	return env
}

func (e *approvalEnv) do(method, path, body string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	e.router.ServeHTTP(w, req)
	return w
}

func (e *approvalEnv) approve(version string) *httptest.ResponseRecorder {
	return e.do(http.MethodPost, "/api/rollouts/"+approvalNS+"/checkout/approve", `{"version":"`+version+`"}`)
}

func (e *approvalEnv) revoke(version string) *httptest.ResponseRecorder {
	return e.do(http.MethodPost, "/api/rollouts/"+approvalNS+"/checkout/approve", `{"version":"`+version+`","revoke":true}`)
}

func (e *approvalEnv) getApproval(t *testing.T, name string) *rolloutv1alpha1.RolloutApproval {
	t.Helper()
	list, err := e.fc.ListRolloutApprovals(context.Background(), approvalNS, "checkout")
	if err != nil {
		t.Fatal(err)
	}
	for i := range list {
		if list[i].Name == name {
			return &list[i]
		}
	}
	return nil
}

func decode(t *testing.T, w *httptest.ResponseRecorder, out any) {
	t.Helper()
	if err := json.Unmarshal(w.Body.Bytes(), out); err != nil {
		t.Fatalf("body %q: %v", w.Body.String(), err)
	}
}

type approveBody struct {
	Approval struct {
		Name    string  `json:"name"`
		Version string  `json:"version"`
		By      *string `json:"by"`
	} `json:"approval"`
}

func TestApprove_CreatesNamedOwnedApprovalWithBy(t *testing.T) {
	fc, _ := kubernetes.NewTestClient(approvalRollout())
	env := newApprovalEnv(t, fc, "oidc:luka")

	w := env.approve("v1.42.0")
	if w.Code != 200 {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	var out approveBody
	decode(t, w, &out)
	if out.Approval.Name != "checkout-v1-42-0" || out.Approval.Version != "v1.42.0" || out.Approval.By == nil || *out.Approval.By != "oidc:luka" {
		t.Fatalf("response = %+v", out)
	}
	a := env.getApproval(t, "checkout-v1-42-0")
	if a == nil {
		t.Fatal("RolloutApproval not created")
	}
	if a.Spec.RolloutRef.Name != "checkout" || a.Spec.Version != "v1.42.0" {
		t.Fatalf("spec = %+v", a.Spec)
	}
	if a.Annotations["approval.kuberik.com/by"] != "oidc:luka" {
		t.Fatalf("annotations = %v", a.Annotations)
	}
	if len(a.OwnerReferences) != 1 || a.OwnerReferences[0].Kind != "Rollout" || a.OwnerReferences[0].Name != "checkout" ||
		a.OwnerReferences[0].UID != "rollout-uid-1" || a.OwnerReferences[0].APIVersion != "kuberik.com/v1alpha1" {
		t.Fatalf("owner references = %+v", a.OwnerReferences)
	}
}

func TestApprove_ServiceAccountGetsNoBy(t *testing.T) {
	fc, _ := kubernetes.NewTestClient(approvalRollout())
	env := newApprovalEnv(t, fc, "system:serviceaccount:kuberik-system:rollout-dashboard")

	w := env.approve("v1.42.0")
	if w.Code != 200 {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), `"by"`) {
		t.Fatalf("response must omit by for a service account: %s", w.Body.String())
	}
	if _, has := env.getApproval(t, "checkout-v1-42-0").Annotations["approval.kuberik.com/by"]; has {
		t.Fatal("by annotation set for a service account")
	}
}

func TestApprove_LongTagIsTruncatedWithHash(t *testing.T) {
	long := "v" + strings.Repeat("a", 300)
	r := approvalRollout()
	r.Status.Candidates = []rolloutv1alpha1.ReleaseCandidate{{Tag: long}}
	fc, _ := kubernetes.NewTestClient(r)
	env := newApprovalEnv(t, fc, "oidc:luka")

	w := env.approve(long)
	if w.Code != 200 {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	var out approveBody
	decode(t, w, &out)
	want := kubernetes.ApprovalName("checkout", long)
	if out.Approval.Name != want || len(want) > 63 || !strings.HasPrefix(want, "checkout-v"+strings.Repeat("a", 44)+"-") {
		t.Fatalf("name %q (len %d), want %q", out.Approval.Name, len(out.Approval.Name), want)
	}
	if env.getApproval(t, want) == nil {
		t.Fatal("approval not stored under the truncated name")
	}
}

func TestApprove_TwiceIs200BothTimes(t *testing.T) {
	fc, _ := kubernetes.NewTestClient(approvalRollout())
	env := newApprovalEnv(t, fc, "oidc:luka")
	for i := 0; i < 2; i++ {
		if w := env.approve("v1.42.0"); w.Code != 200 {
			t.Fatalf("call %d: status %d: %s", i, w.Code, w.Body.String())
		}
	}
	list, _ := fc.ListRolloutApprovals(context.Background(), approvalNS, "checkout")
	if len(list) != 1 {
		t.Fatalf("want 1 approval, got %d", len(list))
	}
}

func TestApprove_NonCandidateIs409(t *testing.T) {
	fc, _ := kubernetes.NewTestClient(approvalRollout())
	env := newApprovalEnv(t, fc, "oidc:luka")
	w := env.approve("v9.9.9")
	if w.Code != http.StatusConflict {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"error"`) {
		t.Fatalf("body %s", w.Body.String())
	}
	if list, _ := fc.ListRolloutApprovals(context.Background(), approvalNS, "checkout"); len(list) != 0 {
		t.Fatal("an approval was created for a non-candidate")
	}
}

func TestApprove_CandidateFromCatalogueNewerThanDeployed(t *testing.T) {
	r := approvalRollout()
	r.Status.Candidates = nil // beyond the controller's working set
	r.Spec.ReleaseSourceRef = &corev1.LocalObjectReference{Name: "src"}
	r.Status.History = []rolloutv1alpha1.DeploymentHistoryEntry{{Version: rolloutv1alpha1.VersionInfo{Tag: "v1.0.0"}}}
	slice := &releasev1alpha1.ReleaseSlice{
		ObjectMeta: metav1.ObjectMeta{Namespace: approvalNS, Name: "src-00000"},
		Source:     "src",
		Releases: []releasev1alpha1.Release{
			{Tag: "v1.0.0", Sequence: 1}, {Tag: "v1.1.0", Sequence: 2}, {Tag: "v0.9.0", Sequence: 0},
		},
	}
	fc, _ := kubernetes.NewTestClient(r, slice)
	env := newApprovalEnv(t, fc, "oidc:luka")
	if w := env.approve("v1.1.0"); w.Code != 200 {
		t.Fatalf("newer than deployed: status %d: %s", w.Code, w.Body.String())
	}
	if w := env.approve("v0.9.0"); w.Code != http.StatusConflict {
		t.Fatalf("older than deployed: status %d: %s", w.Code, w.Body.String())
	}
}

func TestApprove_MissingVersionIs400(t *testing.T) {
	fc, _ := kubernetes.NewTestClient(approvalRollout())
	env := newApprovalEnv(t, fc, "oidc:luka")
	for _, body := range []string{`{}`, `{"version":""}`, `{"version":"  "}`, `not json`} {
		if w := env.do(http.MethodPost, "/api/rollouts/shop/checkout/approve", body); w.Code != 400 {
			t.Fatalf("body %q: status %d", body, w.Code)
		}
	}
}

func TestApprove_NameCollisionIs409(t *testing.T) {
	// "v1.42.0" and "V1.42.0" sanitise to the same name.
	r := approvalRollout()
	r.Status.Candidates = []rolloutv1alpha1.ReleaseCandidate{{Tag: "v1.42.0"}, {Tag: "V1.42.0"}}
	fc, _ := kubernetes.NewTestClient(r)
	env := newApprovalEnv(t, fc, "oidc:luka")
	if w := env.approve("v1.42.0"); w.Code != 200 {
		t.Fatalf("first: %d %s", w.Code, w.Body.String())
	}
	w := env.approve("V1.42.0")
	if w.Code != http.StatusConflict {
		t.Fatalf("collision: status %d: %s", w.Code, w.Body.String())
	}
	if got := env.getApproval(t, "checkout-v1-42-0").Spec.Version; got != "v1.42.0" {
		t.Fatalf("the existing approval was changed to %q", got)
	}
}

func TestApprove_ForbiddenIsPassedThrough(t *testing.T) {
	fc, _ := kubernetes.NewTestClientWithInterceptor(interceptor.Funcs{
		Create: func(ctx context.Context, c client.WithWatch, obj client.Object, opts ...client.CreateOption) error {
			if _, ok := obj.(*rolloutv1alpha1.RolloutApproval); ok {
				return apierrors.NewForbidden(schema.GroupResource{Group: "kuberik.com", Resource: "rolloutapprovals"}, "x", nil)
			}
			return c.Create(ctx, obj, opts...)
		},
	}, approvalRollout())
	env := newApprovalEnv(t, fc, "oidc:luka")
	w := env.approve("v1.42.0")
	if w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), `"error"`) {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
}

func TestRevoke_MissingObjectIs200(t *testing.T) {
	fc, _ := kubernetes.NewTestClient(approvalRollout())
	env := newApprovalEnv(t, fc, "oidc:luka")
	w := env.revoke("v1.42.0")
	if w.Code != 200 || strings.TrimSpace(w.Body.String()) != "{}" {
		t.Fatalf("status %d body %s", w.Code, w.Body.String())
	}
}

func TestRevoke_DeletesTheDeterministicObject(t *testing.T) {
	fc, _ := kubernetes.NewTestClient(approvalRollout())
	env := newApprovalEnv(t, fc, "oidc:luka")
	env.approve("v1.42.0")
	w := env.revoke("v1.42.0")
	if w.Code != 200 || strings.TrimSpace(w.Body.String()) != "{}" {
		t.Fatalf("status %d body %s", w.Code, w.Body.String())
	}
	if env.getApproval(t, "checkout-v1-42-0") != nil {
		t.Fatal("approval still present")
	}
}

func gitApproval(name, version, by string) *rolloutv1alpha1.RolloutApproval {
	a := &rolloutv1alpha1.RolloutApproval{
		ObjectMeta: metav1.ObjectMeta{Namespace: approvalNS, Name: name},
		Spec:       rolloutv1alpha1.RolloutApprovalSpec{RolloutRef: corev1.LocalObjectReference{Name: "checkout"}, Version: version},
	}
	if by != "" {
		a.Annotations = map[string]string{"approval.kuberik.com/by": by}
	}
	return a
}

func TestRevoke_GitApprovalForSameVersionReportsStillApproved(t *testing.T) {
	fc, _ := kubernetes.NewTestClient(approvalRollout(), gitApproval("release-1-42", "v1.42.0", "oidc:alice"))
	env := newApprovalEnv(t, fc, "oidc:luka")
	env.approve("v1.42.0")

	for _, verified := range []bool{false, true} {
		env.verified = verified
		w := env.revoke("v1.42.0")
		if w.Code != 200 {
			t.Fatalf("status %d: %s", w.Code, w.Body.String())
		}
		var out struct {
			StillApproved bool `json:"stillApproved"`
			Approvals     []struct {
				Name string  `json:"name"`
				By   *string `json:"by"`
			} `json:"approvals"`
		}
		decode(t, w, &out)
		if !out.StillApproved || len(out.Approvals) != 1 || out.Approvals[0].Name != "release-1-42" {
			t.Fatalf("verified=%v body %s", verified, w.Body.String())
		}
		if verified != (out.Approvals[0].By != nil) {
			t.Fatalf("verified=%v but by=%v", verified, out.Approvals[0].By)
		}
	}
	if env.getApproval(t, "release-1-42") == nil {
		t.Fatal("revoke deleted an approval it does not own")
	}
	if env.getApproval(t, "checkout-v1-42-0") != nil {
		t.Fatal("deterministic approval survived revoke")
	}
}

func legacyGate(name string, versions ...string) *rolloutv1alpha1.RolloutGate {
	av := append([]string{}, versions...)
	g := &rolloutv1alpha1.RolloutGate{ObjectMeta: metav1.ObjectMeta{Namespace: approvalNS, Name: name}}
	g.Spec.RolloutRef = &corev1.LocalObjectReference{Name: "checkout"}
	g.Spec.AllowedVersions = &av
	return g
}

func gateVersions(t *testing.T, fc *kubernetes.Client, name string) []string {
	t.Helper()
	gates, err := fc.GetRolloutGatesByRolloutReference(context.Background(), approvalNS, "checkout")
	if err != nil {
		t.Fatal(err)
	}
	for _, g := range gates.Items {
		if g.Name == name {
			if g.Spec.AllowedVersions == nil {
				t.Fatalf("gate %s allowedVersions is nil (would mean no opinion)", name)
			}
			return *g.Spec.AllowedVersions
		}
	}
	t.Fatalf("gate %s not found", name)
	return nil
}

func TestApprove_LegacyGateIsDualWrittenAndOtherGatesLeftAlone(t *testing.T) {
	policyGate := legacyGate("policy-gate")
	policyGate.Labels = map[string]string{"gate.kuberik.com/approval-policy-name": "p"}
	policyGate.OwnerReferences = []metav1.OwnerReference{{Kind: "ApprovalPolicy", Name: "p", APIVersion: "kuberik.com/v1alpha1", UID: "u"}}
	sched := legacyGate("sched")
	sched.OwnerReferences = []metav1.OwnerReference{{Kind: "RolloutSchedule", Name: "s", APIVersion: "kuberik.com/v1alpha1", UID: "u2"}}
	killSwitch := legacyGate("kill")
	killSwitch.Spec.AllowedVersions = nil
	fc, _ := kubernetes.NewTestClient(approvalRollout(), legacyGate("manual", "v1.40.0"), policyGate, sched, killSwitch)
	env := newApprovalEnv(t, fc, "oidc:luka")

	if w := env.approve("v1.42.0"); w.Code != 200 {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if env.getApproval(t, "checkout-v1-42-0") == nil {
		t.Fatal("approval not created")
	}
	if got := strings.Join(gateVersions(t, fc, "manual"), ","); got != "v1.40.0,v1.42.0" {
		t.Fatalf("legacy gate allowedVersions = %s", got)
	}
	for _, n := range []string{"policy-gate", "sched"} {
		if got := gateVersions(t, fc, n); len(got) != 0 {
			t.Fatalf("%s was patched: %v", n, got)
		}
	}
	// idempotent: no duplicate on a second approve
	env.approve("v1.42.0")
	if got := strings.Join(gateVersions(t, fc, "manual"), ","); got != "v1.40.0,v1.42.0" {
		t.Fatalf("after second approve = %s", got)
	}
	// revoke removes it again and keeps [] not nil
	env.revoke("v1.42.0")
	if got := strings.Join(gateVersions(t, fc, "manual"), ","); got != "v1.40.0" {
		t.Fatalf("after revoke = %s", got)
	}
	env.revoke("v1.40.0")
	_ = gateVersions(t, fc, "manual") // fails the test if nil
}

func TestRevoke_LegacyGateKeepsVersionWhileAnotherApprovalExists(t *testing.T) {
	fc, _ := kubernetes.NewTestClient(approvalRollout(), legacyGate("manual"), gitApproval("release-1-42", "v1.42.0", ""))
	env := newApprovalEnv(t, fc, "oidc:luka")
	env.approve("v1.42.0")
	env.revoke("v1.42.0")
	if got := strings.Join(gateVersions(t, fc, "manual"), ","); got != "v1.42.0" {
		t.Fatalf("legacy gate lost a version another approval still grants: %q", got)
	}
}

func TestApprove_LegacyGatePatchRetriesOnConflict(t *testing.T) {
	conflicts := 0
	fc, _ := kubernetes.NewTestClientWithInterceptor(interceptor.Funcs{
		Update: func(ctx context.Context, c client.WithWatch, obj client.Object, opts ...client.UpdateOption) error {
			if g, ok := obj.(*rolloutv1alpha1.RolloutGate); ok && conflicts < 2 {
				conflicts++
				return apierrors.NewConflict(schema.GroupResource{Group: "kuberik.com", Resource: "rolloutgates"}, g.Name, nil)
			}
			return c.Update(ctx, obj, opts...)
		},
	}, approvalRollout(), legacyGate("manual"))
	env := newApprovalEnv(t, fc, "oidc:luka")
	if w := env.approve("v1.42.0"); w.Code != 200 {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if conflicts != 2 || strings.Join(gateVersions(t, fc, "manual"), ",") != "v1.42.0" {
		t.Fatalf("conflicts=%d versions=%v", conflicts, gateVersions(t, fc, "manual"))
	}
}

func TestListApprovals_OmitsByWhenUnverifiedAndSortsByCreatedThenName(t *testing.T) {
	t0 := metav1.NewTime(time.Date(2026, 11, 1, 10, 0, 0, 0, time.UTC))
	t1 := metav1.NewTime(t0.Add(time.Hour))
	a := gitApproval("b-newer", "v2", "oidc:alice")
	a.CreationTimestamp = t1
	b := gitApproval("z-same-time", "v1", "oidc:bob")
	b.CreationTimestamp = t0
	c := gitApproval("a-same-time", "v0", "")
	c.CreationTimestamp = t0
	other := gitApproval("other", "v1", "oidc:eve")
	other.Spec.RolloutRef.Name = "someone-else"
	fc, _ := kubernetes.NewTestClient(approvalRollout(), a, b, c, other)
	env := newApprovalEnv(t, fc, "oidc:luka")

	type listBody struct {
		ByVerified bool `json:"byVerified"`
		Approvals  []struct {
			Name      string  `json:"name"`
			Version   string  `json:"version"`
			By        *string `json:"by"`
			CreatedAt string  `json:"createdAt"`
		} `json:"approvals"`
	}
	get := func() listBody {
		w := env.do(http.MethodGet, "/api/rollouts/shop/checkout/approvals", "")
		if w.Code != 200 {
			t.Fatalf("status %d: %s", w.Code, w.Body.String())
		}
		var out listBody
		decode(t, w, &out)
		return out
	}
	un := get()
	if un.ByVerified || len(un.Approvals) != 3 {
		t.Fatalf("unverified = %+v", un)
	}
	for _, e := range un.Approvals {
		if e.By != nil {
			t.Fatalf("by leaked while unverified: %+v", e)
		}
	}
	names := un.Approvals[0].Name + "," + un.Approvals[1].Name + "," + un.Approvals[2].Name
	if names != "a-same-time,z-same-time,b-newer" {
		t.Fatalf("order = %s", names)
	}
	if un.Approvals[0].CreatedAt != "2026-11-01T10:00:00Z" {
		t.Fatalf("createdAt = %q", un.Approvals[0].CreatedAt)
	}
	env.verified = true
	v := get()
	if !v.ByVerified || v.Approvals[1].By == nil || *v.Approvals[1].By != "oidc:bob" || v.Approvals[0].By != nil {
		t.Fatalf("verified = %+v", v)
	}
}

func TestPermissionsAll_IncludesApprove(t *testing.T) {
	for _, allowed := range []bool{true, false} {
		fc, cs, _ := kubernetes.NewTestClientWithPods([]client.Object{approvalRollout()})
		var seen []authorizationv1.ResourceAttributes
		cs.PrependReactor("create", "selfsubjectaccessreviews", func(a k8stesting.Action) (bool, runtime.Object, error) {
			r := a.(k8stesting.CreateAction).GetObject().(*authorizationv1.SelfSubjectAccessReview)
			seen = append(seen, *r.Spec.ResourceAttributes)
			r.Status.Allowed = allowed && r.Spec.ResourceAttributes.Resource == "rolloutapprovals"
			return true, r, nil
		})
		env := newApprovalEnv(t, fc, "oidc:luka")
		w := env.do(http.MethodGet, "/api/rollouts/shop/checkout/permissions/all", "")
		if w.Code != 200 {
			t.Fatalf("status %d: %s", w.Code, w.Body.String())
		}
		var out struct {
			Permissions map[string]bool `json:"permissions"`
		}
		decode(t, w, &out)
		if got, ok := out.Permissions["approve"]; !ok || got != allowed {
			t.Fatalf("allowed=%v permissions=%v", allowed, out.Permissions)
		}
		found := false
		for _, ra := range seen {
			if ra.Group == "kuberik.com" && ra.Resource == "rolloutapprovals" && ra.Verb == "create" && ra.Namespace == approvalNS {
				found = true
			}
		}
		if !found {
			t.Fatalf("no create rolloutapprovals SSAR in %s: %+v", approvalNS, seen)
		}
	}
}

func TestApproveRoutes_FanOutToSpokeLikePin(t *testing.T) {
	resetClusterPathTestState(t)
	t.Setenv("CLUSTER_NAME", "hub1")
	type hit struct{ method, path, body string }
	var hits []hit
	spoke := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b := new(strings.Builder)
		buf := make([]byte, 512)
		for {
			n, err := r.Body.Read(buf)
			b.Write(buf[:n])
			if err != nil {
				break
			}
		}
		hits = append(hits, hit{r.Method, r.URL.Path + "?" + r.URL.RawQuery, b.String()})
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true}`))
	}))
	defer spoke.Close()
	registry.put([]ClusterInfo{{Name: "spoke1", URL: spoke.URL}})
	handler := ClusterPathRewriteHandler(setupRouter())

	for _, tc := range []struct{ method, path, body string }{
		{"POST", "/api/clusters/spoke1/rollouts/shop/checkout/approve", `{"version":"v1.42.0"}`},
		{"GET", "/api/clusters/spoke1/rollouts/shop/checkout/approvals", ""},
	} {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		req.Header.Set("Content-Type", "application/json")
		handler.ServeHTTP(w, req)
		if w.Code != 200 {
			t.Fatalf("%s %s: status %d: %s", tc.method, tc.path, w.Code, w.Body.String())
		}
	}
	if len(hits) != 2 ||
		hits[0].method != "POST" || hits[0].path != "/api/rollouts/shop/checkout/approve?" || hits[0].body != `{"version":"v1.42.0"}` ||
		hits[1].method != "GET" || hits[1].path != "/api/rollouts/shop/checkout/approvals?" {
		t.Fatalf("spoke saw %+v", hits)
	}
}
