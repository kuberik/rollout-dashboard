package kubernetes

import (
	"context"
	"log"
	"sync"
	"time"

	admissionregistrationv1 "k8s.io/api/admissionregistration/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// ApprovalByBindingName is the ValidatingAdmissionPolicyBinding that makes the
// API server reject an approval.kuberik.com/by that is not the requesting
// user (rollout-controller, APPROVALS-API.md section 6.4).
const ApprovalByBindingName = "kuberik-rolloutapproval-by"

const (
	approvalByTTL      = 5 * time.Minute // refresh at most this often
	approvalByErrorTTL = 30 * time.Second
)

// ApprovalByVerifier answers "can the by annotation be trusted on this
// cluster". It is true when the dashboard's OWN service account can get the
// by binding and that binding denies (a Warn/Audit-only binding would not stop
// a forged value). Missing binding, 404 or 403 -> false. The result is cached
// and refreshed at most every five minutes; transient errors are retried after
// 30 seconds.
type ApprovalByVerifier struct {
	// Clientset is the dashboard service account's clientset, never the user's.
	Clientset func() (kubernetes.Interface, error)

	mu      sync.Mutex
	value   bool
	expires time.Time
	now     func() time.Time
}

// Verified returns the cached answer, refreshing it when stale.
func (v *ApprovalByVerifier) Verified(ctx context.Context) bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	now := time.Now
	if v.now != nil {
		now = v.now
	}
	if now().Before(v.expires) {
		return v.value
	}
	ok, ttl := v.check(ctx)
	v.value, v.expires = ok, now().Add(ttl)
	return ok
}

func (v *ApprovalByVerifier) check(ctx context.Context) (bool, time.Duration) {
	cs, err := v.Clientset()
	if err != nil {
		log.Printf("approval by-verification: no client: %v", err)
		return false, approvalByErrorTTL
	}
	b, err := cs.AdmissionregistrationV1().ValidatingAdmissionPolicyBindings().Get(ctx, ApprovalByBindingName, metav1.GetOptions{})
	if err != nil {
		if apierrors.IsNotFound(err) || apierrors.IsForbidden(err) {
			return false, approvalByTTL
		}
		log.Printf("approval by-verification: get binding: %v", err)
		return false, approvalByErrorTTL
	}
	for _, a := range b.Spec.ValidationActions {
		if a == admissionregistrationv1.Deny {
			return true, approvalByTTL
		}
	}
	return false, approvalByTTL
}

// DefaultApprovalByVerifier checks with the process's own (service account)
// client.
var DefaultApprovalByVerifier = &ApprovalByVerifier{Clientset: func() (kubernetes.Interface, error) {
	c, err := GetDefaultClient()
	if err != nil {
		return nil, err
	}
	return c.GetClientset(), nil
}}
