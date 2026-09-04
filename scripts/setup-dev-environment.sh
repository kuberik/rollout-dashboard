#!/bin/bash
set -e
set -x

SCRIPT_DIR=$(dirname "$0")
GITHUB_TOKEN=${GITHUB_TOKEN:-$(gh auth token)}

# GitHub App credentials come from rollout-dashboard/.env (gitignored) so a cluster
# reset keeps the GitHub login without exporting them by hand. The .env held the
# secret for two months while the script only ever looked at the environment, and
# printed "skipping github-app-credentials" every run. Exported vars still win;
# tracing is paused so the secret never lands in the set -x log.
_env_id="${GITHUB_APP_CLIENT_ID:-}"; _env_secret="${GITHUB_APP_CLIENT_SECRET:-}"
if [ -f "${SCRIPT_DIR}/../.env" ]; then
  set +x; set -a; . "${SCRIPT_DIR}/../.env"; set +a; set -x
fi
[ -n "$_env_id" ] && GITHUB_APP_CLIENT_ID="$_env_id"
[ -n "$_env_secret" ] && GITHUB_APP_CLIENT_SECRET="$_env_secret"

# Parameters (defaults match the original single-cluster setup):
#   CLUSTER_NAME       — kind cluster name (default: rollout-dev)
#   HOSTNAME_PREFIX    — subdomain prefix for the dashboard (default: kuberik)
#                         e.g. "kuberik" → kuberik.<HOST_IP>.nip.io
#                              "kuberik-spoke" → kuberik-spoke.<HOST_IP>.nip.io
#   CLUSTER_DISPLAY    — short name shown in multi-cluster UI (default: HOSTNAME_PREFIX)
#   APP_ENVS           — space-separated list of app environments to deploy
#                         (default: "dev prod staging")
CLUSTER_NAME="${CLUSTER_NAME:-rollout-dev}"
HOSTNAME_PREFIX="${HOSTNAME_PREFIX:-kuberik}"
CLUSTER_DISPLAY="${CLUSTER_DISPLAY:-${HOSTNAME_PREFIX}}"
APP_ENVS="${APP_ENVS:-dev prod staging}"

# Check if Kind cluster exists, if not run the setup script
if ! kind get clusters | grep -q "^${CLUSTER_NAME}$"; then
    "${SCRIPT_DIR}/setup-kind-cluster.sh"
fi

# Switch kubectl context to this cluster (idempotent)
kubectl config use-context "kind-${CLUSTER_NAME}"

# Apply Flux
kubectl apply -f https://github.com/fluxcd/flux2/releases/latest/download/install.yaml

# Add Helm repositories
helm repo add openkruise https://openkruise.github.io/charts/
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

# Install OpenKruise Rollout
helm template openkruise/kruise-rollout --version 0.6.2 --set rollout.featureGates="AdvancedDeployment=true\,RolloutHistory=false" | kubectl apply -f -

# Install kube-prometheus-stack
kubectl create ns monitoring -o yaml --dry-run=client | kubectl apply -f -
helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --set prometheus.prometheusSpec.serviceMonitorSelectorNilUsesHelmValues=false \
  --set prometheus.prometheusSpec.podMonitorSelectorNilUsesHelmValues=false \
  --set prometheus.prometheusSpec.ruleSelectorNilUsesHelmValues=false \
  --wait

# Install metrics-server (`kubectl top`, HPA). Kind's kubelet serving certs
# aren't signed for metrics-server's default TLS verification, so it needs
# the kind-recommended --kubelet-insecure-tls patch. `kubectl apply` is
# idempotent; the args patch is only applied if the flag isn't already
# present so re-running this script doesn't pile up duplicate args.
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
if ! kubectl get deployment metrics-server -n kube-system -o jsonpath='{.spec.template.spec.containers[0].args}' | grep -q -- '--kubelet-insecure-tls'; then
  kubectl patch deployment metrics-server -n kube-system --type=json \
    -p='[{"op": "add", "path": "/spec/template/spec/containers/0/args/-", "value": "--kubelet-insecure-tls"}]'
fi
kubectl wait --for=condition=Available --timeout=300s deployment/metrics-server -n kube-system

kubectl create ns envoy-gateway-system -o yaml --dry-run=client | kubectl apply -f -
kubectl apply --server-side --force-conflicts -f https://github.com/envoyproxy/gateway/releases/download/v1.6.0/install.yaml
kubectl wait --for=condition=Available --timeout=300s deployment/envoy-gateway -n envoy-gateway-system

kubectl create ns cert-manager -o yaml --dry-run=client | kubectl apply -f -
helm template cert-manager oci://quay.io/jetstack/charts/cert-manager --namespace cert-manager \
  --set config.apiVersion="controller.config.cert-manager.io/v1alpha1" \
  --set config.kind="ControllerConfiguration" \
  --set installCRDs="true" \
  --set config.enableGatewayAPI=true | kubectl apply -f -

