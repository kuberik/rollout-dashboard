#!/bin/bash
set -e

SCRIPT_DIR=$(dirname "$0")
PROJECT_ROOT=$(dirname "$SCRIPT_DIR")

echo "Cleaning up Kind cluster..."

# Delete Kind cluster
kind delete cluster --name rollout-dev

# Stop the socat container
docker compose -f "${PROJECT_ROOT}/docker-compose.socat.yaml" down

# delete the test repository
gh repo delete LittleChimera/kuberik-testing --yes || true

docker stop dex-server || true
docker rm dex-server || true
rm -rf "${SCRIPT_DIR}/dex-certs"
rm -rf ~/.kube/cache/oidc-login

echo "Cleanup complete!"
