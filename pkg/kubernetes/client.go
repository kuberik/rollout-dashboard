package kubernetes

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/errgroup"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"
	k8sptr "k8s.io/utils/ptr"
	"sigs.k8s.io/cli-utils/pkg/kstatus/status"
	"sigs.k8s.io/cli-utils/pkg/object"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/apiutil"

	imagereflectorv1beta2 "github.com/fluxcd/image-reflector-controller/api/v1beta2"
	kustomizev1 "github.com/fluxcd/kustomize-controller/api/v1"
	sourcev1 "github.com/fluxcd/source-controller/api/v1"
	envv1alpha1 "github.com/kuberik/environment-controller/api/v1alpha1"
	openkruisev1alpha1 "github.com/kuberik/openkruise-controller/api/v1alpha1"
	rolloutv1alpha1 "github.com/kuberik/rollout-controller/api/v1alpha1"
	kruiserolloutv1beta1 "github.com/openkruise/kruise-rollout-api/rollouts/v1beta1"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/fields"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

type Client struct {
	client    client.Client
	config    *rest.Config // Store REST config for SelfSubjectAccessReview
	clientset *kubernetes.Clientset
}

// GetClientset returns the Kubernetes clientset for direct API access
func (c *Client) GetClientset() *kubernetes.Clientset {
	return c.clientset
}

// baseRestConfig returns the ambient REST config for this pod: in-cluster
// service-account config first, falling back to a local kubeconfig (dev only).
// This never carries a per-user bearer token — see restConfigWithToken.
func baseRestConfig() (*rest.Config, error) {
	config, err := rest.InClusterConfig()
	if err == nil {
		return config, nil
	}

	var kubeconfig string
	if home := homedir.HomeDir(); home != "" {
		kubeconfig = filepath.Join(home, ".kube", "config")
	} else {
		kubeconfig = os.Getenv("KUBECONFIG")
	}

	config, err = clientcmd.BuildConfigFromFlags("", kubeconfig)
	if err != nil {
		return nil, fmt.Errorf("failed to get kubeconfig: %w", err)
	}
	return config, nil
}

// restConfigWithToken returns baseRestConfig with the bearer token swapped for
// the given OIDC token (host/CA/timeouts otherwise unchanged). Empty token
// returns the base config unmodified (service-account/default auth).
func restConfigWithToken(token string) (*rest.Config, error) {
	base, err := baseRestConfig()
	if err != nil {
		return nil, err
	}
	if token == "" {
		return base, nil
	}
	return &rest.Config{
		Host:            base.Host,
		APIPath:         base.APIPath,
		ContentConfig:   base.ContentConfig,
		BearerToken:     token,
		BearerTokenFile: "", // Clear BearerTokenFile when using BearerToken
		TLSClientConfig: base.TLSClientConfig,
		UserAgent:       base.UserAgent,
		QPS:             base.QPS,
		Burst:           base.Burst,
		Timeout:         base.Timeout,
	}, nil
}

// buildScheme registers every group this dashboard reads or writes. Called
// once — see sharedSchemeAndMapper.
func buildScheme() (*runtime.Scheme, error) {
	scheme := runtime.NewScheme()

	if err := corev1.AddToScheme(scheme); err != nil {
		return nil, fmt.Errorf("failed to add core scheme: %w", err)
	}
	if err := appsv1.AddToScheme(scheme); err != nil {
		return nil, fmt.Errorf("failed to add apps scheme: %w", err)
	}
	if err := envv1alpha1.AddToScheme(scheme); err != nil {
		return nil, fmt.Errorf("failed to add environment scheme: %w", err)
	}
	if err := openkruisev1alpha1.AddToScheme(scheme); err != nil {
		return nil, fmt.Errorf("failed to add openkruise scheme: %w", err)
	}
	if err := rolloutv1alpha1.AddToScheme(scheme); err != nil {
		return nil, fmt.Errorf("failed to add scheme: %w", err)
	}
	if err := imagereflectorv1beta2.AddToScheme(scheme); err != nil {
		return nil, fmt.Errorf("failed to add image reflector scheme: %w", err)
	}
	if err := kustomizev1.AddToScheme(scheme); err != nil {
		return nil, fmt.Errorf("failed to add kustomize scheme: %w", err)
	}
	if err := sourcev1.AddToScheme(scheme); err != nil {
		return nil, fmt.Errorf("failed to add source scheme: %w", err)
	}
	if err := kruiserolloutv1beta1.AddToScheme(scheme); err != nil {
		return nil, fmt.Errorf("failed to add kruise rollout scheme: %w", err)
	}

	return scheme, nil
}

var (
	schemeMapperOnce sync.Once
	sharedScheme     *runtime.Scheme
	sharedMapper     meta.RESTMapper
	schemeMapperErr  error
)

// sharedSchemeAndMapper builds (once, for the process lifetime) the Scheme and
// dynamic RESTMapper every client — read or write, any identity — reuses.
//
// This is the fix for PERF-2026-09-04 finding #2: building a client.Client
// without an explicit Mapper makes controller-runtime run full API discovery
// to build a fresh dynamic RESTMapper on every call, which used to happen on
// every authenticated HTTP request (one per signed-in user per request). The
// RESTMapper only describes GVK<->GVR shape for this cluster's installed
// APIs — it carries no per-user identity or authorization — so it is safe and
// correct to share across every client this process builds, including
// per-request, per-user write clients. Discovery is done once, under the
// dashboard's own service-account config (guaranteed discovery access),
// regardless of which identity asks for it first.
func sharedSchemeAndMapper() (*runtime.Scheme, meta.RESTMapper, error) {
	schemeMapperOnce.Do(func() {
		sharedScheme, schemeMapperErr = buildScheme()
		if schemeMapperErr != nil {
			return
		}
		cfg, err := baseRestConfig()
		if err != nil {
			schemeMapperErr = fmt.Errorf("failed to build base rest config for discovery: %w", err)
			return
		}
		httpClient, err := rest.HTTPClientFor(cfg)
		if err != nil {
			schemeMapperErr = fmt.Errorf("failed to build discovery http client: %w", err)
			return
		}
		sharedMapper, err = apiutil.NewDynamicRESTMapper(cfg, httpClient)
		if err != nil {
			schemeMapperErr = fmt.Errorf("failed to build dynamic RESTMapper: %w", err)
			return
		}
	})
	return sharedScheme, sharedMapper, schemeMapperErr
}

// NewClient creates a Kubernetes client using service account credentials (in-cluster) or kubeconfig
func NewClient() (*Client, error) {
	return NewClientWithToken("")
}

// NewClientWithToken creates a Kubernetes client using the provided OIDC token.
// If token is empty, falls back to service account credentials (in-cluster) or
// kubeconfig.
//
// Cheap to call per request: the Scheme and RESTMapper are built once
// (sharedSchemeAndMapper) and reused here, so this only builds a fresh
// rest.Config (cheap — no network call) plus a client.New/clientset
// construction that does no discovery of its own. Callers needing a
// long-lived, cache-backed reader should prefer GetReadClient/GetDefaultClient
// instead of calling this directly — see context.go for the read/write split.
func NewClientWithToken(token string) (*Client, error) {
	config, err := restConfigWithToken(token)
	if err != nil {
		return nil, err
	}

	scheme, mapper, err := sharedSchemeAndMapper()
	if err != nil {
		return nil, fmt.Errorf("failed to build shared scheme/mapper: %w", err)
	}

	cl, err := client.New(config, client.Options{Scheme: scheme, Mapper: mapper})
	if err != nil {
		return nil, fmt.Errorf("failed to create client: %w", err)
	}

	// Create Kubernetes clientset for pod logs
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create clientset: %w", err)
	}

	return &Client{client: cl, config: config, clientset: clientset}, nil
}

func (c *Client) GetRollouts(ctx context.Context, namespace string) (*rolloutv1alpha1.RolloutList, error) {
	rollouts := &rolloutv1alpha1.RolloutList{}
	if err := c.client.List(ctx, rollouts, client.InNamespace(namespace)); err != nil {
		return nil, fmt.Errorf("failed to list rollouts: %w", err)
	}
	return rollouts, nil
}

// New: list rollouts across all namespaces
func (c *Client) GetRolloutsAllNamespaces(ctx context.Context) (*rolloutv1alpha1.RolloutList, error) {
	rollouts := &rolloutv1alpha1.RolloutList{}
	if err := c.client.List(ctx, rollouts); err != nil {
		return nil, fmt.Errorf("failed to list rollouts across all namespaces: %w", err)
	}
	return rollouts, nil
}

func (c *Client) GetRollout(ctx context.Context, namespace, name string) (*rolloutv1alpha1.Rollout, error) {
	rollout := &rolloutv1alpha1.Rollout{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, rollout); err != nil {
		return nil, fmt.Errorf("failed to get rollout: %w", err)
	}
	return rollout, nil
}

