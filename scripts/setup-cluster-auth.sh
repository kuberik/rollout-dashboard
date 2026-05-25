#!/bin/bash
# Cluster-level OIDC auth gate. Dashboard-agnostic: deploys oauth2-proxy as
# shared auth infrastructure in the auth-system namespace. Any HTTPRoute in
# any namespace can opt in by creating its own SecurityPolicy with extAuth
# pointing at auth-system/oauth2-proxy.
#
# Architecture:
#   Browser → Envoy Gateway (TLS) → SecurityPolicy (extAuth → oauth2-proxy /oauth2/auth)
#                                      ↓ 200: inject Authorization header → upstream
#                                      ↓ 302: redirect to /oauth2/start (login flow)
#   /oauth2/* → HTTPRoute in auth-system → oauth2-proxy (no auth, OIDC dance)
#
# oauth2-proxy never sees the upstream backend. Adding a new gated service is:
#   1. Apply a SecurityPolicy (3 lines of extAuth config)
#   2. The cross-namespace ReferenceGrant created here lets the policy point
#      at the shared oauth2-proxy without any per-app oauth2-proxy install.
#
# OIDC layout:
#   - Dex runs as a docker container on the host (shared across kind clusters).
#   - This script registers the cluster's redirect URI with Dex and restarts it.
#   - The OIDC client is generic ("kuberik-cluster"), trusted by the kubernetes
#     client so the same id_token is accepted by both oauth2-proxy and kube-apiserver.
#
# Env vars (all optional):
#   HOSTNAME_PREFIX  — subdomain prefix for the cluster's hostname (default: kuberik)
#                       Used to derive HOST=<HOSTNAME_PREFIX>.<HOST_IP>.nip.io as the
#                       canonical host where oauth2-proxy serves /oauth2/*.
#   COOKIE_DOMAIN    — cookie scope (default: $HOST). Set to a parent domain
#                       like ".${HOST_IP}.nip.io" to share session across more hosts.
set -e

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
OUTPUT_DIR="${SCRIPT_DIR}/dex-certs"
REDIRECT_URIS_FILE="${OUTPUT_DIR}/redirect-uris.txt"

if [ ! -f "${OUTPUT_DIR}/dex-hostname.txt" ]; then
    echo "Error: Dex hostname not found. Please run setup-kind-cluster.sh first."
    exit 1
fi
DEX_HOST=$(cat "${OUTPUT_DIR}/dex-hostname.txt")
DEX_ISSUER_URL="https://${DEX_HOST}:10443/dex"

HOST_IP=$(ip route get 8.8.8.8 | awk '{print $7; exit}' || hostname -I | awk '{print $1}')
HOSTNAME_PREFIX="${HOSTNAME_PREFIX:-kuberik}"
HOST="${HOSTNAME_PREFIX}.${HOST_IP}.nip.io"
COOKIE_DOMAIN="${COOKIE_DOMAIN:-${HOST}}"
# Single canonical redirect URI per cluster — the OAuth2 callback always lands
# here regardless of which gated subdomain started the flow.
REDIRECT_URI="https://${HOST}/oauth2/callback"
OIDC_CLIENT_ID="kuberik-cluster"
OIDC_CLIENT_SECRET="kuberik-cluster-secret"

echo "Configuring cluster auth gate via oauth2-proxy extAuth..."
echo "  Dex issuer:    ${DEX_ISSUER_URL}"
echo "  Canonical host: ${HOST}"
echo "  Cookie domain: ${COOKIE_DOMAIN}"
echo "  Redirect URI:  ${REDIRECT_URI}"
echo "  OIDC client:   ${OIDC_CLIENT_ID}"

# --- Accumulate redirect URIs across cluster setups ---
touch "${REDIRECT_URIS_FILE}"
if ! grep -qF "${REDIRECT_URI}" "${REDIRECT_URIS_FILE}"; then
    echo "${REDIRECT_URI}" >> "${REDIRECT_URIS_FILE}"
fi
sort -u "${REDIRECT_URIS_FILE}" -o "${REDIRECT_URIS_FILE}"

# --- Regenerate Dex config ---
# One OIDC client. Both oauth2-proxy and kube-apiserver are configured to
# accept aud=kuberik-cluster, so the same id_token authenticates against both
# without any provider-specific cross-client trickery (works with Okta, Auth0,
# Google, etc. — not just Dex's trustedPeers feature).
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
  - id: ${OIDC_CLIENT_ID}
    name: Kuberik Cluster
    secret: ${OIDC_CLIENT_SECRET}
    redirectURIs:
      # First entry is the kubectl oidc-login local callback for kubectl access.
      - http://localhost:8000
EOF
while IFS= read -r uri; do
    echo "      - ${uri}"
done < "${REDIRECT_URIS_FILE}"
cat <<'EOF'
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
# script reruns.
docker volume inspect dex-storage >/dev/null 2>&1 || docker volume create dex-storage >/dev/null
docker run -d --name dex-server -p 10443:10443 \
  -v "${OUTPUT_DIR}/dex-server.crt:/dex-server.crt:ro" \
  -v "${OUTPUT_DIR}/dex-server.key:/dex-server.key:ro" \
  -v "${DEX_CONFIG}:/dex.yaml:ro" \
  -v dex-storage:/var/dex \
  "ghcr.io/dexidp/dex:v2.44.0" dex serve /dex.yaml
echo "Waiting for Dex to be ready..."
sleep 3

# --- auth-system namespace + shared oauth2-proxy ---

kubectl create ns auth-system -o yaml --dry-run=client | kubectl apply -f -

