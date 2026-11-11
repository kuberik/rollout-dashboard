#!/bin/bash
# Counterpart to setup-multi-cluster-dev.sh. Tears down both kind clusters
# (hub + spoke) and the haproxy SNI router, plus the shared dev auth/testing
# state that setup-kind-cluster.sh creates once regardless of cluster count.
set -e

SCRIPT_DIR=$(dirname "$0")
PROJECT_ROOT=$(dirname "$SCRIPT_DIR")

echo "Cleaning up multi-cluster dev environment..."

# Delete both Kind clusters
kind delete cluster --name rollout-prod
kind delete cluster --name rollout-dev
# release-controller lives in those clusters, so deleting them removes it; drop
# the manifests deploy-kind.sh resolved for them too.
rm -f "${PROJECT_ROOT}"/../.work/release-controller/resolved-rollout-{prod,dev}.yaml

# Stop the haproxy SNI router
docker compose -f "${PROJECT_ROOT}/docker-compose.sni-proxy.yaml" down
rm -f "${HOME}/.local/state/kuberik-dev/haproxy.cfg" /tmp/kuberik-haproxy.cfg

# delete the test repositories
gh repo delete LittleChimera/kuberik-testing --yes || true
gh repo delete LittleChimera/kuberik-testing-second --yes || true

docker stop dex-server || true
docker rm dex-server || true
rm -rf "${SCRIPT_DIR}/dex-certs"
rm -rf ~/.kube/cache/oidc-login

echo "Multi-cluster cleanup complete!"
