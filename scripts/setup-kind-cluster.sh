#!/bin/bash
set -e

SCRIPT_DIR=$(dirname "$0")
PROJECT_ROOT=$(dirname "$SCRIPT_DIR")

echo "Setting up Kind cluster with registry..."

# Create Kind cluster
kind create cluster --name rollout-dev --config "${PROJECT_ROOT}/kind-config.yaml"
docker compose -f "${SCRIPT_DIR}/../docker-compose.socat.yaml" up --wait

# Wait for cluster to be ready
kubectl wait --for=condition=Ready nodes --all --timeout=300s

echo "Kind cluster setup complete!"
echo "Registry is available at: registry:5000 (insecure, no auth)"
