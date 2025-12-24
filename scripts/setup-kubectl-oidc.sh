#!/bin/bash
set -e

SCRIPT_DIR=$(dirname "$0")
PROJECT_ROOT=$(dirname "$SCRIPT_DIR")
OUTPUT_DIR="${SCRIPT_DIR}/dex-certs"

# Check if kubectl oidc-login plugin is installed
if ! kubectl oidc-login version &> /dev/null; then
    echo "Error: kubectl oidc-login plugin is not installed."
    echo "Install it with: go install github.com/int128/kubelogin/cmd/kubelogin@latest"
    echo "Or download from: https://github.com/int128/kubelogin/releases"
    exit 1
fi

# Check if CA certificate exists
if [ ! -f "${OUTPUT_DIR}/dex-ca.crt" ]; then
    echo "Error: Dex CA certificate not found. Please run setup-kind-cluster.sh first."
    exit 1
fi

# Check if Dex is running
if ! docker ps --format '{{.Names}}' | grep -q "^dex-server$"; then
    echo "Error: Dex server is not running. Please run setup-kind-cluster.sh first."
    exit 1
fi

# Get Dex hostname
if [ ! -f "${OUTPUT_DIR}/dex-hostname.txt" ]; then
    echo "Error: Dex hostname not found. Please run setup-kind-cluster.sh first."
    exit 1
fi
DEX_HOST=$(cat "${OUTPUT_DIR}/dex-hostname.txt")
DEX_ISSUER_URL="https://${DEX_HOST}:10443/dex"
CLIENT_ID="kubernetes"
CLIENT_SECRET="kubernetes-client-secret"
# Use absolute path for CA certificate so it works from any directory
CA_CERT_PATH=$(cd "${OUTPUT_DIR}" && pwd)/dex-ca.crt

echo "Configuring kubectl for OIDC authentication..."
echo "Issuer URL: ${DEX_ISSUER_URL}"
echo "Client ID: ${CLIENT_ID}"

# Set up kubectl credentials
kubectl config set-credentials oidc \
  --exec-api-version=client.authentication.k8s.io/v1beta1 \
  --exec-command=kubectl \
  --exec-arg=oidc-login \
  --exec-arg=get-token \
  --exec-arg=--oidc-issuer-url="${DEX_ISSUER_URL}" \
  --exec-arg=--oidc-client-id="${CLIENT_ID}" \
  --exec-arg=--oidc-client-secret="${CLIENT_SECRET}" \
  --exec-arg=--oidc-extra-scope=email \
  --exec-arg=--oidc-extra-scope=groups \
  --exec-arg=--certificate-authority="${CA_CERT_PATH}"

echo ""
echo "kubectl OIDC configuration complete!"

# Create cluster role binding for the OIDC user (if not already exists)
echo "Creating cluster role binding for OIDC user..."
kubectl create clusterrolebinding oidc-admin \
  --clusterrole=cluster-admin \
  --user=admin@example.com \
  --dry-run=client -o yaml | kubectl apply -f - 2>/dev/null || true

# Set the context to use OIDC user
echo "Setting kubectl context to use OIDC authentication..."
kubectl config set-context --current --user=oidc

echo ""
echo "✓ kubectl is now configured to use OIDC authentication"
echo ""
echo "You can test it with:"
echo "  kubectl cluster-info"
echo ""
echo "Note: You'll be prompted to authenticate with Dex when accessing the cluster."
echo "Default credentials: admin@example.com / password"