kubectl wait --for=condition=Available --timeout=300s deployment/cert-manager-webhook -n cert-manager

helm template trust-manager oci://quay.io/jetstack/charts/trust-manager \
  --namespace cert-manager | kubectl apply -f -

kubectl wait --for=condition=Available --timeout=300s deployment/trust-manager -n cert-manager

kubectl apply -f - <<EOF
apiVersion: trust.cert-manager.io/v1alpha1
kind: Bundle
metadata:
  name: custom-ca  # The bundle name will also be used for the target
spec:
  sources:
  - useDefaultCAs: true
  - configMap:
      name: "dex-ca-cert"
      key: "ca.crt"
  target:
    configMap:
      key: "ca-certificates.crt"
EOF

# Apply rollout CRDs
kubectl apply -f https://raw.githubusercontent.com/DataDog/datadog-operator/refs/heads/main/config/crd/bases/v1/datadoghq.com_datadogmonitors.yaml

for repo in rollout-controller environment-controller openkruise-controller prometheus-controller; do
  if [ -d "$SCRIPT_DIR/../../$repo" ]; then
    (cd "$SCRIPT_DIR/../../$repo" && KIND_CLUSTER_NAME="${CLUSTER_NAME}" KIND_CLUSTER="${CLUSTER_NAME}" make dev-deploy)
  fi
done

# Frontend is served by the vite dev server, not the in-cluster pod.
# Skip the npm build — the dashboard pod only needs to serve /api in dev.
# Ensure kodata exists so ko doesn't complain about a missing directory.
mkdir -p kodata

kubectl create ns kuberik-system -o yaml --dry-run=client | kubectl apply -f -

HOST_IP=$(ip route get 8.8.8.8 | awk '{print $7}')
DASHBOARD_HOSTNAME="${HOSTNAME_PREFIX}.${HOST_IP}.nip.io"

# Cluster identity ConfigMap consumed by the dashboard via configMapKeyRef (optional).
# Provides CLUSTER_NAME, DASHBOARD_URL and (on spokes) HUB_URL env vars for the
# multi-cluster UI, self-exclusion, and frontend redirection.
# INSECURE_SKIP_TLS_VERIFY is dev-only — bypass cert checks between kind clusters.
cm_args=(
  --from-literal=name="${CLUSTER_DISPLAY}"
  --from-literal=url="https://${DASHBOARD_HOSTNAME}"
  --from-literal=insecureSkipTLSVerify="${INSECURE_SKIP_TLS_VERIFY:-false}"
)
if [ -n "${HUB_URL:-}" ]; then
  cm_args+=(--from-literal=hubUrl="${HUB_URL}")
fi
kubectl -n kuberik-system create configmap kuberik-cluster-info "${cm_args[@]}" \
  -o yaml --dry-run=client | kubectl apply -f -

# GitHub App user-authorization credentials (see pkg/githubapp) for the commit
# changelist features, which fetch on behalf of the viewing user. Optional —
# pass GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET as env vars to enable;
# skipped otherwise, and the dashboard runs fine without it (those features just
# report "not configured"). The GitHub App also needs one Callback URL registered
# — only for the hub (the host the browser loads the UI from); spokes never run
# the OAuth login flow (they redirect the browser to HUB_URL, and the hub proxies
# their /api calls with the user's cookie forwarded), so they need no callback:
#   https://<hub-host>/api/auth/github/callback
if [ -n "${GITHUB_APP_CLIENT_ID:-}" ] && [ -n "${GITHUB_APP_CLIENT_SECRET:-}" ]; then
  kubectl -n kuberik-system create secret generic github-app-credentials \
    --from-literal=clientId="${GITHUB_APP_CLIENT_ID}" \
    --from-literal=clientSecret="${GITHUB_APP_CLIENT_SECRET}" \
    -o yaml --dry-run=client | kubectl apply -f -
else
  echo "GITHUB_APP_CLIENT_ID/GITHUB_APP_CLIENT_SECRET not set — skipping github-app-credentials Secret (commit changelist features will be disabled)"
fi

kustomize build deploy/dev | KIND_CLUSTER_NAME="${CLUSTER_NAME}" KO_DOCKER_REPO=kind.local ko apply -f -

echo "Warning: GatewayClass 'eg' not found. Creating it explicitly..."
cat <<EOF | kubectl apply -f -
apiVersion: gateway.networking.k8s.io/v1
kind: GatewayClass
metadata:
  name: eg
spec:
  controllerName: gateway.envoyproxy.io/gatewayclass-controller
  parametersRef:
    group: gateway.envoyproxy.io
    kind: EnvoyProxy
    name: default-envoy-proxy
    namespace: envoy-gateway-system
