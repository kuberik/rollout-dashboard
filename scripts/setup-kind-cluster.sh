#!/bin/bash
set -e

SCRIPT_DIR=$(dirname "$0")
PROJECT_ROOT=$(dirname "$SCRIPT_DIR")
OUTPUT_DIR="${SCRIPT_DIR}/dex-certs"

# Parameters (defaults match the original single-cluster setup):
#   CLUSTER_NAME — kind cluster name (default: rollout-dev)
#   HOST_PORT    — host port mapped to the cluster's Envoy NodePort (default: 8080)
# Multi-cluster setups call this script twice with different values.
CLUSTER_NAME="${CLUSTER_NAME:-rollout-dev}"
HOST_PORT="${HOST_PORT:-8080}"

echo "Setting up Kind cluster '${CLUSTER_NAME}' (host port ${HOST_PORT})..."

# Generate Dex TLS certificates (will regenerate if hostname changed)
echo "Generating/updating Dex TLS certificates..."
"${SCRIPT_DIR}/generate-dex-tls.sh"

# Get Dex hostname
DEX_HOST=$(cat "${OUTPUT_DIR}/dex-hostname.txt")

# Copy CA certificate to /tmp for kind to mount
cp "${OUTPUT_DIR}/dex-ca.crt" /tmp/dex-ca.crt

# Generate kind config with Dex hostname and host port
KIND_CONFIG_TMP="/tmp/kind-config-${CLUSTER_NAME}.yaml"
sed -e "s|dex-server|${DEX_HOST}|g" -e "s|__HOST_PORT__|${HOST_PORT}|g" \
  "${PROJECT_ROOT}/kind-config.yaml" > "${KIND_CONFIG_TMP}"

# Create Kind cluster
echo "Creating Kind cluster with OIDC configuration..."
echo "Dex hostname: ${DEX_HOST}"
kind create cluster --name "${CLUSTER_NAME}" --config "${KIND_CONFIG_TMP}"

kubectl create ns cert-manager -o yaml --dry-run=client | kubectl apply -f -
kubectl -n cert-manager create configmap custom-ca-bundle --from-file=ca-certificates.crt=/tmp/dex-ca.crt

SCRIPT_DIR=$(dirname "$0")
PROJECT_ROOT=$(dirname "$SCRIPT_DIR")
OUTPUT_DIR="${SCRIPT_DIR}/dex-certs"

kubectl create configmap dex-ca-cert \
  --from-file=ca.crt="${OUTPUT_DIR}/dex-ca.crt" \
  -n cert-manager \
  --dry-run=client -o yaml | kubectl apply -f -

if [ "${SKIP_PROXY:-false}" != "true" ]; then
  docker compose -f "${SCRIPT_DIR}/../docker-compose.socat.yaml" up --wait
fi

# Wait for cluster to be ready
kubectl wait --for=condition=Ready nodes --all --timeout=300s

# Set up Dex if not already running
if ! docker ps --format '{{.Names}}' | grep -q "^dex-server$"; then
    echo "Setting up Dex with local connector..."

    # Deploy Dex
    "${SCRIPT_DIR}/setup-dex.sh"
else
    echo "Dex server is already running"
fi

# Configure kubectl for OIDC if kubectl oidc-login is available
if command -v kubectl oidc-login &> /dev/null; then
    echo ""
    echo "Configuring kubectl for OIDC authentication..."
    "${SCRIPT_DIR}/setup-kubectl-oidc.sh"
else
    echo ""
    echo "kubectl oidc-login not found. Skipping kubectl OIDC configuration."
    echo "Install it with: go install github.com/int128/kubelogin/cmd/kubelogin@latest"
    echo "Then run: ${SCRIPT_DIR}/setup-kubectl-oidc.sh"
fi

echo ""
echo "Kind cluster setup complete!"
echo "Registry is available at: registry:5000 (insecure, no auth)"
echo ""
echo "OIDC is configured with Dex and local connector"
echo "Dex issuer URL: https://${DEX_HOST}:10443/dex"
echo ""
echo "Default user credentials:"
echo "  Email: admin@example.com"
echo "  Password: password"