func (c *Client) UpdateRolloutVersion(ctx context.Context, namespace, name string, version *string, explanation string) (*rolloutv1alpha1.Rollout, error) {
	// Create an unstructured patch object with the spec.wantedVersion field and annotations
	patch := &unstructured.Unstructured{}
	patch.SetGroupVersionKind(schema.GroupVersionKind{
		Group:   "kuberik.com",
		Version: "v1alpha1",
		Kind:    "Rollout",
	})
	patch.SetNamespace(namespace)
	patch.SetName(name)

	// Set the wantedVersion field
	if version != nil {
		patch.Object["spec"] = map[string]any{
			"wantedVersion": *version,
		}
	} else {
		// If version is nil, we're clearing the field
		patch.Object["spec"] = map[string]any{
			"wantedVersion": nil,
		}
	}

	// Set annotations if explanation is provided
	annotations := map[string]string{}
	if explanation != "" {
		annotations["rollout.kuberik.com/deploy-message"] = explanation
	}

	// Get user info and set deploy-user annotation if available and not a service account
	if username, isServiceAccount, err := c.GetCurrentUserIdentity(ctx); err == nil && !isServiceAccount && username != "" {
		annotations["rollout.kuberik.com/deploy-user"] = username
	}

	if len(annotations) > 0 {
		patch.SetAnnotations(annotations)
	}

	// Use server-side apply to update the wantedVersion field and annotations
	// This ensures proper field ownership and prevents conflicts
	// If the dashboard doesn't own the field, the patch will fail naturally
	if err := c.client.Patch(ctx, patch, client.Merge, client.FieldOwner("rollout-dashboard")); err != nil {
		return nil, fmt.Errorf("failed to update rollout wantedVersion using server-side apply: %w", err)
	}

	// Get the updated rollout to return
	updatedRollout := &rolloutv1alpha1.Rollout{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, updatedRollout); err != nil {
		return nil, fmt.Errorf("failed to get updated rollout: %w", err)
	}

	return updatedRollout, nil
}

// ContinueKruiseRollout updates the currentStepState of an OpenKruise rollout to continue the rollout
func (c *Client) ContinueKruiseRollout(ctx context.Context, namespace, name string) (*kruiserolloutv1beta1.Rollout, error) {
	// Create an unstructured patch object with the status.currentStepState field
	patch := &unstructured.Unstructured{}
	patch.SetGroupVersionKind(schema.GroupVersionKind{
		Group:   "rollouts.kruise.io",
		Version: "v1beta1",
		Kind:    "Rollout",
	})
	patch.SetNamespace(namespace)
	patch.SetName(name)

	// Set the currentStepState to StepReady to continue the rollout
	patch.Object["status"] = map[string]any{
		"canaryStatus": map[string]any{
			"currentStepState": kruiserolloutv1beta1.CanaryStepStateReady,
		},
	}

	// Use server-side apply to update the status field
	if err := c.client.Status().Patch(ctx, patch, client.Merge, client.FieldOwner("rollout-dashboard")); err != nil {
		return nil, fmt.Errorf("failed to continue kruise rollout using server-side apply: %w", err)
	}

	// Get the updated rollout to return
	updatedRollout := &kruiserolloutv1beta1.Rollout{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, updatedRollout); err != nil {
		return nil, fmt.Errorf("failed to get updated kruise rollout: %w", err)
	}

	return updatedRollout, nil
}

// ClearKruiseRolloutStalledCondition sets the Stalled condition on a kruise rollout to False
// and resets the step started-at annotation so the step timeout window is refreshed.
// This allows the rollouttest controller to create new jobs after a retry.
func (c *Client) ClearKruiseRolloutStalledCondition(ctx context.Context, namespace, name string) error {
	rollout := &kruiserolloutv1beta1.Rollout{}

	// Update annotation with retry on conflict
	for attempt := 0; attempt < 5; attempt++ {
		if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, rollout); err != nil {
			return fmt.Errorf("failed to get kruise rollout: %w", err)
		}

		// Reset the step started-at annotation to now so the timeout window is refreshed
		stepIndex := rollout.Status.CanaryStatus.CurrentStepIndex
		startedAtKey := fmt.Sprintf("internal.rollout.kuberik.io/step-%d-started-at", stepIndex)
		annotations := rollout.GetAnnotations()
		if annotations == nil {
			annotations = make(map[string]string)
		}
		annotations[startedAtKey] = time.Now().UTC().Format(time.RFC3339)
		rollout.SetAnnotations(annotations)
		err := c.client.Update(ctx, rollout)
		if err == nil {
			break
		}
		if !strings.Contains(err.Error(), "the object has been modified") {
			return fmt.Errorf("failed to reset step started-at annotation: %w", err)
		}
		if attempt == 4 {
			return fmt.Errorf("failed to reset step started-at annotation after retries: %w", err)
		}
	}

	// Clear the stalled condition with retry on conflict
	for attempt := 0; attempt < 5; attempt++ {
		// Re-fetch on each attempt to get latest resource version
		if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, rollout); err != nil {
			return fmt.Errorf("failed to re-get kruise rollout: %w", err)
		}

		found := false
		for i, cond := range rollout.Status.Conditions {
			if cond.Type == kruiserolloutv1beta1.RolloutConditionType("Stalled") && cond.Status == corev1.ConditionTrue {
				rollout.Status.Conditions[i].Status = corev1.ConditionFalse
				rollout.Status.Conditions[i].Reason = "RetryRequested"
				rollout.Status.Conditions[i].Message = "Stalled condition cleared by rollout-dashboard retry"
				rollout.Status.Conditions[i].LastUpdateTime = metav1.Now()
				rollout.Status.Conditions[i].LastTransitionTime = metav1.Now()
				found = true
			}
		}

		if !found {
			return nil
		}

		err := c.client.Status().Update(ctx, rollout)
		if err == nil {
			return nil
		}
		if !strings.Contains(err.Error(), "the object has been modified") {
			return fmt.Errorf("failed to clear stalled condition on kruise rollout: %w", err)
		}
		// Conflict — retry with fresh fetch
	}
	return fmt.Errorf("failed to clear stalled condition after retries: resource conflict")
}

// SetRetryAnnotation patches the Rollout with the rollout.kuberik.com/retry annotation
// (presence-only trigger consumed by rollout-controller) and, when mode is "skip",
// also sets rollouttest.kuberik.com/retry-mode so the openkruise stepgate marks
// failed RolloutTests as Skipped instead of re-running them.
func (c *Client) SetRetryAnnotation(ctx context.Context, namespace, name, mode string) error {
	if mode != openkruisev1alpha1.RetryModeRetry && mode != openkruisev1alpha1.RetryModeSkip {
		mode = openkruisev1alpha1.RetryModeRetry
	}
	rollout := &rolloutv1alpha1.Rollout{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, rollout); err != nil {
		return fmt.Errorf("failed to get rollout: %w", err)
	}
	patchBase := rollout.DeepCopy()
	if rollout.Annotations == nil {
		rollout.Annotations = map[string]string{}
	}
	rollout.Annotations[rolloutv1alpha1.RetryAnnotation] = ""
	if mode == openkruisev1alpha1.RetryModeSkip {
		rollout.Annotations[openkruisev1alpha1.RetryModeAnnotation] = mode
	} else {
		// Explicitly remove any stale mode annotation so a previous "skip" retry
		// cannot bleed into this retry. MergeFrom encodes the deletion as null.
		delete(rollout.Annotations, openkruisev1alpha1.RetryModeAnnotation)
	}
	if err := c.client.Patch(ctx, rollout, client.MergeFrom(patchBase)); err != nil {
		return fmt.Errorf("failed to set retry annotation: %w", err)
	}
	return nil
}

// ResetBakeStatusToDeploying resets the rollout's bake status to "Deploying"
// This should be called when continuing a rollout to indicate a new deployment phase
func (c *Client) ResetBakeStatusToDeploying(ctx context.Context, namespace, name string) (*rolloutv1alpha1.Rollout, error) {
	// Get the current rollout
	rollout := &rolloutv1alpha1.Rollout{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, rollout); err != nil {
		return nil, fmt.Errorf("failed to get rollout: %w", err)
	}

	// Check if there's a history entry to modify
	if len(rollout.Status.History) == 0 {
		return nil, fmt.Errorf("no deployment history found")
	}

	// Update the latest history entry to reset bake status
	latestEntry := &rollout.Status.History[0]
	latestEntry.BakeStatus = k8sptr.To(rolloutv1alpha1.BakeStatusDeploying)
	latestEntry.BakeStatusMessage = nil
	latestEntry.BakeEndTime = nil

	// Update the rollout status
	if err := c.client.Status().Update(ctx, rollout); err != nil {
		return nil, fmt.Errorf("failed to update rollout status: %w", err)
	}

	return rollout, nil
}

// ResetHealthChecksToPending resets all health checks matching the rollout's selector to "Pending"
// This should be called when continuing a rollout to reset health monitoring
func (c *Client) ResetHealthChecksToPending(ctx context.Context, namespace, name string) error {
	// Get the rollout to access its health check selector
	rollout := &rolloutv1alpha1.Rollout{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, rollout); err != nil {
		return fmt.Errorf("failed to get rollout: %w", err)
	}

	// If there's no health check selector, nothing to reset
	if rollout.Spec.HealthCheckSelector == nil {
		return nil
	}

	// Get all matching health checks
	healthChecks, err := c.GetHealthChecksBySelector(ctx, namespace, rollout.Spec.HealthCheckSelector)
	if err != nil {
		return fmt.Errorf("failed to get health checks: %w", err)
	}

	// Reset each health check to Pending
	now := metav1.Now()
	for i := range healthChecks {
		hc := &healthChecks[i]
		hc.Status.Status = rolloutv1alpha1.HealthStatusPending
		resetMessage := "Health check reset due to rollout continuation"
		hc.Status.Message = &resetMessage
		hc.Status.LastChangeTime = &now
		hc.Status.LastErrorTime = nil

		if err := c.client.Status().Update(ctx, hc); err != nil {
			return fmt.Errorf("failed to reset health check %s/%s: %w", hc.Namespace, hc.Name, err)
		}
	}

	return nil
}

