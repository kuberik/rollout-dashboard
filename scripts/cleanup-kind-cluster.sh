#!/bin/bash
set -e

echo "Cleaning up Kind cluster..."

# Delete Kind cluster
kind delete cluster --name rollout-dev

# Remove certificates directory
SCRIPT_DIR=$(dirname "$0")
PROJECT_ROOT=$(dirname "$SCRIPT_DIR")
rm -rf "${PROJECT_ROOT}/certs"
rm -rf "${PROJECT_ROOT}/.docker"

# Remove registry entry from /etc/hosts if it exists
if grep -q "registry:5000" /etc/hosts; then
    sudo sed -i '' '/registry:5000/d' /etc/hosts
fi

echo "Cleanup complete!"
