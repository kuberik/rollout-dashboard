# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Rollout Dashboard?

A web application with a Go Gin backend and Svelte frontend for managing Kubernetes rollouts with gate controls. Provides a single-cluster dashboard for monitoring and managing rollouts.

## Key Features

- **Gate Management**: Display gate status and bypass capabilities
- **Kustomization Association**: Find kustomizations linked to rollouts via annotations
- **Version Pinning**: Pin specific versions to prevent auto-updates
- **Gate Bypass**: Temporarily bypass gate checks for emergency deployments
- **Gateway API Integration**: Exposed via Gateway API with TLS support

## Project Structure

```
.
├── frontend/          # Svelte frontend
├── main.go           # Go backend entry point
├── pkg/              # Go packages
│   └── kubernetes/   # Kubernetes client utilities
└── go.mod            # Go module file
```

## Common Development Commands

### Backend (Go)

```bash
# Install dependencies
go mod tidy

# Run backend server
go run main.go        # Starts on :8080

# Build binary
go build -o rollout-dashboard
```

### Frontend (Svelte)

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install

# Development mode (hot reload)
npm run dev           # Starts on :5173

# Build for production
npm run build         # Output to frontend/dist
```

## Development Workflow

1. **Backend Changes**:
   - Modify Go code in `main.go` or `pkg/`
   - Run `go run main.go` to test
   - Backend serves API and static files

2. **Frontend Changes**:
   - Modify Svelte components in `frontend/src/`
   - Frontend dev server runs on :5173
   - Proxies API calls to backend on :8080

3. **Production Build**:
   - Build frontend: `cd frontend && npm run build`
   - Built files in `frontend/dist` served by Go backend

## API Endpoints

```
GET  /api/health                               # Health check
GET  /api/rollouts                             # List all rollouts (every status.gates[] entry carries kind, displayName?
                                               #   and rule {kind,name,namespace?}) (+ kustomizations, environments, kruiseRollouts,
                                               #   rolloutDependencies, releaseSources, releaseSlices; the last three
                                               #   are {items}|null, null = CRD not installed; real read failures are
                                               #   named in partialReads; all fan-out merged + source-cluster stamped)
GET  /api/rollouts/:namespace/:name            # Get rollout details
POST /api/rollouts/:namespace/:name/pin        # Pin version to rollout
POST /api/rollouts/:namespace/:name/bypass-gates  # Let a build through gates. Body {version, rule?:{kind,name,namespace?}, gates?:[names]};
                                               #   200 {rollout, version, gates, scope:"only"|"all"}; 409 version not a
                                               #   candidate / lock conflict; 422 rule or gate matches nothing (see Bypass Gates Feature)
```

## Kubernetes client: reads vs. writes, and per-user visibility

(PERF-2026-09-04 slices 1-2, `.agents-context/PERF-2026-09-04.md`.)

Two different Kubernetes clients back this API, and picking the wrong one for
a new handler is the mistake to avoid:

- **Reads** (every LIST/GET behind the JSON routes) use `kubernetes.GetReadClient`
  (`getK8sReadClient` in `main_helper.go`) — ONE long-lived client for the
  process lifetime, authenticated as the dashboard's own service account,
  backed by an informer cache for the hub-local CRDs the dashboard reads (see
  `pkg/kubernetes/cache.go` for the exact resource set). It ignores the
  caller's own OIDC token entirely.
- **Writes** (pin, clear pin, change-version, force-deploy, bypass-gates,
  retry, mark-successful, unblock-failed, reconcile, continue) and every
  SelfSubjectAccessReview (`/permissions`, `/permissions/all`) use
  `kubernetes.GetWriteClient` (`getK8sWriteClient`) — a per-request client
  authenticated as the actual signed-in operator's OIDC bearer token. **Never
  downgrade a mutating call to the shared service-account read client.**

Because the read client bypasses the viewing user's own RBAC, every
namespaced object it returns to an OIDC-authenticated request must first pass
`kubernetes.CanListRolloutsInNamespace` / `requireRolloutVisibility`
(`main_visibility.go`) — a SelfSubjectAccessReview for "list rollouts" in that
namespace, run under the caller's own token, cached 5 minutes. Cluster-wide
routes (`/api/rollouts`) filter their namespaced items to what the caller may
see; a `:namespace/:name`-scoped route 403s outright on a denial. No OIDC
token on the request (service-account mode) skips the check entirely — that
caller already is the trusted identity. See the doc comments on
`pkg/kubernetes/context.go` and `pkg/kubernetes/visibility.go` for the full
rule.

## Kustomization Association

Kustomizations are associated with rollouts using annotations:

```yaml
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: hello-world
  annotations:
    rollout.kuberik.com/substitute.HELLO_WORLD_VERSION.from: "hello-world-app"
