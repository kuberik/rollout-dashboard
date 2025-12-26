#!/bin/bash
set -e

SCRIPT_DIR=$(dirname "$0")
PROJECT_ROOT=$(dirname "$SCRIPT_DIR")
OUTPUT_DIR="${SCRIPT_DIR}/dex-certs"

# Get Dex hostname
if [ ! -f "${OUTPUT_DIR}/dex-hostname.txt" ]; then
    echo "Error: Dex hostname not found. Please run setup-kind-cluster.sh first."
    exit 1
fi
DEX_HOST=$(cat "${OUTPUT_DIR}/dex-hostname.txt")
DEX_ISSUER_URL="https://${DEX_HOST}:10443/dex"

# Get host IP for the dashboard URL
HOST_IP=$(ip route get 8.8.8.8 | awk '{print $7; exit}' || hostname -I | awk '{print $1}')
DASHBOARD_URL="https://${HOST_IP}.nip.io:8080"

echo "Configuring OIDC authentication for rollout dashboard using Envoy Gateway SecurityPolicy..."
echo "Dex issuer URL: ${DEX_ISSUER_URL}"
echo "Dashboard URL: ${DASHBOARD_URL}"

# OAuth2 client credentials
# Use rollout-dashboard client and request tokens with audience "kubernetes"
# via cross-client trust (kubernetes client trusts rollout-dashboard)
CLIENT_ID="rollout-dashboard"
CLIENT_SECRET="rollout-dashboard-secret"

# Cookie names for Envoy Gateway OIDC
ACCESS_TOKEN_COOKIE="access_token"
ID_TOKEN_COOKIE="id_token"

# Remove OAuth2 proxy if it exists
kubectl delete deployment oauth2-proxy -n kuberik-system 2>/dev/null || true
kubectl delete service oauth2-proxy -n kuberik-system 2>/dev/null || true

# Create secret with OAuth2 client credentials
kubectl create secret generic rollout-dashboard-oidc \
  --from-literal=client-secret="${CLIENT_SECRET}" \
  -n kuberik-system \
  --dry-run=client -o yaml | kubectl apply -f -

# Create ConfigMap with Dex CA certificate for BackendTLSPolicy
kubectl create configmap dex-ca-cert \
  --from-file=ca.crt="${OUTPUT_DIR}/dex-ca.crt" \
  -n kuberik-system \
  --dry-run=client -o yaml | kubectl apply -f -

# Create Backend resource for Dex OIDC provider (for self-signed certificate support)
cat <<EOF | kubectl apply -f -
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: Backend
metadata:
  name: dex-oidc-provider
  namespace: kuberik-system
spec:
  endpoints:
  - fqdn:
      hostname: '${DEX_HOST}'
      port: 10443
EOF

# Create BackendTLSPolicy separately (may need to delete old one first)
kubectl delete backendlspolicy dex-ca-policy -n kuberik-system 2>/dev/null || true
sleep 1
cat <<EOF | kubectl apply -f -
apiVersion: gateway.networking.k8s.io/v1alpha3
kind: BackendTLSPolicy
metadata:
  name: dex-ca-policy
  namespace: kuberik-system
spec:
  targetRefs:
  - group: gateway.envoyproxy.io
    kind: Backend
    name: dex-oidc-provider
  validation:
    caCertificateRefs:
    - name: dex-ca-cert
      group: ""
      kind: ConfigMap
    hostname: ${DEX_HOST}
EOF

# Wait for Backend to be ready
echo "Waiting for Backend resource to be ready..."
sleep 2

# Create SecurityPolicy with OIDC configuration and cookie names
# Request the audience:server:client_id:kubernetes scope to get tokens with audience "kubernetes"
# See: https://dexidp.io/docs/configuration/custom-scopes-claims-clients/#cross-client-trust-and-authorized-party
cat <<EOF | kubectl apply -f -
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: SecurityPolicy
metadata:
  name: rollout-dashboard-oidc
  namespace: kuberik-system
spec:
  targetRefs:
    - group: gateway.networking.k8s.io
      kind: HTTPRoute
      name: rollout-dashboard
  oidc:
    provider:
      issuer: ${DEX_ISSUER_URL}
      authorizationEndpoint: ${DEX_ISSUER_URL}/auth
      tokenEndpoint: ${DEX_ISSUER_URL}/token
    clientID: ${CLIENT_ID}
    clientSecret:
      name: rollout-dashboard-oidc
    redirectURL: ${DASHBOARD_URL}/oauth2/callback
    logoutPath: /oauth2/sign_out
    forwardAccessToken: true
    cookieNames:
      accessToken: ${ACCESS_TOKEN_COOKIE}
      idToken: ${ID_TOKEN_COOKIE}
    scopes:
    - openid
    - email
    - profile
    - groups
    - audience:server:client_id:kubernetes
EOF

# Update HTTPRoute to point back to dashboard (not OAuth2 proxy)
cat <<EOF | kubectl apply -f -
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: rollout-dashboard
  namespace: kuberik-system
spec:
  parentRefs:
    - name: rollout-dashboard-gateway
      namespace: kuberik-system
  hostnames:
    - ${HOST_IP}.nip.io
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /
      backendRefs:
        - name: rollout-dashboard
          port: 80
EOF

# Update Dex configuration with dashboard URL
echo "Updating Dex configuration with dashboard OAuth2 client..."
DEX_CONFIG="${OUTPUT_DIR}/dex.yaml"
DEX_CONFIG_TEMPLATE="${SCRIPT_DIR}/dex.yaml"

# Generate Dex config with hostname and dashboard URL substitution
sed -e "s|https://dex-server:10443/dex|https://${DEX_HOST}:10443/dex|g" \
    -e "s|DASHBOARD_URL_PLACEHOLDER|${HOST_IP}.nip.io|g" \
    "${DEX_CONFIG_TEMPLATE}" > "${DEX_CONFIG}.tmp"

# Verify the replacement worked and move to final location
if grep -q "DASHBOARD_URL_PLACEHOLDER" "${DEX_CONFIG}.tmp"; then
    echo "Error: Dashboard URL placeholder not replaced in Dex config"
    exit 1
fi
mv "${DEX_CONFIG}.tmp" "${DEX_CONFIG}"

# Restart Dex with new configuration
echo "Restarting Dex with updated configuration..."
"${SCRIPT_DIR}/setup-dex.sh"

# setup-dex.sh regenerates the config, so we need to update it again with the dashboard URL
echo "Updating Dex config with dashboard redirect URL..."
sed -i "s|DASHBOARD_URL_PLACEHOLDER|${HOST_IP}.nip.io|g" "${DEX_CONFIG}"

# Restart Dex again with the corrected config
if docker ps --format '{{.Names}}' | grep -q "^dex-server$"; then
    echo "Restarting Dex with corrected redirect URL..."
    docker restart dex-server
    sleep 2
fi

echo ""
echo "✓ OIDC authentication configured for rollout dashboard using Envoy Gateway SecurityPolicy"
echo ""
echo "The dashboard is now protected by Envoy Gateway's native OIDC authentication."
echo "Access the dashboard at: ${DASHBOARD_URL}"
echo ""
echo "You will be redirected to Dex for authentication."
echo "Default credentials: admin@example.com / password"
echo ""
echo "Cookie names configured:"
echo "  - Access Token: ${ACCESS_TOKEN_COOKIE}"
echo "  - ID Token: ${ID_TOKEN_COOKIE}"