# Restart kube-apiserver to flush its stale JWKS cache after Dex restart.
# Without this, recently-issued tokens fail signature verification until the
# apiserver's next periodic refresh (which can be minutes).
echo "Flushing kube-apiserver JWKS cache..."
KIND_CONTAINER=$(kubectl config current-context | sed 's/^kind-//')-control-plane
docker exec "${KIND_CONTAINER}" sh -c \
    "mv /etc/kubernetes/manifests/kube-apiserver.yaml /tmp/kas.yaml && sleep 3 && mv /tmp/kas.yaml /etc/kubernetes/manifests/kube-apiserver.yaml" || true
until kubectl get --raw=/readyz >/dev/null 2>&1; do sleep 2; done
echo "kube-apiserver ready"

# Client secret + cookie secret
COOKIE_SECRET=$(openssl rand -base64 32 | tr -- '+/' '-_' | head -c 32)

kubectl create secret generic oauth2-proxy-secrets \
  --from-literal=client-secret="${OIDC_CLIENT_SECRET}" \
  --from-literal=cookie-secret="${COOKIE_SECRET}" \
  -n auth-system \
  --dry-run=client -o yaml | kubectl apply -f -

# Dex CA cert (oauth2-proxy must trust Dex's self-signed cert).
kubectl create configmap dex-ca-cert \
  --from-file=ca.crt="${OUTPUT_DIR}/dex-ca.crt" \
  -n auth-system \
  --dry-run=client -o yaml | kubectl apply -f -

# oauth2-proxy Deployment + Service.
# --skip-jwt-bearer-tokens lets services with a valid id_token call gated
# routes directly (multi-cluster hub→spoke fan-out, CI jobs, vite dev ROPC).
# --cookie-domain shares the session across any subdomain of the canonical host.
cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oauth2-proxy
  namespace: auth-system
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
        - --client-id=${OIDC_CLIENT_ID}
        - --email-domain=*
        - --upstream=static://200
        - --http-address=0.0.0.0:4180
        - --redirect-url=${REDIRECT_URI}
        - --scope=openid email profile groups
        - --set-authorization-header=true
        - --pass-access-token=true
        - --set-xauthrequest=true
        - --skip-provider-button=true
        - --cookie-secure=true
        - --cookie-samesite=lax
        - --cookie-domain=${COOKIE_DOMAIN}
        - --whitelist-domain=${COOKIE_DOMAIN}
        - --reverse-proxy=true
        - --provider-ca-file=/etc/ssl/dex/ca.crt
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
  namespace: auth-system
spec:
  selector:
    app: oauth2-proxy
  ports:
  - port: 4180
    targetPort: 4180
EOF

# HTTPRoute for /oauth2/*. No hostname filter — inherits all gateway hostnames,
# so /oauth2/start and /oauth2/callback resolve on whichever subdomain the
# user is on. The Gateway lives in kuberik-system but accepts routes from all
# namespaces (see setup-dev-environment.sh).
cat <<EOF | kubectl apply -f -
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: oauth2-proxy
  namespace: auth-system
spec:
  parentRefs:
    - name: rollout-dashboard-gateway
      namespace: kuberik-system
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /oauth2
      backendRefs:
        - name: oauth2-proxy
          port: 4180
EOF

# ReferenceGrant: allow SecurityPolicies in any namespace to reference
# auth-system/oauth2-proxy as their extAuth backend. Apps don't need to
# install their own oauth2-proxy or copy any auth-system manifests — just
# create a SecurityPolicy targeting their own HTTPRoute.
cat <<EOF | kubectl apply -f -
apiVersion: gateway.networking.k8s.io/v1beta1
kind: ReferenceGrant
metadata:
  name: oauth2-proxy-from-all
  namespace: auth-system
spec:
  from:
    - group: gateway.envoyproxy.io
      kind: SecurityPolicy
      namespace: kuberik-system
  to:
    - group: ""
      kind: Service
      name: oauth2-proxy
EOF

# Remove legacy auth resources from kuberik-system that older setup-oidc-auth.sh
# left behind. Safe no-ops on a fresh cluster.
kubectl -n kuberik-system delete deployment oauth2-proxy 2>/dev/null || true
kubectl -n kuberik-system delete service oauth2-proxy 2>/dev/null || true
kubectl -n kuberik-system delete secret oauth2-proxy-secrets 2>/dev/null || true
kubectl -n kuberik-system delete configmap dex-ca-cert 2>/dev/null || true
kubectl -n kuberik-system delete httproute oauth2-proxy 2>/dev/null || true
kubectl -n kuberik-system delete securitypolicy rollout-dashboard-oidc 2>/dev/null || true
kubectl -n kuberik-system delete securitypolicy oauth2-proxy-auth 2>/dev/null || true

# Wait for oauth2-proxy
echo "Waiting for oauth2-proxy to be ready..."
kubectl rollout status deployment/oauth2-proxy -n auth-system --timeout=120s

echo ""
echo "✓ Cluster auth gate configured"
echo ""
echo "  oauth2-proxy: auth-system/oauth2-proxy (port 4180)"
echo "  OIDC client:  ${OIDC_CLIENT_ID}"
echo "  Cookie scope: ${COOKIE_DOMAIN}"
echo ""
echo "  Gate any HTTPRoute in any namespace by applying:"
echo ""
echo "    apiVersion: gateway.envoyproxy.io/v1alpha1"
echo "    kind: SecurityPolicy"
echo "    metadata: { name: my-app-auth, namespace: <your-ns> }"
echo "    spec:"
echo "      targetRefs:"
echo "        - { group: gateway.networking.k8s.io, kind: HTTPRoute, name: <your-route> }"
echo "      extAuth:"
echo "        http:"
echo "          backendRefs:"
echo "            - { name: oauth2-proxy, namespace: auth-system, port: 4180 }"
echo "          headersToBackend: [Authorization, X-Auth-Request-User, X-Auth-Request-Email]"
