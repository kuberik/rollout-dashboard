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

echo "Cleanup complete!"
