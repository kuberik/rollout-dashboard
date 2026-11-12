package kubernetes

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"testing"
	"time"

	admissionregistrationv1 "k8s.io/api/admissionregistration/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/kubernetes"
	k8sfake "k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
)

// The four examples in .work/approvals/CONTRACT.md; the same cases are in the
// rollout-controller migration script's tests.
func TestApprovalName_ContractExamples(t *testing.T) {
	long := "v" + strings.Repeat("a", 300)
	sum := sha256.Sum256([]byte(long))
	cases := []struct{ rollout, version, want string }{
		{"checkout", "v1.42.0", "checkout-v1-42-0"},
		{"checkout", "V1.42.0+Build_7", "checkout-v1-42-0-build-7"},
		{"checkout", "1.0.0-", "checkout-1-0-0"},
		{"checkout", long, "checkout-v" + strings.Repeat("a", 44) + "-" + hex.EncodeToString(sum[:])[:8]},
	}
	for _, tc := range cases {
		got := ApprovalName(tc.rollout, tc.version)
		if got != tc.want {
			t.Errorf("ApprovalName(%q, %.20q) = %q, want %q", tc.rollout, tc.version, got, tc.want)
		}
		if len(got) > 63 {
			t.Errorf("name %q longer than 63", got)
		}
	}
	// the hash of the long case is the shell's: printf %s "$V" | sha256sum | cut -c1-8
	if got := ApprovalName("checkout", long); len(got) != 63 || !strings.HasSuffix(got, "-42c4c913") {
		t.Errorf("long name %q: want length 63 and the shell's sha256 prefix 42c4c913", got)
	}
}

func TestApprovalName_TruncationStripsTrailingDash(t *testing.T) {
	// n[:54] ends in the "-" that "." sanitises to; it is stripped before the hash.
	v := strings.Repeat("a", 44) + "." + strings.Repeat("b", 30)
	sum := sha256.Sum256([]byte(v))
	want := "checkout-" + strings.Repeat("a", 44) + "-" + hex.EncodeToString(sum[:])[:8]
	if got := ApprovalName("checkout", v); got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestApproverIdentity(t *testing.T) {
	cases := []struct {
		user string
		sa   bool
		want string
	}{
		{"oidc:luka", false, "oidc:luka"},
		{"luka", false, "luka"},
		{"", false, ""},
		{"system:serviceaccount:ns:sa", true, ""},
		{"system:serviceaccount:ns:sa", false, ""},
	}
	for _, tc := range cases {
		if got := ApproverIdentity(tc.user, tc.sa); got != tc.want {
			t.Errorf("ApproverIdentity(%q,%v) = %q, want %q", tc.user, tc.sa, got, tc.want)
		}
	}
}

func bindingWith(actions ...admissionregistrationv1.ValidationAction) *admissionregistrationv1.ValidatingAdmissionPolicyBinding {
	return &admissionregistrationv1.ValidatingAdmissionPolicyBinding{
		ObjectMeta: metav1.ObjectMeta{Name: ApprovalByBindingName},
		Spec:       admissionregistrationv1.ValidatingAdmissionPolicyBindingSpec{PolicyName: "p", ValidationActions: actions},
	}
}

func TestApprovalByVerifier_FollowsBinding(t *testing.T) {
	forbidden := func(a k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewForbidden(schema.GroupResource{Resource: "validatingadmissionpolicybindings"}, ApprovalByBindingName, nil)
	}
	cases := []struct {
		name    string
		cs      *k8sfake.Clientset
		reactor k8stesting.ReactionFunc
		want    bool
	}{
		{"binding present with Deny", k8sfake.NewSimpleClientset(bindingWith(admissionregistrationv1.Deny)), nil, true},
		{"binding absent (404)", k8sfake.NewSimpleClientset(), nil, false},
		{"403", k8sfake.NewSimpleClientset(bindingWith(admissionregistrationv1.Deny)), forbidden, false},
		{"binding that only warns", k8sfake.NewSimpleClientset(bindingWith(admissionregistrationv1.Warn)), nil, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.reactor != nil {
				tc.cs.PrependReactor("get", "validatingadmissionpolicybindings", tc.reactor)
			}
			v := &ApprovalByVerifier{Clientset: func() (kubernetes.Interface, error) { return tc.cs, nil }}
			if got := v.Verified(context.Background()); got != tc.want {
				t.Fatalf("Verified = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestApprovalByVerifier_CachesAndRefreshesWithinFiveMinutes(t *testing.T) {
	cs := k8sfake.NewSimpleClientset()
	gets := 0
	cs.PrependReactor("get", "validatingadmissionpolicybindings", func(k8stesting.Action) (bool, runtime.Object, error) {
		gets++
		return false, nil, nil
	})
	now := time.Date(2026, 11, 12, 10, 0, 0, 0, time.UTC)
	v := &ApprovalByVerifier{Clientset: func() (kubernetes.Interface, error) { return cs, nil }, now: func() time.Time { return now }}
	ctx := context.Background()
	if v.Verified(ctx) {
		t.Fatal("verified without a binding")
	}
	// binding appears; the cached answer holds until the TTL ends
	_, _ = cs.AdmissionregistrationV1().ValidatingAdmissionPolicyBindings().Create(ctx, bindingWith(admissionregistrationv1.Deny), metav1.CreateOptions{})
	now = now.Add(4 * time.Minute)
	if v.Verified(ctx) || gets != 1 {
		t.Fatalf("cache not used: gets=%d", gets)
	}
	now = now.Add(2 * time.Minute)
	if !v.Verified(ctx) || gets != 2 {
		t.Fatalf("not refreshed after 5 minutes: gets=%d", gets)
	}
}

func TestApprovalByVerifier_NoClientIsFalse(t *testing.T) {
	v := &ApprovalByVerifier{Clientset: func() (kubernetes.Interface, error) { return nil, errors.New("no config") }}
	if v.Verified(context.Background()) {
		t.Fatal("verified without a client")
	}
}