spec:
  postBuild:
    substitute:
      HELLO_WORLD_VERSION: "1.0.0"
```

The dashboard finds kustomizations that reference a specific rollout.

## Bypass Gates Feature

Let one build through gates once (annotations on the Rollout, both cleared by the
controller after the deploy):

```bash
kubectl annotate rollout <name> rollout.kuberik.com/bypass-gates="v1.2.3"            # every gate
kubectl annotate rollout <name> rollout.kuberik.com/bypass-gates-only="gateA,gateB"  # only these gates
```

- `bypass-gates-only` (comma-separated RolloutGate names, sorted, no spaces) narrows `bypass-gates`:
  unlisted gates still apply. Absent/empty = every gate. Does nothing without `bypass-gates`.
- The controller ignores a bypass for a build that is not a release candidate.
- Who set it is NOT recorded anywhere (history message only names skipped gates). Do not show a person.

**Endpoint** `POST /api/rollouts/:ns/:name/bypass-gates`, body
`{"version": "1.4.2", "rule": {"kind": "ClusterRolloutSchedule", "name": "business-hours"}, "gates": ["optional"]}`:
- no `rule`/`gates`: bypass every gate and delete any stale `bypass-gates-only`.
- `rule` resolves to this rollout's gates whose `pkg/kubernetes.GateRule` matches (kind, name, namespace when
  given); `gates` are explicit names; both = union. 422 when the rule matches no gate or a gate is not one of
  this rollout's RolloutGates.
- 409 when `version` is not in `status.candidates[].tag`, or when the rollout changed under us (optimistic lock
  on resourceVersion).
- Accumulates: same version already bypassed with an only-list unions the new names; a full bypass of the same
  version stays full; a different version is replaced.
- Write = JSON merge patch on metadata.annotations (null deletes), field owner `rollout-dashboard`, via the
  operator's own token (`getK8sWriteClient`). Gates are listed through the read client.
- 200: `{rollout, version, gates: [resolved names], scope: "only"|"all"}`.
- Per-cluster: a spoke cluster is reached through `/api/clusters/:cluster/...`, which resolves its own gates.
  "Many rollouts" is the frontend calling this once per rollout.

**Rule identity** (`GateRule`, serialised as `rule` on every `status.gates[]` entry): ownerReferences first
(RolloutSchedule, ClusterRolloutSchedule, RolloutDependency, ApprovalPolicy, ClusterApprovalPolicy, Environment),
then `gate.kuberik.com/{schedule,dependency,approval-policy}-*` labels, else `{kind:"RolloutGate", name: gate}`.
`namespace` is omitted for cluster-scoped rules and unowned gates.

**Warning:** Use carefully as it bypasses important safety checks.

## Kubernetes Exposure via Gateway API

The dashboard Service is `ClusterIP` and traffic routes through Gateway API resources.

### TLS Setup

Create TLS secret in `kuberik-system` namespace:

```bash
kubectl create secret tls rollout-dashboard-tls \
  --namespace kuberik-system \
  --cert tls.crt \
  --key tls.key
