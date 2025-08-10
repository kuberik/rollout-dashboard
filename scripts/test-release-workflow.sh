#!/bin/bash

set -eEuo pipefail

echo "Testing release workflow locally..."

# Check if required tools are installed
command -v ko >/dev/null 2>&1 || { echo "ko is required but not installed. Aborting." >&2; exit 1; }
command -v kustomize >/dev/null 2>&1 || { echo "kustomize is required but not installed. Aborting." >&2; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "pnpm is required but not installed. Aborting." >&2; exit 1; }

# Build frontend
echo "Building frontend..."
(cd frontend && pnpm install && pnpm run build)
rm -rf kodata
cp -r frontend/build kodata

# Test ko build (without pushing)
echo "Testing ko build..."
export KO_DOCKER_REPO=ko.local
export KO_DATA_PATH=kodata

# Test that ko can build the image
ko build --bare . --push=false

# Test kustomize build
echo "Testing kustomize build..."
kustomize build deploy/

echo "All tests passed! The workflow should work correctly."
echo ""
echo "To create a release:"
echo "1. git tag v1.0.0"
echo "2. git push origin v1.0.0"
echo ""
echo "Or manually trigger the workflow from GitHub Actions."