// AddBypassGatesAnnotation adds the rollout.kuberik.com/bypass-gates annotation to a rollout
// This allows the rollout to bypass gate checks for a specific version
func (c *Client) AddBypassGatesAnnotation(ctx context.Context, namespace, name string, version string) (*rolloutv1alpha1.Rollout, error) {
	// Create an unstructured patch object with only the annotation
	patch := &unstructured.Unstructured{}
	patch.SetGroupVersionKind(schema.GroupVersionKind{
		Group:   "kuberik.com",
		Version: "v1alpha1",
		Kind:    "Rollout",
	})
	patch.SetNamespace(namespace)
	patch.SetName(name)

	// Set the bypass-gates annotation with the specific version
	patch.SetAnnotations(map[string]string{
		"rollout.kuberik.com/bypass-gates": version,
	})

	// Use server-side apply to update only the annotation
	if err := c.client.Patch(ctx, patch, client.Merge, client.FieldOwner("rollout-dashboard")); err != nil {
		return nil, fmt.Errorf("failed to add bypass-gates annotation using server-side apply: %w", err)
	}

	// Get the updated rollout to return
	updatedRollout := &rolloutv1alpha1.Rollout{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, updatedRollout); err != nil {
		return nil, fmt.Errorf("failed to get updated rollout: %w", err)
	}

	return updatedRollout, nil
}

// AddForceDeployAnnotation adds the rollout.kuberik.com/force-deploy annotation to a rollout
// This allows the rollout to force deploy a specific version
// Optionally includes a message explaining why the force deploy was triggered
func (c *Client) AddForceDeployAnnotation(ctx context.Context, namespace, name string, version string, message string) (*rolloutv1alpha1.Rollout, error) {
	// Create an unstructured patch object with only the annotation
	patch := &unstructured.Unstructured{}
	patch.SetGroupVersionKind(schema.GroupVersionKind{
		Group:   "kuberik.com",
		Version: "v1alpha1",
		Kind:    "Rollout",
	})
	patch.SetNamespace(namespace)
	patch.SetName(name)

	// Set the force-deploy annotation with the specific version
	annotations := map[string]string{
		"rollout.kuberik.com/force-deploy": version,
	}

	// Add message annotation if provided
	if message != "" {
		annotations["rollout.kuberik.com/deploy-message"] = message
	}

	// Get user info and set deploy-user annotation if available and not a service account
	if username, isServiceAccount, err := c.GetCurrentUserIdentity(ctx); err == nil && !isServiceAccount && username != "" {
		annotations["rollout.kuberik.com/deploy-user"] = username
	}

	patch.SetAnnotations(annotations)

	// Use server-side apply to update only the annotation
	if err := c.client.Patch(ctx, patch, client.Merge, client.FieldOwner("rollout-dashboard")); err != nil {
		return nil, fmt.Errorf("failed to add force-deploy annotation using server-side apply: %w", err)
	}

	// Get the updated rollout to return
	updatedRollout := &rolloutv1alpha1.Rollout{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, updatedRollout); err != nil {
		return nil, fmt.Errorf("failed to get updated rollout: %w", err)
	}

	return updatedRollout, nil
}

// ChangeVersion updates the rollout version with an option to pin or unpin atomically.
// When pin is true, it sets spec.wantedVersion to the version and optionally sets a deploy message.
// When pin is false, it adds the force-deploy annotation for the version and clears spec.wantedVersion
// in the same server-side apply operation, optionally setting a deploy message.
func (c *Client) ChangeVersion(ctx context.Context, namespace, name string, version string, pin bool, message string) (*rolloutv1alpha1.Rollout, error) {
	patch := &unstructured.Unstructured{}
	patch.SetGroupVersionKind(schema.GroupVersionKind{
		Group:   "kuberik.com",
		Version: "v1alpha1",
		Kind:    "Rollout",
	})
	patch.SetNamespace(namespace)
	patch.SetName(name)

	annotations := map[string]string{}
	if message != "" {
		annotations["rollout.kuberik.com/deploy-message"] = message
	}

	// Get user info and set deploy-user annotation if available and not a service account
	if username, isServiceAccount, err := c.GetCurrentUserIdentity(ctx); err == nil && !isServiceAccount && username != "" {
		annotations["rollout.kuberik.com/deploy-user"] = username
	}

	if pin {
		// Pin: set wantedVersion to the specified version
		patch.Object["spec"] = map[string]any{
			"wantedVersion": version,
		}
	} else {
		// Unpin with change: add force-deploy annotation and clear wantedVersion
		annotations["rollout.kuberik.com/force-deploy"] = version
		patch.Object["spec"] = map[string]any{
			"wantedVersion": nil,
		}
	}

	if len(annotations) > 0 {
		patch.SetAnnotations(annotations)
	}

	if err := c.client.Patch(ctx, patch, client.Merge, client.FieldOwner("rollout-dashboard")); err != nil {
		return nil, fmt.Errorf("failed to change version using server-side apply: %w", err)
	}

	updatedRollout := &rolloutv1alpha1.Rollout{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, updatedRollout); err != nil {
		return nil, fmt.Errorf("failed to get updated rollout: %w", err)
	}

	return updatedRollout, nil
}

// AddUnblockFailedAnnotation adds the rollout.kuberik.com/unblock-failed annotation to a rollout
// This allows the rollout to resume after a failed bake
func (c *Client) AddUnblockFailedAnnotation(ctx context.Context, namespace, name string) (*rolloutv1alpha1.Rollout, error) {
	// Create an unstructured patch object with only the annotation
	patch := &unstructured.Unstructured{}
	patch.SetGroupVersionKind(schema.GroupVersionKind{
		Group:   "kuberik.com",
		Version: "v1alpha1",
		Kind:    "Rollout",
	})
	patch.SetNamespace(namespace)
	patch.SetName(name)

	// Set the unblock-failed annotation to true
	patch.SetAnnotations(map[string]string{
		"rollout.kuberik.com/unblock-failed": "true",
	})

	// Use server-side apply to update only the annotation
	if err := c.client.Patch(ctx, patch, client.Merge, client.FieldOwner("rollout-dashboard")); err != nil {
		return nil, fmt.Errorf("failed to add unblock-failed annotation using server-side apply: %w", err)
	}

	// Get the updated rollout to return
	updatedRollout := &rolloutv1alpha1.Rollout{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, updatedRollout); err != nil {
		return nil, fmt.Errorf("failed to get updated rollout: %w", err)
	}

	return updatedRollout, nil
}

// MarkDeploymentSuccessful marks the latest deployment as successful by updating the rollout status
func (c *Client) MarkDeploymentSuccessful(ctx context.Context, namespace, name string, message string) (*rolloutv1alpha1.Rollout, error) {
	// Get the current rollout to access the latest history entry
	rollout := &rolloutv1alpha1.Rollout{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, rollout); err != nil {
		return nil, fmt.Errorf("failed to get rollout: %w", err)
	}

	// Check if there's a history entry to modify
	if len(rollout.Status.History) == 0 {
		return nil, fmt.Errorf("no deployment history found")
	}

	// Update the latest history entry to mark it as successful
	latestEntry := &rollout.Status.History[0]
	now := metav1.Now()
	latestEntry.BakeStatus = k8sptr.To(rolloutv1alpha1.BakeStatusSucceeded)
	latestEntry.BakeEndTime = &now

	// Create status message with fixed prefix
	statusMessage := "Deployment manually marked as successful by user"
	if message != "" {
		statusMessage = fmt.Sprintf("Deployment manually marked as successful by user: %s", message)
	}
	latestEntry.BakeStatusMessage = &statusMessage

	// Update the Ready condition
	readyConditionMessage := "Deployment manually marked as successful by user"
	if message != "" {
		readyConditionMessage = fmt.Sprintf("Deployment manually marked as successful by user: %s", message)
	}

	// Initialize conditions slice if nil
	if rollout.Status.Conditions == nil {
		rollout.Status.Conditions = []metav1.Condition{}
	}

	// Use meta.SetStatusCondition to update the Ready condition
	// This handles finding/updating/creating the condition and managing LastTransitionTime correctly
	meta.SetStatusCondition(&rollout.Status.Conditions, metav1.Condition{
		Type:               "Ready",
		Status:             metav1.ConditionTrue,
		Reason:             "DeploymentMarkedSuccessful",
		Message:            readyConditionMessage,
		ObservedGeneration: rollout.Generation,
		LastTransitionTime: metav1.Now(),
	})

	// Update the rollout status
	if err := c.client.Status().Update(ctx, rollout); err != nil {
		return nil, fmt.Errorf("failed to update rollout status: %w", err)
	}

	return rollout, nil
}

