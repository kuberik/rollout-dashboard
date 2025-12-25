#!/bin/bash
set -e

SCRIPT_DIR=$(dirname "$0")
PROJECT_ROOT=$(dirname "$SCRIPT_DIR")
OUTPUT_DIR="${PROJECT_ROOT}/scripts/dex-certs"
DEX_VERSION="v2.44.0"

# Check if certificates exist
if [ ! -f "${OUTPUT_DIR}/dex-ca.crt" ] || [ ! -f "${OUTPUT_DIR}/dex-server.crt" ] || [ ! -f "${OUTPUT_DIR}/dex-server.key" ]; then
    echo "Error: Dex certificates not found. Please run generate-dex-tls.sh first."
    exit 1
fi

# Get Dex hostname from certificate generation
if [ ! -f "${OUTPUT_DIR}/dex-hostname.txt" ]; then
    echo "Error: Dex hostname not found. Please run generate-dex-tls.sh first."
    exit 1
fi
DEX_HOST=$(cat "${OUTPUT_DIR}/dex-hostname.txt")

# Use Dex config and substitute hostname (only in issuer URL, not file paths)
DEX_CONFIG="${OUTPUT_DIR}/dex.yaml"
sed "s|https://dex-server:10443/dex|https://${DEX_HOST}:10443/dex|g" "${SCRIPT_DIR}/dex.yaml" > "${DEX_CONFIG}"

# Stop and remove existing Dex container if it exists
if docker ps -a --format '{{.Names}}' | grep -q "^dex-server$"; then
    echo "Stopping existing Dex container..."
    docker stop dex-server 2>/dev/null || true
    docker rm dex-server 2>/dev/null || true
fi

# Ensure certificate files have correct permissions on host
# Make files readable by the Dex user in the container (644 = readable by all)
chmod 644 "${OUTPUT_DIR}/dex-server.crt" "${DEX_CONFIG}" 2>/dev/null || true
chmod 644 "${OUTPUT_DIR}/dex-server.key" 2>/dev/null || true

# Create Dex container with bind mounts for certificates and config
# Using bind mounts preserves file permissions and avoids permission issues
echo "Creating Dex container..."
docker run -d --name dex-server -p 10443:10443 \
  -v "${OUTPUT_DIR}/dex-server.crt:/dex-server.crt:ro" \
  -v "${OUTPUT_DIR}/dex-server.key:/dex-server.key:ro" \
  -v "${DEX_CONFIG}:/dex.yaml:ro" \
  "ghcr.io/dexidp/dex:${DEX_VERSION}" dex serve /dex.yaml

# Wait for Dex to be ready
echo "Waiting for Dex to be ready..."
sleep 3

echo ""
echo "Dex server started successfully!"
echo "Dex hostname: ${DEX_HOST}"
echo "Dex is accessible at: https://${DEX_HOST}:10443/dex"
