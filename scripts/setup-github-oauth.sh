#!/bin/bash
set -e

SCRIPT_DIR=$(dirname "$0")
PROJECT_ROOT=$(dirname "$SCRIPT_DIR")
OUTPUT_DIR="${PROJECT_ROOT}/scripts/dex-certs"

# Get callback URL - Dex will be accessible at localhost:10443
CALLBACK_URL="http://localhost:8000"
DEX_ISSUER_URL="https://dex-server:10443/dex"

APP_NAME="Dex OIDC (Kind Cluster)"
APP_HOMEPAGE="https://github.com"

echo "Setting up GitHub OAuth App for Dex..."
echo "Callback URL: ${CALLBACK_URL}"
echo "Dex Issuer URL: ${DEX_ISSUER_URL}"
echo ""

# Check if credentials already exist
if [ -f "${OUTPUT_DIR}/github-client-id.txt" ] && [ -f "${OUTPUT_DIR}/github-client-secret.txt" ]; then
    echo "GitHub OAuth credentials already exist."
    echo "Client ID: $(cat "${OUTPUT_DIR}/github-client-id.txt")"
    echo ""
    read -p "Do you want to create a new OAuth app? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Using existing credentials."
        exit 0
    fi
fi

# Check if gh CLI is installed and try automated creation
if command -v gh &> /dev/null && gh auth status &> /dev/null; then
    echo "Attempting to create OAuth app via GitHub CLI..."

    # Try to create using GitHub API
    # Note: This endpoint might not be available or might require special permissions
    OUTPUT=$(gh api -X POST /user/applications/oauth \
      -f name="${APP_NAME}" \
      -f homepage_url="${APP_HOMEPAGE}" \
      -f callback_url="${CALLBACK_URL}" \
      2>&1) && {
        # Extract client ID and secret from output
        CLIENT_ID=$(echo "$OUTPUT" | jq -r '.client_id // empty' 2>/dev/null)
        CLIENT_SECRET=$(echo "$OUTPUT" | jq -r '.client_secret // empty' 2>/dev/null)

        if [ -n "$CLIENT_ID" ] && [ "$CLIENT_ID" != "null" ] && [ -n "$CLIENT_SECRET" ]; then
            # Save credentials
            mkdir -p "${OUTPUT_DIR}"
            echo "${CLIENT_ID}" > "${OUTPUT_DIR}/github-client-id.txt"
            echo "${CLIENT_SECRET}" > "${OUTPUT_DIR}/github-client-secret.txt"

            echo ""
            echo "✓ GitHub OAuth App created successfully via API!"
            echo "Client ID: ${CLIENT_ID}"
            echo "Client Secret: ${CLIENT_SECRET}"
            echo ""
            echo "Credentials saved to:"
            echo "  - ${OUTPUT_DIR}/github-client-id.txt"
            echo "  - ${OUTPUT_DIR}/github-client-secret.txt"
            exit 0
        fi
    }

    echo "API creation failed or not available. Falling back to manual instructions."
    echo ""
fi

# Manual creation instructions
echo "Please create a GitHub OAuth App manually:"
echo ""
echo "1. Go to: https://github.com/settings/developers"
echo "2. Click 'New OAuth App' (or 'Register a new application')"
echo "3. Fill in the following:"
echo "   - Application name: ${APP_NAME}"
echo "   - Homepage URL: ${APP_HOMEPAGE}"
echo "   - Authorization callback URL: ${CALLBACK_URL}"
echo "4. Click 'Register application'"
echo "5. Copy the 'Client ID' and generate a 'Client secret'"
echo ""
read -p "Press Enter when you have the Client ID and Client Secret ready..."

# Prompt for credentials
read -p "Enter Client ID: " CLIENT_ID
read -sp "Enter Client Secret: " CLIENT_SECRET
echo ""

if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ]; then
    echo "Error: Client ID and Client Secret are required."
    exit 1
fi

# Save credentials
mkdir -p "${OUTPUT_DIR}"
echo "${CLIENT_ID}" > "${OUTPUT_DIR}/github-client-id.txt"
echo "${CLIENT_SECRET}" > "${OUTPUT_DIR}/github-client-secret.txt"

echo ""
echo "✓ Credentials saved successfully!"
echo "Client ID: ${CLIENT_ID}"
echo ""
echo "Credentials saved to:"
echo "  - ${OUTPUT_DIR}/github-client-id.txt"
echo "  - ${OUTPUT_DIR}/github-client-secret.txt"

# Save credentials
mkdir -p "${OUTPUT_DIR}"
echo "${CLIENT_ID}" > "${OUTPUT_DIR}/github-client-id.txt"
echo "${CLIENT_SECRET}" > "${OUTPUT_DIR}/github-client-secret.txt"

echo ""
echo "GitHub OAuth App created successfully!"
echo "Client ID: ${CLIENT_ID}"
echo "Client Secret: ${CLIENT_SECRET}"
echo ""
echo "Credentials saved to:"
echo "  - ${OUTPUT_DIR}/github-client-id.txt"
echo "  - ${OUTPUT_DIR}/github-client-secret.txt"
echo ""
echo "To delete this OAuth app later, you can find it at:"
echo "  https://github.com/settings/developers"