func (c *Client) GetSecret(ctx context.Context, namespace, name string) (*corev1.Secret, error) {
	secret := &corev1.Secret{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, secret); err != nil {
		return nil, fmt.Errorf("failed to get secret: %w", err)
	}
	return secret, nil
}

func (c *Client) GetImagePolicies(ctx context.Context, namespace string) (*imagereflectorv1beta2.ImagePolicyList, error) {
	imagePolicies := &imagereflectorv1beta2.ImagePolicyList{}
	if err := c.client.List(ctx, imagePolicies, client.InNamespace(namespace)); err != nil {
		return nil, fmt.Errorf("failed to list image policies: %w", err)
	}
	return imagePolicies, nil
}

// New: list image policies across all namespaces
func (c *Client) GetImagePoliciesAllNamespaces(ctx context.Context) (*imagereflectorv1beta2.ImagePolicyList, error) {
	imagePolicies := &imagereflectorv1beta2.ImagePolicyList{}
	if err := c.client.List(ctx, imagePolicies); err != nil {
		return nil, fmt.Errorf("failed to list image policies across all namespaces: %w", err)
	}
	return imagePolicies, nil
}

func (c *Client) GetImageRepositories(ctx context.Context, namespace string) (*imagereflectorv1beta2.ImageRepositoryList, error) {
	imageRepositories := &imagereflectorv1beta2.ImageRepositoryList{}
	if err := c.client.List(ctx, imageRepositories, client.InNamespace(namespace)); err != nil {
		return nil, fmt.Errorf("failed to list image repositories: %w", err)
	}
	return imageRepositories, nil
}

// New: list image repositories across all namespaces
func (c *Client) GetImageRepositoriesAllNamespaces(ctx context.Context) (*imagereflectorv1beta2.ImageRepositoryList, error) {
	imageRepositories := &imagereflectorv1beta2.ImageRepositoryList{}
	if err := c.client.List(ctx, imageRepositories); err != nil {
		return nil, fmt.Errorf("failed to list image repositories across all namespaces: %w", err)
	}
	return imageRepositories, nil
}

func (c *Client) GetKustomizations(ctx context.Context, namespace string) (*kustomizev1.KustomizationList, error) {
	kustomizations := &kustomizev1.KustomizationList{}
	if err := c.client.List(ctx, kustomizations, client.InNamespace(namespace)); err != nil {
		return nil, fmt.Errorf("failed to list kustomizations: %w", err)
	}
	return kustomizations, nil
}

// New: list kustomizations across all namespaces
func (c *Client) GetKustomizationsAllNamespaces(ctx context.Context) (*kustomizev1.KustomizationList, error) {
	kustomizations := &kustomizev1.KustomizationList{}
	if err := c.client.List(ctx, kustomizations); err != nil {
		return nil, fmt.Errorf("failed to list kustomizations across all namespaces: %w", err)
	}
	return kustomizations, nil
}

func (c *Client) GetOCIRepositories(ctx context.Context, namespace string) (*sourcev1.OCIRepositoryList, error) {
	ociRepositories := &sourcev1.OCIRepositoryList{}
	if err := c.client.List(ctx, ociRepositories, client.InNamespace(namespace)); err != nil {
		return nil, fmt.Errorf("failed to list OCI repositories: %w", err)
	}
	return ociRepositories, nil
}

// New: list OCI repositories across all namespaces
func (c *Client) GetOCIRepositoriesAllNamespaces(ctx context.Context) (*sourcev1.OCIRepositoryList, error) {
	ociRepositories := &sourcev1.OCIRepositoryList{}
	if err := c.client.List(ctx, ociRepositories); err != nil {
		return nil, fmt.Errorf("failed to list OCI repositories across all namespaces: %w", err)
	}
	return ociRepositories, nil
}

func (c *Client) GetImagePolicy(ctx context.Context, namespace, name string) (*imagereflectorv1beta2.ImagePolicy, error) {
	imagePolicy := &imagereflectorv1beta2.ImagePolicy{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, imagePolicy); err != nil {
		return nil, fmt.Errorf("failed to get image policy: %w", err)
	}
	return imagePolicy, nil
}

func (c *Client) GetImageRepository(ctx context.Context, namespace, name string) (*imagereflectorv1beta2.ImageRepository, error) {
	imageRepository := &imagereflectorv1beta2.ImageRepository{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, imageRepository); err != nil {
		return nil, fmt.Errorf("failed to get image repository: %w", err)
	}
	return imageRepository, nil
}

func (c *Client) GetKustomizationsByRolloutAnnotation(ctx context.Context, namespace, rolloutName string) (*kustomizev1.KustomizationList, error) {
	kustomizations := &kustomizev1.KustomizationList{}
	if err := c.client.List(ctx, kustomizations, client.InNamespace(namespace)); err != nil {
		return nil, fmt.Errorf("failed to list kustomizations: %w", err)
	}

	// Get OCIRepositories that reference this rollout
	ociRepositories, err := c.GetOCIRepositoriesByRolloutAnnotation(ctx, namespace, rolloutName)
	if err != nil {
		return nil, fmt.Errorf("failed to get OCI repositories: %w", err)
	}

	return FilterKustomizationsByRolloutAnnotation(kustomizations, ociRepositories, rolloutName), nil
}

// FilterKustomizationsByRolloutAnnotation filters an already-fetched
// KustomizationList down to the kustomizations that reference rolloutName,
// either directly via a rollout.kuberik.com/substitute.<var>.from annotation
// or indirectly via an OCIRepository sourceRef that itself carries the
// rollout annotation (ociRepositories must already be filtered to that set,
// e.g. by GetOCIRepositoriesByRolloutAnnotation).
//
// Split out from GetKustomizationsByRolloutAnnotation so callers that need
// both the Kustomization and OCIRepository lists (main.go's rollout-detail
// handler) can share one OCIRepositories LIST instead of issuing it twice.
func FilterKustomizationsByRolloutAnnotation(kustomizations *kustomizev1.KustomizationList, ociRepositories *sourcev1.OCIRepositoryList, rolloutName string) *kustomizev1.KustomizationList {
	// Create a map of OCI repository names for quick lookup
	ociRepoNames := make(map[string]bool)
	for _, ociRepo := range ociRepositories.Items {
		ociRepoNames[ociRepo.Name] = true
	}

	// Filter kustomizations that reference the rollout through annotations
	// or reference OCIRepositories that have rollout annotations
	filteredKustomizations := &kustomizev1.KustomizationList{}
	for _, kustomization := range kustomizations.Items {
		// Check for rollout.kuberik.com/substitute.<variable>.from: <rollout> annotation
		// This format allows kustomizations to specify which rollout they get variables from
		// Example: rollout.kuberik.com/substitute.HELLO_WORLD_VERSION.from: "hello-world-app"
		for annotationKey, annotationValue := range kustomization.Annotations {
			if strings.HasPrefix(annotationKey, "rollout.kuberik.com/substitute.") &&
				strings.HasSuffix(annotationKey, ".from") &&
				annotationValue == rolloutName {
				filteredKustomizations.Items = append(filteredKustomizations.Items, kustomization)
				break
			}
		}

		// Check if this kustomization references an OCIRepository that has the rollout annotation
		if kustomization.Spec.SourceRef.Kind == "OCIRepository" &&
			kustomization.Spec.SourceRef.Name != "" &&
			ociRepoNames[kustomization.Spec.SourceRef.Name] {
			filteredKustomizations.Items = append(filteredKustomizations.Items, kustomization)
		}
	}

	return filteredKustomizations
}

func (c *Client) GetOCIRepositoriesByRolloutAnnotation(ctx context.Context, namespace, rolloutName string) (*sourcev1.OCIRepositoryList, error) {
	ociRepositories := &sourcev1.OCIRepositoryList{}
	if err := c.client.List(ctx, ociRepositories, client.InNamespace(namespace)); err != nil {
		return nil, fmt.Errorf("failed to list OCI repositories: %w", err)
	}

	// Filter OCI repositories that reference the rollout through annotations
	filteredOCIRepositories := &sourcev1.OCIRepositoryList{}
	for _, ociRepository := range ociRepositories.Items {
		// Check for rollout.kuberik.com/rollout annotation
		if annotationValue, exists := ociRepository.Annotations["rollout.kuberik.com/rollout"]; exists && annotationValue == rolloutName {
			filteredOCIRepositories.Items = append(filteredOCIRepositories.Items, ociRepository)
		}
	}

	return filteredOCIRepositories, nil
}

func (c *Client) GetRolloutTests(ctx context.Context, namespace string) (*openkruisev1alpha1.RolloutTestList, error) {
	rolloutTests := &openkruisev1alpha1.RolloutTestList{}
	if err := c.client.List(ctx, rolloutTests, client.InNamespace(namespace)); err != nil {
		return nil, fmt.Errorf("failed to list RolloutTests: %w", err)
	}
	return rolloutTests, nil
}

func (c *Client) GetKustomization(ctx context.Context, namespace, name string) (*kustomizev1.Kustomization, error) {
	kustomization := &kustomizev1.Kustomization{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, kustomization); err != nil {
		return nil, fmt.Errorf("failed to get kustomization: %w", err)
	}
	return kustomization, nil
}

