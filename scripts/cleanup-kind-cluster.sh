#!/bin/bash
set -e

SCRIPT_DIR=$(dirname "$0")
PROJECT_ROOT=$(dirname "$SCRIPT_DIR")

echo "Cleaning up Kind cluster..."

# Delete Kind cluster
kind delete cluster --name rollout-dev
# Multi-cluster setup (setup-multi-cluster-dev.sh) also creates the hub.
kind delete cluster --name rollout-prod
# release-controller went with the clusters; drop its resolved manifests too.
rm -f "${PROJECT_ROOT}"/../.work/release-controller/resolved-rollout-{prod,dev}.yaml

# Stop the socat container
docker compose -f "${PROJECT_ROOT}/docker-compose.socat.yaml" down

# delete the test repositories
gh repo delete LittleChimera/kuberik-testing --yes || true
gh repo delete LittleChimera/kuberik-testing-second --yes || true

docker rm -f sni-router || true
docker stop dex-server || true
docker rm dex-server || true
rm -rf "${SCRIPT_DIR}/dex-certs"
rm -rf ~/.kube/cache/oidc-login

echo "Cleanup complete!"
