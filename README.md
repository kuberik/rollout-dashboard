# Rollout Dashboard

A web application with a Go Gin backend and Svelte frontend for managing Kubernetes rollouts with gate controls.

## Features

### Gate Management
The dashboard provides comprehensive gate management for Kubernetes rollouts:

- **Gate Status Display**: Shows the status of all gates for each rollout
- **Bypass Gates**: Ability to temporarily bypass gate checks for emergency deployments
- **Gate History**: Track which versions have passed through gates

### Kustomization Association
Kustomizations can be associated with rollouts using the annotation format:
`rollout.kuberik.com/substitute.<variable>.from: <rollout>`

This allows the dashboard to find related kustomizations that reference a specific rollout for variable substitution.

**Example:**
```yaml
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: hello-world
  annotations:
    rollout.kuberik.com/substitute.HELLO_WORLD_VERSION.from: "hello-world-app"
```

In this example, the kustomization `hello-world` is associated with the rollout `hello-world-app` and will receive the `HELLO_WORLD_VERSION` variable from that rollout.

### Bypass Gates Feature
You can allow the rollout controller to bypass gate checks for a specific version by adding the `rollout.kuberik.com/bypass-gates` annotation with the version as the value:

```bash
# Allow gate bypass for a specific version
kubectl annotate rollout <rollout-name> rollout.kuberik.com/bypass-gates="v1.2.3"

# Remove gate bypass permission
kubectl annotate rollout <rollout-name> rollout.kuberik.com/bypass-gates-
```

**How it works**: When this annotation is set, the rollout controller will be allowed to deploy the specified version without waiting for gates to pass. This is useful for emergency deployments or testing scenarios where you need to bypass normal gate checks.

**Warning**: Use this feature carefully as it allows the rollout controller to bypass important safety checks for the specified version. The dashboard provides a UI to manage this annotation safely, allowing you to select which specific version should be allowed to bypass gates.

## Project Structure

```
.
├── frontend/          # Svelte frontend
├── main.go           # Go backend entry point
├── pkg/              # Go packages
│   └── kubernetes/   # Kubernetes client utilities
└── go.mod            # Go module file
```

## Setup Instructions

### Backend (Go)

1. Install Go dependencies:
```bash
go mod tidy
```

2. Run the backend server:
```bash
go run main.go
```

The backend server will run on http://localhost:8080

### Frontend (Svelte)

1. Navigate to the frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Run the development server:
```bash
npm run dev
```

The frontend development server will run on http://localhost:5173

## Building for Production

1. Build the frontend:
```bash
cd frontend
npm run build
```

2. The built files will be in `frontend/dist` and will be served by the Go backend.

## API Endpoints

- `GET /api/health` - Health check endpoint
- `GET /api/rollouts` - List all rollouts
- `GET /api/rollouts/:namespace/:name` - Get specific rollout details
- `POST /api/rollouts/:namespace/:name/pin` - Pin a version to a rollout
- `POST /api/rollouts/:namespace/:name/bypass-gates` - Add bypass-gates annotation