type ManagedResourceStatus struct {
	GroupVersionKind string                     `json:"groupVersionKind"`
	Name             string                     `json:"name"`
	Namespace        string                     `json:"namespace"`
	Status           string                     `json:"status"`
	Message          string                     `json:"message"`
	LastModified     time.Time                  `json:"lastModified"`
	Object           *unstructured.Unstructured `json:"object"`
}

// managedResourceStatusFromObject computes the ManagedResourceStatus fields
// (LastModified, kstatus Status/Message) shared by both the batched-LIST path
// and the per-item GET fallback in GetKustomizationManagedResources.
func managedResourceStatusFromObject(obj *unstructured.Unstructured, gvkStr, name, namespace string) ManagedResourceStatus {
	lastModified := time.Time{}
	if managedFields := obj.GetManagedFields(); len(managedFields) > 0 {
		for _, field := range managedFields {
			if field.Time != nil && field.Time.Time.After(lastModified) {
				lastModified = field.Time.Time
			}
		}
	}

	result, err := status.Compute(obj)
	if err != nil {
		return ManagedResourceStatus{
			GroupVersionKind: gvkStr,
			Name:             name,
			Namespace:        namespace,
			Status:           "Error",
			Message:          fmt.Sprintf("Error computing status: %v", err),
			LastModified:     lastModified,
			Object:           obj,
		}
	}

	return ManagedResourceStatus{
		GroupVersionKind: gvkStr,
		Name:             name,
		Namespace:        namespace,
		Status:           string(result.Status),
		Message:          result.Message,
		LastModified:     lastModified,
		Object:           obj,
	}
}

// inventoryEntry is a parsed, valid inventory entry, indexed back into the
// caller's results slice so goroutines can write their slot without a mutex.
type inventoryEntry struct {
	idx     int
	objMeta object.ObjMetadata
	version string
}

// inventoryGroupKey batches inventory entries that can be fetched with a
// single LIST: same GVK, same namespace (or both cluster-scoped).
type inventoryGroupKey struct {
	Group     string
	Version   string
	Kind      string
	Namespace string
}

func (c *Client) GetKustomizationManagedResources(ctx context.Context, namespace, name string) ([]ManagedResourceStatus, error) {
	// Get the Kustomization
	kustomization := &kustomizev1.Kustomization{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, kustomization); err != nil {
		return nil, fmt.Errorf("failed to get kustomization: %w", err)
	}

	// Get the inventory from the Kustomization status
	if kustomization.Status.Inventory == nil {
		fmt.Printf("Kustomization %s/%s has no inventory\n", namespace, name)
		return []ManagedResourceStatus{}, nil
	}

	entries := kustomization.Status.Inventory.Entries
	fmt.Printf("Kustomization %s/%s inventory has %d entries\n", namespace, name, len(entries))

	// Fixed-size slot per entry — each goroutine writes its own index, no mutex needed.
	// nil slot means parse failed and entry was skipped.
	results := make([]*ManagedResourceStatus, len(entries))

	// Group entries by (Group, Version, Kind, Namespace) so resources of the
	// same kind in the same namespace are fetched with one LIST instead of
	// one GET each — this is the common case (a kustomization's inventory is
	// frequently several instances of the same Kind, e.g. multiple
	// ConfigMaps/Jobs/Deployments). Distinct kinds still cost one LIST each,
	// same as one GET each would have — this never does *more* round trips
	// than the old per-entry GET loop, and often does far fewer.
	groups := make(map[inventoryGroupKey][]inventoryEntry)
	for i, entry := range entries {
		objMetadata, err := object.ParseObjMetadata(entry.ID)
		if err != nil {
			fmt.Printf("Failed to parse inventory entry %s: %v\n", entry.ID, err)
			continue
		}
		key := inventoryGroupKey{
			Group:     objMetadata.GroupKind.Group,
			Version:   entry.Version,
			Kind:      objMetadata.GroupKind.Kind,
			Namespace: objMetadata.Namespace,
		}
		groups[key] = append(groups[key], inventoryEntry{idx: i, objMeta: objMetadata, version: entry.Version})
	}

	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(8)
	for key, group := range groups {
		key, group := key, group
		g.Go(func() error {
			gvkStr := fmt.Sprintf("%s/%s/%s", key.Group, key.Version, key.Kind)

			list := &unstructured.UnstructuredList{}
			list.SetGroupVersionKind(schema.GroupVersionKind{Group: key.Group, Version: key.Version, Kind: key.Kind + "List"})
			var listOpts []client.ListOption
			if key.Namespace != "" {
				listOpts = append(listOpts, client.InNamespace(key.Namespace))
			}

			if err := c.client.List(gctx, list, listOpts...); err != nil {
				// Fall back to a GET per entry in this group only — covers CRDs
				// or RBAC setups that support get but not list for this kind.
				fmt.Printf("Failed to list %s in namespace %s: %v, falling back to per-item GET\n", gvkStr, key.Namespace, err)
				for _, entry := range group {
					obj := &unstructured.Unstructured{}
					obj.SetGroupVersionKind(schema.GroupVersionKind{Group: key.Group, Version: key.Version, Kind: key.Kind})
					if getErr := c.client.Get(gctx, client.ObjectKey{Namespace: entry.objMeta.Namespace, Name: entry.objMeta.Name}, obj); getErr != nil {
						results[entry.idx] = &ManagedResourceStatus{
							GroupVersionKind: gvkStr,
							Name:             entry.objMeta.Name,
							Namespace:        entry.objMeta.Namespace,
							Status:           "NotFound",
							Message:          fmt.Sprintf("Resource not found: %v", getErr),
							LastModified:     time.Time{},
							Object:           nil,
						}
						continue
					}
					rs := managedResourceStatusFromObject(obj, gvkStr, entry.objMeta.Name, entry.objMeta.Namespace)
					results[entry.idx] = &rs
				}
				return nil
			}

			byName := make(map[string]*unstructured.Unstructured, len(list.Items))
			for i := range list.Items {
				byName[list.Items[i].GetName()] = &list.Items[i]
			}

			for _, entry := range group {
				obj, found := byName[entry.objMeta.Name]
				if !found {
					results[entry.idx] = &ManagedResourceStatus{
						GroupVersionKind: gvkStr,
						Name:             entry.objMeta.Name,
						Namespace:        entry.objMeta.Namespace,
						Status:           "NotFound",
						Message:          "Resource not found",
						LastModified:     time.Time{},
						Object:           nil,
					}
					continue
				}
				rs := managedResourceStatusFromObject(obj, gvkStr, entry.objMeta.Name, entry.objMeta.Namespace)
				results[entry.idx] = &rs
			}
			return nil
		})
	}
	_ = g.Wait()

	managedResources := make([]ManagedResourceStatus, 0, len(results))
	for _, r := range results {
		if r != nil {
			managedResources = append(managedResources, *r)
		}
	}

	// Sort managed resources by LastModified time (most recent first)
	sort.Slice(managedResources, func(i, j int) bool {
		return managedResources[i].LastModified.After(managedResources[j].LastModified)
	})

	return managedResources, nil
}

// GetHealthChecksBySelector returns health checks that match the given selector
func (c *Client) GetHealthChecksBySelector(ctx context.Context, namespace string, selector *rolloutv1alpha1.HealthCheckSelectorConfig) ([]rolloutv1alpha1.HealthCheck, error) {
	var healthChecks []rolloutv1alpha1.HealthCheck

	// If no selector is provided, return empty list
	if selector == nil {
		return healthChecks, nil
	}

	// Determine which namespaces to search
	var namespaces []string

	if selector.NamespaceSelector != nil {
		// Parse the namespace selector to find matching namespaces
		nsSelector, err := metav1.LabelSelectorAsSelector(selector.NamespaceSelector)
		if err != nil {
			// If we can't parse the namespace selector, log the error and default to same namespace
			fmt.Printf("Failed to parse namespace selector: %v, defaulting to same namespace\n", err)
			namespaces = []string{namespace}
		} else {
			// Get all namespaces and filter by the selector
			namespaceList := &corev1.NamespaceList{}
			if err := c.client.List(ctx, namespaceList); err != nil {
				fmt.Printf("Failed to list namespaces: %v, defaulting to same namespace\n", err)
				namespaces = []string{namespace}
			} else {
				// Filter namespaces by the selector
				for _, ns := range namespaceList.Items {
					if nsSelector.Matches(labels.Set(ns.Labels)) {
						namespaces = append(namespaces, ns.Name)
					}
				}
			}
		}
	} else {
		// No namespace selector specified, search only in the rollout's namespace
		namespaces = []string{namespace}
	}

	// If no namespaces found, default to the rollout's namespace
	if len(namespaces) == 0 {
		namespaces = []string{namespace}
	}

	// selector.Selector is a plain metav1.LabelSelector matched against each
	// HealthCheck's own labels — that's exactly what a List label selector
	// evaluates server-side, so push it down instead of listing every
	// HealthCheck in the namespace and matching labels in Go.
	var labelSelector labels.Selector
	if selector.Selector != nil {
		sel, err := metav1.LabelSelectorAsSelector(selector.Selector)
		if err != nil {
			fmt.Printf("Failed to parse label selector: %v\n", err)
			return healthChecks, nil
		}
		labelSelector = sel
	}

	// Search in each namespace
	for _, ns := range namespaces {
		healthCheckList := &rolloutv1alpha1.HealthCheckList{}
		listOpts := []client.ListOption{client.InNamespace(ns)}
		if labelSelector != nil {
			listOpts = append(listOpts, client.MatchingLabelsSelector{Selector: labelSelector})
		}
		if err := c.client.List(ctx, healthCheckList, listOpts...); err != nil {
			fmt.Printf("Failed to list health checks in namespace %s: %v\n", ns, err)
			continue // Skip this namespace if there's an error
		}

		healthChecks = append(healthChecks, healthCheckList.Items...)
	}

	return healthChecks, nil
}

