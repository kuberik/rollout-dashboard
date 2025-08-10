# Release Workflow Setup

This document describes the GitHub Actions workflows that have been set up for the rollout-dashboard project.

## Overview

The project now has two main workflows:

1. **CI Workflow** (`.github/workflows/ci.yml`) - Runs on every PR and push to main
2. **Release Workflow** (`.github/workflows/release.yml`) - Runs when creating releases

## What These Workflows Do

### CI Workflow
- Builds and tests the frontend (Svelte app)
- Tests that ko can build the Go application
- Tests that kustomize can build the Kubernetes manifests
- Runs Go tests and vet (if test files exist)
- Ensures go.mod is tidy

### Release Workflow
- Builds the frontend and copies it to `kodata/`
- Uses ko to build and push a Docker image to GitHub Container Registry
- Generates Kubernetes manifests using ko
- Creates a GitHub release with all assets
- Uploads manifests, deployment files, and image digests

## How to Use

### Automatic Release (Recommended)
1. Create and push a tag:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
2. The workflow will automatically run and create a release

### Manual Release
1. Go to GitHub Actions → Release → Run workflow
2. Enter the version (e.g., `v1.0.0`)
3. Click "Run workflow"

### Local Testing
Before pushing, you can test the workflow locally:
```bash
./scripts/test-release-workflow.sh
```

## Generated Assets

Each release will include:
- `kubernetes-manifests.yaml` - Complete manifests for deployment
- `deployment-{version}.yaml` - Updated deployment file with the new image
- `image-digest.txt` - Image digest for verification

## Image Location

Images are published to: `ghcr.io/kuberik/rollout-dashboard:{version}`

## Prerequisites

- GitHub repository with Actions enabled
- Repository must have access to create packages (enabled in settings)
- The `GITHUB_TOKEN` secret is automatically available

## Configuration

The workflows are configured to:
- Use Go 1.24.2 (matches your go.mod)
- Use Node.js 18 and pnpm 8
- Use ko 0.15.0 for Go container builds
- Build frontend assets and copy them to `kodata/`
- Use GitHub Container Registry (ghcr.io)

## Troubleshooting

### Common Issues

1. **Permission denied for packages**: Ensure the repository has package creation permissions enabled
2. **ko build fails**: Check that the Go code compiles and all dependencies are available
3. **Frontend build fails**: Ensure pnpm is working and all dependencies are installed
4. **kustomize build fails**: Check that the deploy/ directory contains valid kustomize files

### Debugging

- Check the Actions tab in GitHub for detailed logs
- Use the local test script to verify everything works locally
- Ensure all required tools (ko, kustomize, pnpm) are installed locally

## Next Steps

1. **Enable Actions**: Ensure GitHub Actions are enabled for your repository
2. **Test Locally**: Run `./scripts/test-release-workflow.sh` to verify everything works
3. **Create First Release**: Tag and push a version to trigger the workflow
4. **Monitor**: Check the Actions tab to ensure everything runs successfully

## Customization

You can modify the workflows to:
- Change the container registry (currently ghcr.io)
- Add additional build steps
- Modify the release assets
- Change the Go/Node.js versions
- Add additional testing steps

The workflows are designed to be flexible and can be easily adapted to your specific needs.
