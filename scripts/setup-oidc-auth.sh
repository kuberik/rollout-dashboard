#!/bin/bash
# Deploy oauth2-proxy in auth-only mode and configure Envoy Gateway extAuth.
#
# Architecture:
#   Browser → Envoy Gateway (TLS) → SecurityPolicy (extAuth → oauth2-proxy /oauth2/auth)
#                                      ↓ 200: inject Authorization header → dashboard
#                                      ↓ 302: redirect to /oauth2/start (login flow)
#   /oauth2/* → HTTPRoute → oauth2-proxy (no auth, handles OIDC dance with Dex)
#
# oauth2-proxy runs with --upstream=static://200: it never proxies traffic, only checks
# session cookies and injects auth headers. Any new service needing auth just gets the
# SecurityPolicy applied to its HTTPRoute.
#
# Env vars (all optional, defaults match single-cluster setup):
#   HOSTNAME_PREFIX  — subdomain prefix for dashboard hostname (default: kuberik)
#   HOST_PORT        — host port mapped to kind cluster NodePort (default: 8080)
set -e

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
OUTPUT_DIR="${SCRIPT_DIR}/dex-certs"
REDIRECT_URIS_FILE="${OUTPUT_DIR}/redirect-uris.txt"

# Get Dex hostname
if [ ! -f "${OUTPUT_DIR}/dex-hostname.txt" ]; then
    echo "Error: Dex hostname not found. Please run setup-kind-cluster.sh first."
    exit 1
fi
DEX_HOST=$(cat "${OUTPUT_DIR}/dex-hostname.txt")
DEX_ISSUER_URL="https://${DEX_HOST}:10443/dex"

# Compute dashboard hostname and OAuth2 redirect URI for this cluster
HOST_IP=$(ip route get 8.8.8.8 | awk '{print $7; exit}' || hostname -I | awk '{print $1}')
HOSTNAME_PREFIX="${HOSTNAME_PREFIX:-kuberik}"
HOST_PORT="${HOST_PORT:-8080}"
DASHBOARD_HOSTNAME="${HOSTNAME_PREFIX}.${HOST_IP}.nip.io"
DASHBOARD_URL="https://${DASHBOARD_HOSTNAME}:${HOST_PORT}"
# Redirect URI always uses port 443 (the user-facing URL via socat/haproxy/vite).
# For the hub: port 443 → socat/haproxy → vite → vite proxies /oauth2/ → port 8080 → oauth2-proxy.
# For the spoke: port 443 → haproxy → spoke kind envoy → oauth2-proxy.
# Using a different port here would split the OAuth2 flow across ports, breaking CSRF
# (the CSRF cookie is set at /oauth2/start but the callback would land on a different port).
REDIRECT_URI="https://${DASHBOARD_HOSTNAME}/oauth2/callback"

echo "Configuring OIDC auth via oauth2-proxy extAuth..."
echo "  Dex issuer:    ${DEX_ISSUER_URL}"
echo "  Dashboard URL: ${DASHBOARD_URL}"
echo "  Redirect URI:  ${REDIRECT_URI}"

# --- Accumulate redirect URIs (for multi-cluster: each cluster adds its own) ---
touch "${REDIRECT_URIS_FILE}"
if ! grep -qF "${REDIRECT_URI}" "${REDIRECT_URIS_FILE}"; then
    echo "${REDIRECT_URI}" >> "${REDIRECT_URIS_FILE}"
fi
sort -u "${REDIRECT_URIS_FILE}" -o "${REDIRECT_URIS_FILE}"