// ReconcileKustomization adds the reconcile annotation to trigger a reconciliation
func (c *Client) ReconcileKustomization(ctx context.Context, namespace, name string) error {
	kustomization := &kustomizev1.Kustomization{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, kustomization); err != nil {
		return fmt.Errorf("failed to get kustomization: %w", err)
	}

	// Add the reconcile annotation with current timestamp
	if kustomization.Annotations == nil {
		kustomization.Annotations = make(map[string]string)
	}
	kustomization.Annotations["reconcile.fluxcd.io/requestedAt"] = fmt.Sprintf("%d", time.Now().Unix())

	if err := c.client.Update(ctx, kustomization); err != nil {
		return fmt.Errorf("failed to update kustomization: %w", err)
	}

	return nil
}

// ReconcileOCIRepository adds the reconcile annotation to trigger a reconciliation
func (c *Client) ReconcileOCIRepository(ctx context.Context, namespace, name string) error {
	ociRepository := &sourcev1.OCIRepository{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, ociRepository); err != nil {
		return fmt.Errorf("failed to get OCI repository: %w", err)
	}

	// Add the reconcile annotation with current timestamp
	if ociRepository.Annotations == nil {
		ociRepository.Annotations = make(map[string]string)
	}
	ociRepository.Annotations["reconcile.fluxcd.io/requestedAt"] = fmt.Sprintf("%d", time.Now().Unix())

	if err := c.client.Update(ctx, ociRepository); err != nil {
		return fmt.Errorf("failed to update OCI repository: %w", err)
	}

	return nil
}

// ReconcileImageRepository adds the reconcile annotation to trigger a reconciliation
func (c *Client) ReconcileImageRepository(ctx context.Context, namespace, name string) error {
	imageRepository := &imagereflectorv1beta2.ImageRepository{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, imageRepository); err != nil {
		return fmt.Errorf("failed to get image repository: %w", err)
	}

	// Add the reconcile annotation with current timestamp
	if imageRepository.Annotations == nil {
		imageRepository.Annotations = make(map[string]string)
	}
	imageRepository.Annotations["reconcile.fluxcd.io/requestedAt"] = fmt.Sprintf("%d", time.Now().Unix())

	if err := c.client.Update(ctx, imageRepository); err != nil {
		return fmt.Errorf("failed to update image repository: %w", err)
	}

	return nil
}

// ReconcileAllFluxResources reconciles all associated Flux resources for a rollout
// Returns the previous scanTime of the ImageRepository (if found) so the caller can detect completion
func (c *Client) ReconcileAllFluxResources(ctx context.Context, namespace, rolloutName string) (previousScanTime string, err error) {
	// Get the rollout to find its ImagePolicy reference
	rollout, err := c.GetRollout(ctx, namespace, rolloutName)
	if err != nil {
		return "", fmt.Errorf("failed to get rollout: %w", err)
	}

	// Reconcile the ImageRepository referenced by the rollout's ImagePolicy
	if rollout.Spec.ReleasesImagePolicy.Name != "" {
		imagePolicy, err := c.GetImagePolicy(ctx, namespace, rollout.Spec.ReleasesImagePolicy.Name)
		if err == nil && imagePolicy.Spec.ImageRepositoryRef.Name != "" {
			// Get the ImageRepository to capture the previous scan time
			imageRepo, err := c.GetImageRepository(ctx, namespace, imagePolicy.Spec.ImageRepositoryRef.Name)
			if err == nil && imageRepo.Status.LastScanResult != nil {
				previousScanTime = imageRepo.Status.LastScanResult.ScanTime.Format(time.RFC3339)
			}
			// Reconcile the ImageRepository
			if err := c.ReconcileImageRepository(ctx, namespace, imagePolicy.Spec.ImageRepositoryRef.Name); err != nil {
				// Log but don't fail - other resources can still be reconciled
				fmt.Printf("Warning: failed to reconcile image repository %s: %v\n", imagePolicy.Spec.ImageRepositoryRef.Name, err)
			}
		}
	}

	// Get associated Kustomizations
	kustomizations, err := c.GetKustomizationsByRolloutAnnotation(ctx, namespace, rolloutName)
	if err != nil {
		return previousScanTime, fmt.Errorf("failed to get kustomizations: %w", err)
	}

	// Get associated OCIRepositories
	ociRepositories, err := c.GetOCIRepositoriesByRolloutAnnotation(ctx, namespace, rolloutName)
	if err != nil {
		return previousScanTime, fmt.Errorf("failed to get OCI repositories: %w", err)
	}

	// Reconcile all Kustomizations
	for _, kustomization := range kustomizations.Items {
		if err := c.ReconcileKustomization(ctx, kustomization.Namespace, kustomization.Name); err != nil {
			return previousScanTime, fmt.Errorf("failed to reconcile kustomization %s: %w", kustomization.Name, err)
		}
	}

	// Reconcile all OCIRepositories
	for _, ociRepository := range ociRepositories.Items {
		if err := c.ReconcileOCIRepository(ctx, ociRepository.Namespace, ociRepository.Name); err != nil {
			return previousScanTime, fmt.Errorf("failed to reconcile OCI repository %s: %w", ociRepository.Name, err)
		}
	}

	return previousScanTime, nil
}

// GetRolloutGatesByRolloutReference fetches RolloutGates that reference a specific rollout.
//
// Left as list-then-filter-in-Go rather than a label selector: the
// rolloutschedule and rolloutdependency controllers both stamp
// gate.kuberik.com/rollout-name on the gates they create, but that's an
// implementation detail of those two controllers, not a guarantee on the
// RolloutGate CRD — a hand-authored or third-party-controller-created gate
// can set spec.rolloutRef.Name without the label. Selecting on the label
// would silently drop any such gate from this list even though it correctly
// targets the rollout. Namespace-scoped LIST + filter keeps that correct.
func (c *Client) GetRolloutGatesByRolloutReference(ctx context.Context, namespace, rolloutName string) (*rolloutv1alpha1.RolloutGateList, error) {
	rolloutGates := &rolloutv1alpha1.RolloutGateList{}

	// List all RolloutGates in the namespace
	if err := c.client.List(ctx, rolloutGates, client.InNamespace(namespace)); err != nil {
		return nil, fmt.Errorf("failed to list rollout gates: %w", err)
	}

	// Filter gates that reference the specific rollout
	var filteredGates []rolloutv1alpha1.RolloutGate
	for _, gate := range rolloutGates.Items {
		if gate.Spec.RolloutRef.Name == rolloutName {
			filteredGates = append(filteredGates, gate)
		}
	}

	rolloutGates.Items = filteredGates
	return rolloutGates, nil
}

// GetKruiseRollout fetches a KruiseRollout by name and namespace
func (c *Client) GetKruiseRollout(ctx context.Context, namespace, name string) (*kruiserolloutv1beta1.Rollout, error) {
	rollout := &kruiserolloutv1beta1.Rollout{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, rollout); err != nil {
		return nil, fmt.Errorf("failed to get kruise rollout: %w", err)
	}
	return rollout, nil
}

// GetKruiseRolloutsAllNamespaces lists KruiseRollouts across all namespaces.
// Used by the rollouts list endpoint so the frontend can correlate each
// kuberik Rollout to its underlying KruiseRollouts (via the linked
// Kustomization's inventory entries) and render a real pipeline glyph.
func (c *Client) GetKruiseRolloutsAllNamespaces(ctx context.Context) (*kruiserolloutv1beta1.RolloutList, error) {
	rollouts := &kruiserolloutv1beta1.RolloutList{}
	if err := c.client.List(ctx, rollouts); err != nil {
		return nil, fmt.Errorf("failed to list kruise rollouts across all namespaces: %w", err)
	}
	return rollouts, nil
}

// GetKruiseRollouts lists KruiseRollouts in a single namespace.
func (c *Client) GetKruiseRollouts(ctx context.Context, namespace string) (*kruiserolloutv1beta1.RolloutList, error) {
	rollouts := &kruiserolloutv1beta1.RolloutList{}
	if err := c.client.List(ctx, rollouts, client.InNamespace(namespace)); err != nil {
		return nil, fmt.Errorf("failed to list kruise rollouts: %w", err)
	}
	return rollouts, nil
}

