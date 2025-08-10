# GitHub Workflows

This directory contains GitHub Actions workflows for the rollout-dashboard project.

## Workflows

### CI (`ci.yml`)

Runs on every pull request and push to main branch. This workflow:

- Sets up Go 1.24.2 and Node.js 18
- Installs frontend dependencies with pnpm
- Runs frontend tests
- Builds the frontend and copies it to `kodata/`
- Sets up ko for Go container builds
- Tests that ko can build the image
- Tests that kustomize can build the manifests
- Runs Go tests and vet
- Checks that go.mod is tidy

### Release (`release.yml`)

Runs when a tag starting with `v` is pushed (e.g., `v1.0.0`) or manually triggered. This workflow:

- Builds the frontend and copies it to `kodata/`
- Uses ko to build and push a Docker image to GitHub Container Registry (ghcr.io)
- Generates Kubernetes manifests using ko
- Creates a GitHub release
- Uploads the following assets to the release:
  - `kubernetes-manifests.yaml` - Generated manifests
  - `image-digest.txt` - Image digest for verification
  - `deployment-{version}.yaml` - Updated deployment file with the new image

## Usage

### Automatic Release

To create a release automatically:

1. Create and push a tag:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

2. The workflow will automatically:
   - Build the image: `ghcr.io/kuberik/rollout-dashboard:v1.0.0`
   - Create a release with all assets

### Manual Release

1. Go to Actions → Release → Run workflow
2. Enter the version (e.g., `v1.0.0`)
3. Click "Run workflow"

### Using the Released Image

The released image can be used by updating your deployment:

```yaml
# Instead of:
image: ko://github.com/kuberik/rollout-dashboard

# Use:
image: ghcr.io/kuberik/rollout-dashboard:v1.0.0
```

## Prerequisites

- The repository must have access to create packages (enabled in repository settings)
- The `GITHUB_TOKEN` secret is automatically available
- The repository must be public or have proper package permissions configured

## Environment Variables

- `REGISTRY`: Set to `ghcr.io` (GitHub Container Registry)
- `IMAGE_NAME`: Automatically set to `${{ github.repository }}`
- `KO_DOCKER_REPO`: Set to the full image repository
- `KO_DATA_PATH`: Set to `kodata` for frontend assets

## Dependencies

- Go 1.24.2
- Node.js 18
- pnpm 8
- ko 0.15.0
- kustomize
- Docker (for building images)
