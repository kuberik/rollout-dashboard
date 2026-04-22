package kubernetes

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	rolloutv1alpha1 "github.com/kuberik/rollout-controller/api/v1alpha1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

func newTestClient(t *testing.T, initial ...client.Object) *Client {
	t.Helper()
	scheme := runtime.NewScheme()
	require.NoError(t, rolloutv1alpha1.AddToScheme(scheme))
	c := fake.NewClientBuilder().
		WithScheme(scheme).
		WithObjects(initial...).
		Build()
	return &Client{client: c}
}

func TestSetRetryAnnotation_SetsAnnotation(t *testing.T) {
	rollout := &rolloutv1alpha1.Rollout{
		ObjectMeta: metav1.ObjectMeta{Name: "app", Namespace: "ns"},
	}
	cli := newTestClient(t, rollout)

	require.NoError(t, cli.SetRetryAnnotation(context.Background(), "ns", "app"))

	got := &rolloutv1alpha1.Rollout{}
	require.NoError(t, cli.client.Get(context.Background(), client.ObjectKey{Name: "app", Namespace: "ns"}, got))
	val, ok := got.Annotations[rolloutv1alpha1.RetryAnnotation]
	require.True(t, ok, "retry annotation should be set")
	// Value should be a parseable RFC3339 timestamp (unique per invocation to aid
	// correlation in controller events).
	_, err := time.Parse(time.RFC3339Nano, val)
	require.NoError(t, err, "retry annotation value should be RFC3339Nano")
}

func TestSetRetryAnnotation_PreservesExistingAnnotations(t *testing.T) {
	rollout := &rolloutv1alpha1.Rollout{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "app",
			Namespace: "ns",
			Annotations: map[string]string{
				"rollout.kuberik.com/deploy-user": "alice",
			},
		},
	}
	cli := newTestClient(t, rollout)

	require.NoError(t, cli.SetRetryAnnotation(context.Background(), "ns", "app"))

	got := &rolloutv1alpha1.Rollout{}
	require.NoError(t, cli.client.Get(context.Background(), client.ObjectKey{Name: "app", Namespace: "ns"}, got))
	require.Equal(t, "alice", got.Annotations["rollout.kuberik.com/deploy-user"])
	require.Contains(t, got.Annotations, rolloutv1alpha1.RetryAnnotation)
}

func TestSetRetryAnnotation_RolloutMissing(t *testing.T) {
	cli := newTestClient(t)
	err := cli.SetRetryAnnotation(context.Background(), "ns", "missing")
	require.Error(t, err)
}