// GetAllRolloutTests fetches all RolloutTests in a namespace
func (c *Client) GetAllRolloutTests(ctx context.Context, namespace string) (*openkruisev1alpha1.RolloutTestList, error) {
	rolloutTests := &openkruisev1alpha1.RolloutTestList{}

	// List all RolloutTests in the namespace
	if err := c.client.List(ctx, rolloutTests, client.InNamespace(namespace)); err != nil {
		return nil, fmt.Errorf("failed to list rollout tests: %w", err)
	}

	return rolloutTests, nil
}

// GetRolloutTestsByRolloutName fetches RolloutTests that reference a specific KruiseRollout by name.
//
// Left as list-then-filter: RolloutTest carries spec.rolloutName as a plain
// string field, not a label — openkruise-controller never stamps a
// corresponding label on the object (checked against the vendored
// openkruise-controller source), so there's nothing to select on server-side
// without the controller changing first.
func (c *Client) GetRolloutTestsByRolloutName(ctx context.Context, namespace, rolloutName string) (*openkruisev1alpha1.RolloutTestList, error) {
	rolloutTests := &openkruisev1alpha1.RolloutTestList{}

	// List all RolloutTests in the namespace
	if err := c.client.List(ctx, rolloutTests, client.InNamespace(namespace)); err != nil {
		return nil, fmt.Errorf("failed to list rollout tests: %w", err)
	}

	// Filter tests that reference the specific rollout
	var filteredTests []openkruisev1alpha1.RolloutTest
	for _, test := range rolloutTests.Items {
		if test.Spec.RolloutName == rolloutName {
			filteredTests = append(filteredTests, test)
		}
	}

	rolloutTests.Items = filteredTests
	return rolloutTests, nil
}

// GetEnvironmentByRolloutReference fetches Environment that references a specific rollout.
//
// Left as list-then-filter: Environment carries spec.rolloutRef.Name as a
// plain object reference, not a label — environment-controller never stamps
// a corresponding label on the object (checked against the vendored
// environment-controller source), so there's no selector to push down.
func (c *Client) GetEnvironmentByRolloutReference(ctx context.Context, namespace, rolloutName string) (*envv1alpha1.Environment, error) {
	// List all Environments in the namespace
	environments := &envv1alpha1.EnvironmentList{}

	if err := c.client.List(ctx, environments, client.InNamespace(namespace)); err != nil {
		return nil, fmt.Errorf("failed to list environments: %w", err)
	}

	// Filter environments that reference the specific rollout
	for _, environment := range environments.Items {
		if environment.Spec.RolloutRef.Name == rolloutName {
			// Return the first matching environment
			envCopy := environment
			return &envCopy, nil
		}
	}

	return nil, nil // No environment found, but not an error
}

// GetEnvironments fetches all Environments in a namespace
func (c *Client) GetEnvironments(ctx context.Context, namespace string) (*envv1alpha1.EnvironmentList, error) {
	environments := &envv1alpha1.EnvironmentList{}

	if err := c.client.List(ctx, environments, client.InNamespace(namespace)); err != nil {
		return nil, fmt.Errorf("failed to list environments: %w", err)
	}

	return environments, nil
}

// GetEnvironmentsAllNamespaces fetches all Environments across all namespaces
func (c *Client) GetEnvironmentsAllNamespaces(ctx context.Context) (*envv1alpha1.EnvironmentList, error) {
	environments := &envv1alpha1.EnvironmentList{}
	if err := c.client.List(ctx, environments); err != nil {
		return nil, fmt.Errorf("failed to list environments across all namespaces: %w", err)
	}
	return environments, nil
}

// GetPodsBySelector lists pods matching the given label selector
func (c *Client) GetPodsBySelector(ctx context.Context, namespace string, selector labels.Selector) (*corev1.PodList, error) {
	pods := &corev1.PodList{}
	opts := []client.ListOption{
		client.InNamespace(namespace),
		client.MatchingLabelsSelector{Selector: selector},
	}
	if err := c.client.List(ctx, pods, opts...); err != nil {
		return nil, fmt.Errorf("failed to list pods: %w", err)
	}
	return pods, nil
}

// GetAllPods lists all pods in a namespace
func (c *Client) GetAllPods(ctx context.Context, namespace string) (*corev1.PodList, error) {
	pods := &corev1.PodList{}
	opts := []client.ListOption{
		client.InNamespace(namespace),
	}
	if err := c.client.List(ctx, pods, opts...); err != nil {
		return nil, fmt.Errorf("failed to list pods: %w", err)
	}
	return pods, nil
}

// GetPodsByOwnerReference lists pods owned by a specific resource (by UID)
func (c *Client) GetPodsByOwnerReference(ctx context.Context, namespace string, ownerUID string) (*corev1.PodList, error) {
	pods := &corev1.PodList{}
	opts := []client.ListOption{
		client.InNamespace(namespace),
	}
	if err := c.client.List(ctx, pods, opts...); err != nil {
		return nil, fmt.Errorf("failed to list pods: %w", err)
	}

	// Filter pods by owner reference
	filteredPods := &corev1.PodList{}
	for _, pod := range pods.Items {
		for _, ownerRef := range pod.OwnerReferences {
			if string(ownerRef.UID) == ownerUID {
				filteredPods.Items = append(filteredPods.Items, pod)
				break
			}
		}
	}
	return filteredPods, nil
}

// GetPodsByJobName lists pods owned by a job
func (c *Client) GetPodsByJobName(ctx context.Context, namespace, jobName string) (*corev1.PodList, error) {
	// Get the job first to get its UID
	job := &unstructured.Unstructured{}
	job.SetGroupVersionKind(schema.GroupVersionKind{
		Group:   "batch",
		Version: "v1",
		Kind:    "Job",
	})
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: jobName}, job); err != nil {
		return nil, fmt.Errorf("failed to get job: %w", err)
	}

	jobUID := string(job.GetUID())
	return c.GetPodsByOwnerReference(ctx, namespace, jobUID)
}

// GetPodLogs retrieves logs from a pod
func (c *Client) GetPodLogs(ctx context.Context, namespace, podName, containerName string, tailLines *int64, follow bool) (string, error) {
	if c.clientset == nil {
		return "", fmt.Errorf("clientset not initialized")
	}

	opts := &corev1.PodLogOptions{
		Container: containerName,
		Follow:    follow,
	}
	if tailLines != nil {
		opts.TailLines = tailLines
	}

	req := c.clientset.CoreV1().Pods(namespace).GetLogs(podName, opts)
	stream, err := req.Stream(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to stream logs: %w", err)
	}
	defer stream.Close()

	logs, err := io.ReadAll(stream)
	if err != nil {
		return "", fmt.Errorf("failed to read logs: %w", err)
	}

	return string(logs), nil
}

// GetReplicaSets lists replica sets in a namespace
func (c *Client) GetReplicaSets(ctx context.Context, namespace string) (*appsv1.ReplicaSetList, error) {
	replicaSets := &appsv1.ReplicaSetList{}
	if err := c.client.List(ctx, replicaSets, client.InNamespace(namespace)); err != nil {
		return nil, fmt.Errorf("failed to list replicasets: %w", err)
	}
	return replicaSets, nil
}

// GetRolloutSchedules gets all RolloutSchedules in a namespace
func (c *Client) GetRolloutSchedules(ctx context.Context, namespace string) (*rolloutv1alpha1.RolloutScheduleList, error) {
	schedules := &rolloutv1alpha1.RolloutScheduleList{}
	if err := c.client.List(ctx, schedules, client.InNamespace(namespace)); err != nil {
		return nil, fmt.Errorf("failed to list rollout schedules: %w", err)
	}
	return schedules, nil
}

// GetRolloutSchedulesAllNamespaces gets all RolloutSchedules across all namespaces
func (c *Client) GetRolloutSchedulesAllNamespaces(ctx context.Context) (*rolloutv1alpha1.RolloutScheduleList, error) {
	schedules := &rolloutv1alpha1.RolloutScheduleList{}
	if err := c.client.List(ctx, schedules); err != nil {
		return nil, fmt.Errorf("failed to list rollout schedules: %w", err)
	}
	return schedules, nil
}

// GetRolloutSchedule gets a single RolloutSchedule
func (c *Client) GetRolloutSchedule(ctx context.Context, namespace, name string) (*rolloutv1alpha1.RolloutSchedule, error) {
	schedule := &rolloutv1alpha1.RolloutSchedule{}
	if err := c.client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, schedule); err != nil {
		return nil, fmt.Errorf("failed to get rollout schedule: %w", err)
	}
	return schedule, nil
}

// GetClusterRolloutSchedules gets all ClusterRolloutSchedules
func (c *Client) GetClusterRolloutSchedules(ctx context.Context) (*rolloutv1alpha1.ClusterRolloutScheduleList, error) {
	schedules := &rolloutv1alpha1.ClusterRolloutScheduleList{}
	if err := c.client.List(ctx, schedules); err != nil {
		return nil, fmt.Errorf("failed to list cluster rollout schedules: %w", err)
	}
	return schedules, nil
}

// GetClusterRolloutSchedule gets a single ClusterRolloutSchedule
func (c *Client) GetClusterRolloutSchedule(ctx context.Context, name string) (*rolloutv1alpha1.ClusterRolloutSchedule, error) {
	schedule := &rolloutv1alpha1.ClusterRolloutSchedule{}
	if err := c.client.Get(ctx, client.ObjectKey{Name: name}, schedule); err != nil {
		return nil, fmt.Errorf("failed to get cluster rollout schedule: %w", err)
	}
	return schedule, nil
}