```

### Configuration

Gateway and HTTPRoute defined in `deploy/base/gateway.yaml`:
- Update hostnames to match certificate's Subject Alternative Names
- Can patch per environment using Kustomize overlays

### Local Development with Kind

Use `scripts/setup-dev-environment.sh` to:
- Install Envoy Gateway (implements Gateway API)
- Expose dashboard via Gateway resources
- Add hostname to `/etc/hosts` if needed

## Frontend Structure

```
frontend/
├── src/
│   ├── lib/              # Reusable components and utilities
│   ├── routes/           # SvelteKit pages
│   │   └── +page.svelte  # Main dashboard page
│   └── app.html          # HTML template
├── package.json
└── vite.config.ts
```

## Common Patterns

### Backend API Handler

```go
func getRollout(c *gin.Context) {
    namespace := c.Param("namespace")
    name := c.Param("name")

    // Get rollout from K8s
    rollout := &kuberikv1alpha1.Rollout{}
    err := k8sClient.Get(ctx, types.NamespacedName{
        Namespace: namespace,
        Name:      name,
    }, rollout)

    if err != nil {
        c.JSON(500, gin.H{"error": err.Error()})
        return
    }

    c.JSON(200, rollout)
}
```

### Frontend API Call

```typescript
async function fetchRollouts() {
    const response = await fetch('/api/rollouts');
    const rollouts = await response.json();
    return rollouts;
}
```

## Dependencies

### Backend
- `github.com/gin-gonic/gin` - Web framework
- `github.com/kuberik/rollout-controller` - For Rollout CRD (local path)
- `sigs.k8s.io/controller-runtime` - Kubernetes client

### Frontend
- Svelte - UI framework
- Vite - Build tool
- TypeScript - Type safety

## Local Path Dependencies

```go
replace github.com/kuberik/rollout-controller => ../rollout-controller
```

Run `go mod tidy` after making changes to the rollout-controller API.

## Deployment

### Dev environment (Kind cluster)

Build frontend + backend and deploy to the local `rollout-dev` Kind cluster using `ko`:

```bash
# Build frontend first (ko bundles the build output as kodata)
(cd frontend && npm run build && rm -rf ../kodata && cp -r build ../kodata)

# Build Go binary, push image to Kind, apply manifests
kustomize build deploy/dev | KIND_CLUSTER_NAME=rollout-dev KO_DOCKER_REPO=kind.local ko apply -f -
```

`ko` builds the Go binary, packages it with `kodata/` (the built frontend), loads the image directly into the Kind cluster, and applies the rendered manifests.

### Production

```bash
# Deploy to cluster
kubectl apply -k deploy/base

# Or with custom overlay
kubectl apply -k deploy/overlays/production
```

## Debugging

```bash
# Backend logs (when running locally)
go run main.go

# Pod logs (when deployed)
kubectl logs -n kuberik-system deployment/rollout-dashboard -f

# Check Gateway resources
kubectl get gateway -n kuberik-system
kubectl get httproute -n kuberik-system

# Test API endpoints
curl http://localhost:8080/api/health
curl http://localhost:8080/api/rollouts
```

## Release catalogue (ReleaseSource / ReleaseSlice)

release-controller's catalogue kinds are mirrored in `pkg/apis/release/v1alpha1` (copied from release-controller commit 1306a8c; it has no git remote, so it is not a module dependency; re-sync by hand). Both are informer-cached (registered through `optionalCachedObjects`/`kindOf`, see below), event-carrying (`objectCarryingKinds`, 64 KiB cap) and served on `/api/rollouts` as `releaseSources`/`releaseSlices`, namespace-visibility filtered like every other list. The CRDs are optional: an absent CRD yields null, not an error. RBAC: release-controller ships the optional binding of `release-controller-reader` to this SA (its `config/readers`); the dashboard deploy does not define one. The catalogue kinds are NOT in `cachedByObject` (cache.New fails without the CRD): they register via `registerOptionalInformers`, retried every 30s. `go.mod` pins rollout-controller to the merge commit that added the release catalogue (a pseudo-version); move it to the next release tag once one exists. Releases come only from ReleaseSources and ReleaseSlices (plus `status.candidates`); the only reads of Flux `ImagePolicy`/`ImageRepository` left resolve the image of a source that names it through `oci.imagePolicyRef` (`ResolveReleaseImage`).
