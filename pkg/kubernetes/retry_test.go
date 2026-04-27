package kubernetes

import (
	"context"
	"testing"

	openkruisev1alpha1 "github.com/kuberik/openkruise-controller/api/v1alpha1"
	rolloutv1alpha1 "github.com/kuberik/rollout-controller/api/v1alpha1"
	"github.com/stretchr/testify/require"
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

func TestSetRetryAnnotation_RetryMode(t *testing.T) {
	rollout := &rolloutv1alpha1.Rollout{
		ObjectMeta: metav1.ObjectMeta{Name: "app", Namespace: "ns"},
	}
	cli := newTestClient(t, rollout)

	require.NoError(t, cli.SetRetryAnnotation(context.Background(), "ns", "app", openkruisev1alpha1.RetryModeRetry))

	got := &rolloutv1alpha1.Rollout{}
	require.NoError(t, cli.client.Get(context.Background(), client.ObjectKey{Name: "app", Namespace: "ns"}, got))
	require.Equal(t, "", got.Annotations[rolloutv1alpha1.RetryAnnotation])
	require.NotContains(t, got.Annotations, openkruisev1alpha1.RetryModeAnnotation)
}

func TestSetRetryAnnotation_SkipMode(t *testing.T) {
	rollout := &rolloutv1alpha1.Rollout{
		ObjectMeta: metav1.ObjectMeta{Name: "app", Namespace: "ns"},
	}
	cli := newTestClient(t, rollout)

	require.NoError(t, cli.SetRetryAnnotation(context.Background(), "ns", "app", openkruisev1alpha1.RetryModeSkip))

	got := &rolloutv1alpha1.Rollout{}
	require.NoError(t, cli.client.Get(context.Background(), client.ObjectKey{Name: "app", Namespace: "ns"}, got))
	require.Equal(t, "", got.Annotations[rolloutv1alpha1.RetryAnnotation])
	require.Equal(t, openkruisev1alpha1.RetryModeSkip, got.Annotations[openkruisev1alpha1.RetryModeAnnotation])
}

func TestSetRetryAnnotation_UnknownModeDefaultsToRetry(t *testing.T) {
	rollout := &rolloutv1alpha1.Rollout{
		ObjectMeta: metav1.ObjectMeta{Name: "app", Namespace: "ns"},
	}
	cli := newTestClient(t, rollout)

	require.NoError(t, cli.SetRetryAnnotation(context.Background(), "ns", "app", "bogus"))

	got := &rolloutv1alpha1.Rollout{}
	require.NoError(t, cli.client.Get(context.Background(), client.ObjectKey{Name: "app", Namespace: "ns"}, got))
	require.Equal(t, "", got.Annotations[rolloutv1alpha1.RetryAnnotation])
	require.NotContains(t, got.Annotations, openkruisev1alpha1.RetryModeAnnotation)
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

	require.NoError(t, cli.SetRetryAnnotation(context.Background(), "ns", "app", openkruisev1alpha1.RetryModeRetry))

	got := &rolloutv1alpha1.Rollout{}
	require.NoError(t, cli.client.Get(context.Background(), client.ObjectKey{Name: "app", Namespace: "ns"}, got))
	require.Equal(t, "alice", got.Annotations["rollout.kuberik.com/deploy-user"])
	require.Contains(t, got.Annotations, rolloutv1alpha1.RetryAnnotation)
}

func TestSetRetryAnnotation_RolloutMissing(t *testing.T) {
	cli := newTestClient(t)
	err := cli.SetRetryAnnotation(context.Background(), "ns", "missing", openkruisev1alpha1.RetryModeRetry)
	require.Error(t, err)
}