# --- Regenerate Dex config with all accumulated redirect URIs ---
DEX_CONFIG="${OUTPUT_DIR}/dex.yaml"
{
cat <<EOF
issuer: ${DEX_ISSUER_URL}
web:
  https: 0.0.0.0:10443
  tlsCert: /dex-server.crt
  tlsKey: /dex-server.key
storage:
  type: sqlite3
  config:
    # Persisted on a docker volume so signing keys survive restarts.
    # If keys rotated each restart, kube-apiserver would keep a stale
    # JWKS cache and reject every token until its next refresh.
    file: /var/dex/dex.db
staticClients:
  - id: kubernetes
    redirectURIs:
      - http://localhost:8000
    name: kubernetes
    secret: kubernetes-client-secret
    trustedPeers:
    - rollout-dashboard
  - id: rollout-dashboard
    redirectURIs:
EOF
while IFS= read -r uri; do
    echo "      - ${uri}"
done < "${REDIRECT_URIS_FILE}"
cat <<'EOF'
    name: Rollout Dashboard
    secret: rollout-dashboard-secret
enablePasswordDB: true
oauth2:
  passwordConnector: local
staticPasswords:
  - email: "admin@example.com"
    hash: "$2a$10$2b2cU8CPhOTaGrs1HRQuAueS7JTT5ZHsHSzYiFPm1leZck7Mc8T4W"
    username: "admin"
    userID: "08a8684b-db88-4b73-90a9-3cd1661f5466"
EOF
} > "${DEX_CONFIG}"

# --- Restart Dex with updated config ---
echo "Restarting Dex with updated redirect URIs..."
if docker ps -a --format '{{.Names}}' | grep -q "^dex-server$"; then
    docker stop dex-server 2>/dev/null || true
    docker rm dex-server 2>/dev/null || true
fi
chmod 644 "${OUTPUT_DIR}/dex-server.crt" "${DEX_CONFIG}" 2>/dev/null || true
chmod 644 "${OUTPUT_DIR}/dex-server.key" 2>/dev/null || true
# Persistent volume for the dex sqlite db — keeps signing keys stable across
# script reruns (see storage.config.file in the dex config above).
docker volume inspect dex-storage >/dev/null 2>&1 || docker volume create dex-storage >/dev/null
docker run -d --name dex-server -p 10443:10443 \
  -v "${OUTPUT_DIR}/dex-server.crt:/dex-server.crt:ro" \
  -v "${OUTPUT_DIR}/dex-server.key:/dex-server.key:ro" \
  -v "${DEX_CONFIG}:/dex.yaml:ro" \
  -v dex-storage:/var/dex \
  "ghcr.io/dexidp/dex:v2.44.0" dex serve /dex.yaml
echo "Waiting for Dex to be ready..."
sleep 3

# --- K8s resources: deploy oauth2-proxy and configure Envoy extAuth ---

# Client secret and cookie secret
CLIENT_SECRET="rollout-dashboard-secret"
COOKIE_SECRET=$(openssl rand -base64 32 | tr -- '+/' '-_' | head -c 32)

kubectl create secret generic oauth2-proxy-secrets \
  --from-literal=client-secret="${CLIENT_SECRET}" \
  --from-literal=cookie-secret="${COOKIE_SECRET}" \
  -n kuberik-system \
  --dry-run=client -o yaml | kubectl apply -f -

# Dex CA cert ConfigMap (needed by oauth2-proxy to trust Dex's self-signed cert)
kubectl create configmap dex-ca-cert \
  --from-file=ca.crt="${OUTPUT_DIR}/dex-ca.crt" \
  -n kuberik-system \
  --dry-run=client -o yaml | kubectl apply -f -

# oauth2-proxy Deployment
cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oauth2-proxy
  namespace: kuberik-system
spec:
  replicas: 1
  selector:
    matchLabels:
      app: oauth2-proxy
  template:
    metadata:
      labels:
        app: oauth2-proxy
    spec:
      containers:
      - name: oauth2-proxy
        image: quay.io/oauth2-proxy/oauth2-proxy:v7.7.1
        args:
        - --provider=oidc
        - --oidc-issuer-url=${DEX_ISSUER_URL}
        - --client-id=rollout-dashboard
        - --email-domain=*
        - --upstream=static://200
        - --http-address=0.0.0.0:4180
        - --redirect-url=${REDIRECT_URI}
        - --scope=openid email profile groups audience:server:client_id:kubernetes
        - --set-authorization-header=true
        - --pass-access-token=true
        - --set-xauthrequest=true
        - --oidc-extra-audience=kubernetes
        - --skip-provider-button=true
        - --cookie-secure=true
        - --cookie-samesite=lax
        - --reverse-proxy=true
        - --provider-ca-file=/etc/ssl/dex/ca.crt
        # Accept JWT bearer tokens signed by Dex without requiring a session cookie.
        # Lets vite dev server inject an Authorization header obtained via ROPC,
        # so local dev doesn't need the interactive login flow.
        - --skip-jwt-bearer-tokens=true
        env:
        - name: OAUTH2_PROXY_CLIENT_SECRET
          valueFrom:
            secretKeyRef:
              name: oauth2-proxy-secrets
              key: client-secret
        - name: OAUTH2_PROXY_COOKIE_SECRET
          valueFrom:
            secretKeyRef:
              name: oauth2-proxy-secrets
              key: cookie-secret
        ports:
        - containerPort: 4180
        volumeMounts:
        - name: dex-ca
          mountPath: /etc/ssl/dex
          readOnly: true
      volumes:
      - name: dex-ca
        configMap:
          name: dex-ca-cert
