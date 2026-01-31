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
GET  /api/rollouts                             # List all rollouts
GET  /api/rollouts/:namespace/:name            # Get rollout details
POST /api/rollouts/:namespace/:name/pin        # Pin version to rollout
POST /api/rollouts/:namespace/:name/bypass-gates  # Add bypass-gates annotation
```

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

Allow rollout controller to bypass gate checks for specific version:

```bash
# Add bypass annotation
kubectl annotate rollout <rollout-name> rollout.kuberik.com/bypass-gates="v1.2.3"

# Remove bypass annotation
kubectl annotate rollout <rollout-name> rollout.kuberik.com/bypass-gates-
```

**How it works:**
- When set, rollout controller can deploy specified version without waiting for gates
- Useful for emergency deployments or testing
- Dashboard provides UI to manage this annotation safely

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

The dashboard is deployed to Kubernetes using Kustomize:

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