// GetEventsForRollout collects events relevant to a rollout:
// 1. Events for the Rollout object itself
// 2. Events for all Deployments found via kustomizations linked to the rollout
// 3. Events for ReplicaSets owned by those Deployments
func (c *Client) GetEventsForRollout(ctx context.Context, namespace, rolloutName string) ([]corev1.Event, error) {
	cutoff := time.Now().Add(-2 * time.Hour)

	kustomizations, err := c.GetKustomizationsByRolloutAnnotation(ctx, namespace, rolloutName)
	if err != nil {
		return nil, fmt.Errorf("failed to get kustomizations: %w", err)
	}

	// Phase 1 — walk kustomizations in parallel, collect (kind, namespace, name) of
	// every Deployment + ReplicaSet we care about, grouped by namespace for one LIST each.
	type objRef struct{ kind, namespace, name string }
	var (
		mu     sync.Mutex
		byNS   = make(map[string]map[objRef]struct{})
		addRef = func(ns string, ref objRef) {
			mu.Lock()
			defer mu.Unlock()
			refs, ok := byNS[ns]
			if !ok {
				refs = make(map[objRef]struct{})
				byNS[ns] = refs
			}
			refs[ref] = struct{}{}
		}
	)

	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(8)
	for _, kustomization := range kustomizations.Items {
		kustomization := kustomization
		g.Go(func() error {
			resources, err := c.GetKustomizationManagedResources(gctx, kustomization.Namespace, kustomization.Name)
			if err != nil {
				fmt.Printf("Warning: failed to get managed resources for kustomization %s: %v\n", kustomization.Name, err)
				return nil
			}
			for _, resource := range resources {
				if !strings.Contains(resource.GroupVersionKind, "apps/v1/Deployment") {
					continue
				}
				addRef(resource.Namespace, objRef{kind: "Deployment", namespace: resource.Namespace, name: resource.Name})
				if resource.Object == nil {
					continue
				}
				deploymentUID := string(resource.Object.GetUID())
				// Narrow RS LIST by deployment selector (RS shares deployment's base labels).
				var rsListOpts []client.ListOption
				rsListOpts = append(rsListOpts, client.InNamespace(resource.Namespace))
				selectorMap, found, _ := unstructured.NestedStringMap(resource.Object.Object, "spec", "selector", "matchLabels")
				if found && len(selectorMap) > 0 {
					rsListOpts = append(rsListOpts, client.MatchingLabels(selectorMap))
				}
				rsList := &appsv1.ReplicaSetList{}
				if err := c.client.List(gctx, rsList, rsListOpts...); err != nil {
					fmt.Printf("Warning: failed to list replicasets in %s: %v\n", resource.Namespace, err)
					continue
				}
				for _, rs := range rsList.Items {
					for _, ownerRef := range rs.OwnerReferences {
						if string(ownerRef.UID) == deploymentUID {
							addRef(rs.Namespace, objRef{kind: "ReplicaSet", namespace: rs.Namespace, name: rs.Name})
							break
						}
					}
				}
			}
			return nil
		})
	}
	_ = g.Wait()

	if len(byNS) == 0 {
		return []corev1.Event{}, nil
	}

	// Phase 2 — one Events LIST per (namespace, involved object) via a field
	// selector on involvedObject.{kind,name,namespace}, so the apiserver does
	// the filtering instead of the dashboard pulling every event in the
	// namespace over the wire and matching it in Go. Bounded concurrency;
	// refs-per-namespace is small in practice (one Deployment plus a handful
	// of ReplicaSets per rollout), so this trades "N namespace-wide LISTs" for
	// "a few dozen tightly-filtered LISTs" rather than growing round-trip
	// count in the cases that matter.
	var allEvents []corev1.Event
	var allEventsMu sync.Mutex
	eg, egctx := errgroup.WithContext(ctx)
	eg.SetLimit(8)
	for ns, refs := range byNS {
		ns, refs := ns, refs
		for ref := range refs {
			ref := ref
			eg.Go(func() error {
				selector := fields.SelectorFromSet(fields.Set{
					"involvedObject.kind":      ref.kind,
					"involvedObject.name":      ref.name,
					"involvedObject.namespace": ref.namespace,
				})
				evList, err := c.clientset.CoreV1().Events(ns).List(egctx, metav1.ListOptions{FieldSelector: selector.String()})
				if err != nil {
					fmt.Printf("Warning: failed to list events for %s/%s in %s: %v\n", ref.kind, ref.name, ns, err)
					return nil
				}
				matched := make([]corev1.Event, 0, len(evList.Items))
				for _, ev := range evList.Items {
					if !ev.LastTimestamp.After(cutoff) {
						continue
					}
					matched = append(matched, ev)
				}
				if len(matched) > 0 {
					allEventsMu.Lock()
					allEvents = append(allEvents, matched...)
					allEventsMu.Unlock()
				}
				return nil
			})
		}
	}
	_ = eg.Wait()

	// Deduplicate by message+reason+involvedObject
	type dedupeKey struct{ message, reason, objName, objKind string }
	seen := make(map[dedupeKey]int)
	var deduped []corev1.Event
	for _, ev := range allEvents {
		k := dedupeKey{ev.Message, ev.Reason, ev.InvolvedObject.Name, ev.InvolvedObject.Kind}
		if idx, exists := seen[k]; exists {
			if ev.LastTimestamp.After(deduped[idx].LastTimestamp.Time) {
				deduped[idx] = ev
			}
		} else {
			seen[k] = len(deduped)
			deduped = append(deduped, ev)
		}
	}

	sort.Slice(deduped, func(i, j int) bool {
		return deduped[i].LastTimestamp.After(deduped[j].LastTimestamp.Time)
	})

	if len(deduped) > 50 {
		deduped = deduped[:50]
	}
	return deduped, nil
}

// GetRolloutSchedulesByRollout gets RolloutSchedules that match a specific rollout.
//
// Left as list-then-filter, and can't be pushed to a label selector: the
// direction is inverted from the usual "object has a label, filter on it"
// case. Here each RolloutSchedule carries its own spec.rolloutSelector, and
// whether it matches is a function of the *rollout's* labels, not any label
// on the RolloutSchedule itself — there's no server-side query for "list
// objects whose embedded selector matches this label set." Already
// namespace-scoped, which is the LIST-narrowing that is available here.
func (c *Client) GetRolloutSchedulesByRollout(ctx context.Context, namespace, rolloutName string, rolloutLabels map[string]string) (*rolloutv1alpha1.RolloutScheduleList, error) {
	schedules := &rolloutv1alpha1.RolloutScheduleList{}
	if err := c.client.List(ctx, schedules, client.InNamespace(namespace)); err != nil {
		return nil, fmt.Errorf("failed to list rollout schedules: %w", err)
	}

	// Filter schedules that match the rollout
	matchingSchedules := &rolloutv1alpha1.RolloutScheduleList{}
	for _, schedule := range schedules.Items {
		selector, err := metav1.LabelSelectorAsSelector(schedule.Spec.RolloutSelector)
		if err != nil {
			continue
		}
		if selector.Matches(labels.Set(rolloutLabels)) {
			matchingSchedules.Items = append(matchingSchedules.Items, schedule)
		}
	}

	return matchingSchedules, nil
}

// GetClusterRolloutSchedulesByRollout gets ClusterRolloutSchedules that match a specific rollout.
//
// Same inverted-selector situation as GetRolloutSchedulesByRollout — the
// match is evaluated against this rollout's (and its namespace's) labels
// using each schedule's own embedded selector, which has no server-side
// query equivalent. ClusterRolloutSchedule is cluster-scoped by definition,
// so there's no namespace to narrow the LIST by either; this is already the
// minimum round trip for this resource.
func (c *Client) GetClusterRolloutSchedulesByRollout(ctx context.Context, namespace, rolloutName string, rolloutLabels, namespaceLabels map[string]string) (*rolloutv1alpha1.ClusterRolloutScheduleList, error) {
	schedules := &rolloutv1alpha1.ClusterRolloutScheduleList{}
	if err := c.client.List(ctx, schedules); err != nil {
		return nil, fmt.Errorf("failed to list cluster rollout schedules: %w", err)
	}

	// Filter schedules that match the rollout
	matchingSchedules := &rolloutv1alpha1.ClusterRolloutScheduleList{}
	for _, schedule := range schedules.Items {
		// Check rollout selector
		rolloutSelector, err := metav1.LabelSelectorAsSelector(schedule.Spec.RolloutSelector)
		if err != nil {
			continue
		}
		if !rolloutSelector.Matches(labels.Set(rolloutLabels)) {
			continue
		}

		// Check namespace selector if present
		if schedule.Spec.NamespaceSelector != nil {
			namespaceSelector, err := metav1.LabelSelectorAsSelector(schedule.Spec.NamespaceSelector)
			if err != nil {
				continue
			}
			if !namespaceSelector.Matches(labels.Set(namespaceLabels)) {
				continue
			}
		}

		matchingSchedules.Items = append(matchingSchedules.Items, schedule)
	}

	return matchingSchedules, nil
}