---
apiVersion: v1
kind: Service
metadata:
  name: oauth2-proxy
  namespace: kuberik-system
spec:
  selector:
    app: oauth2-proxy
  ports:
  - port: 4180
    targetPort: 4180
EOF

# HTTPRoute for /oauth2/* — handled by oauth2-proxy, NO SecurityPolicy applied.
# This must be a separate HTTPRoute so the extAuth SecurityPolicy (on rollout-dashboard
# HTTPRoute) doesn't also gate the OAuth2 flow itself.
cat <<EOF | kubectl apply -f -
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: oauth2-proxy
  namespace: kuberik-system
spec:
  parentRefs:
    - name: rollout-dashboard-gateway
      namespace: kuberik-system
  hostnames:
    - ${DASHBOARD_HOSTNAME}
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /oauth2
      backendRefs:
        - name: oauth2-proxy
          port: 4180
EOF

# Update the dashboard HTTPRoute (all non-/oauth2 traffic goes to the dashboard).
cat <<EOF | kubectl apply -f -
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: rollout-dashboard
  namespace: kuberik-system
  annotations:
    gateway.envoyproxy.io/response-buffering: "false"
spec:
  parentRefs:
    - name: rollout-dashboard-gateway
      namespace: kuberik-system
  hostnames:
    - ${DASHBOARD_HOSTNAME}
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /
      timeouts:
        backendRequest: 0s
      backendRefs:
        - name: rollout-dashboard
          port: 80
EOF

# Remove old Envoy native OIDC SecurityPolicy if present from a previous setup.
kubectl delete securitypolicy rollout-dashboard-oidc -n kuberik-system 2>/dev/null || true

# SecurityPolicy: extAuth using oauth2-proxy.
# Envoy sends each request to oauth2-proxy /oauth2/auth (via the original request path).
# oauth2-proxy checks the session cookie:
#   authenticated  → 200 + sets Authorization/X-Auth-Request-* headers
#   unauthenticated → 302 to /oauth2/start (handled by oauth2-proxy HTTPRoute, no loop)
# headersToBackend copies the auth service response headers into the upstream request.
cat <<EOF | kubectl apply -f -
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: SecurityPolicy
metadata:
  name: oauth2-proxy-auth
  namespace: kuberik-system
spec:
  targetRefs:
    - group: gateway.networking.k8s.io
      kind: HTTPRoute
      name: rollout-dashboard
  extAuth:
    http:
      backendRefs:
        - name: oauth2-proxy
          port: 4180
          namespace: kuberik-system
      headersToBackend:
        - Authorization
        - X-Auth-Request-User
        - X-Auth-Request-Email
        - X-Auth-Request-Access-Token
EOF

# Wait for oauth2-proxy to be ready
echo "Waiting for oauth2-proxy to be ready..."
kubectl rollout status deployment/oauth2-proxy -n kuberik-system --timeout=120s

echo ""
echo "✓ OIDC auth configured via oauth2-proxy extAuth"
echo ""
echo "  Dashboard: ${DASHBOARD_URL}"
echo "  Auth flow: Envoy → extAuth(oauth2-proxy) → dashboard"
echo "  Login:     ${DASHBOARD_URL}/oauth2/start"
echo ""
echo "  Credentials: admin@example.com / password"