---
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: EnvoyProxy
metadata:
  name: default-envoy-proxy
  namespace: envoy-gateway-system
spec:
  provider:
    type: Kubernetes
    kubernetes:
      envoyService:
        type: NodePort
        patch:
          type: StrategicMerge
          value:
            spec:
              ports:
                - name: https-443
                  port: 443
                  protocol: TCP
                  nodePort: 30951
      envoyDeployment:
        patch:
          type: StrategicMerge
          value:
            spec:
              template:
                spec:
                  containers:
                  - name: envoy
                    volumeMounts:
                    - name: custom-ca
                      mountPath: /etc/ssl/certs/ca-certificates.crt # Overrides system bundle
                      subPath: ca-certificates.crt
                  volumes:
                  - name: custom-ca
                    configMap:
                      name: custom-ca
  telemetry:
    accessLog:
      disable: false
  # Note: For SSE timeout configuration, we rely on HTTPRoute timeouts
  # and annotations. The merge field can be used for advanced Envoy config
  # but requires careful structure matching Envoy's xDS API.
EOF

# Create shared Gateway (accepts *.${HOST_IP}.nip.io, open to all namespaces)
# kuberik dashboard → kuberik.${HOST_IP}.nip.io
# demo app         → demo.${HOST_IP}.nip.io
cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: self-signed
spec:
  selfSigned: {}
---
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: rollout-dashboard-gateway
  namespace: kuberik-system
  annotations:
    cert-manager.io/cluster-issuer: self-signed
spec:
  gatewayClassName: eg
  listeners:
    - name: https
      protocol: HTTPS
      port: 443
      hostname: "*.${HOST_IP}.nip.io"
      tls:
        mode: Terminate
        certificateRefs:
          - name: rollout-dashboard-tls
      allowedRoutes:
        namespaces:
          from: All
    - name: http
      protocol: HTTP
      port: 80
      hostname: "*.${HOST_IP}.nip.io"
      allowedRoutes:
        namespaces:
          from: All
EOF

# Create HTTPRoute for rollout-dashboard (accessible at kuberik.${HOST_IP}.nip.io)
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

# The argument is a release count, not an environment — it used to be "${env}",
# which is not set until the loop below, so it always fell back to the default.
# Every iteration publishes a fresh release of each example, so re-running this
# script (or build-and-push.sh directly) keeps producing new versions to roll.
KIND_CLUSTER_NAME="${CLUSTER_NAME}" "${SCRIPT_DIR}"/build-and-push.sh 3
GITHUB_USER=$(gh api user --jq .login | tr '[:upper:]' '[:lower:]')
SCRIPT_DIR=$(dirname "$0")
for env in ${APP_ENVS}; do
  for app in hello-world hello-multi hello-dep; do
    # kustomize build "example/${app}/app/deployments/${env}" | kubectl apply -f -
    kustomize build "example/${app}/cd/deployments/${env}" | kubectl apply -f -
    kubectl -n ${app}-${env} create secret generic github-token --from-literal=token=${GITHUB_TOKEN} -o yaml --dry-run=client | kubectl apply -f -
    kubectl -n ${app}-${env} create secret docker-registry github-registry-credentials --docker-server=ghcr.io --docker-username=${GITHUB_USER} --docker-password=${GITHUB_TOKEN} -o yaml --dry-run=client | kubectl apply -f -
    # Bind the imagePullSecret to the namespace's default ServiceAccount so every
    # pod in the namespace can pull from ghcr without per-deployment plumbing.
    # Rollouts often promote images that weren't kind-loaded (newer tags published
    # to ghcr by previous runs), and ghcr private packages 401 on anonymous pull.
    kubectl -n ${app}-${env} patch serviceaccount default \
      -p '{"imagePullSecrets":[{"name":"github-registry-credentials"}]}'
  done
done

# Install the cluster-level auth gate (oauth2-proxy in auth-system).
# Dashboard-agnostic — any HTTPRoute can opt in by creating its own SecurityPolicy.
HOSTNAME_PREFIX="${HOSTNAME_PREFIX}" \
  "${SCRIPT_DIR}/setup-cluster-auth.sh"

# Opt the dashboard into the shared auth gate.
# The SecurityPolicy lives in kuberik-system (same as the HTTPRoute it targets)
# and references the shared oauth2-proxy across namespaces via the ReferenceGrant
# that setup-cluster-auth.sh installed in auth-system.
cat <<EOF | kubectl apply -f -
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: SecurityPolicy
metadata:
  name: rollout-dashboard-auth
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
          namespace: auth-system
          port: 4180
      headersToBackend:
        - Authorization
        - X-Auth-Request-User
        - X-Auth-Request-Email
        - X-Auth-Request-Access-Token
EOF
