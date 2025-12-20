#!/bin/bash
set -e
set -x

SCRIPT_DIR=$(dirname "$0")
GITHUB_TOKEN=${GITHUB_TOKEN:-$(gh auth token)}
# Check if Kind cluster exists, if not run the setup script
if ! kind get clusters | grep -q rollout-dev; then
    "${SCRIPT_DIR}/setup-kind-cluster.sh"
fi

# Apply Flux
kubectl apply -f https://github.com/fluxcd/flux2/releases/latest/download/install.yaml
helm repo add openkruise https://openkruise.github.io/charts/
helm repo update
helm template openkruise/kruise-rollout --version 0.6.1 | kubectl apply -f -

kubectl create ns cert-manager -o yaml --dry-run=client | kubectl apply -f -
helm template cert-manager oci://quay.io/jetstack/charts/cert-manager --namespace cert-manager \
  --set config.apiVersion="controller.config.cert-manager.io/v1alpha1" \
  --set config.kind="ControllerConfiguration" \
  --set installCRDs="true" \
  --set config.enableGatewayAPI=true | kubectl apply -f -

kubectl create ns envoy-gateway-system -o yaml --dry-run=client | kubectl apply -f -
kubectl apply --server-side --force-conflicts -f https://github.com/envoyproxy/gateway/releases/download/v1.6.0/install.yaml
kubectl wait --for=condition=Available --timeout=300s deployment/envoy-gateway -n envoy-gateway-system

# Apply rollout CRDs
kubectl apply -f https://raw.githubusercontent.com/DataDog/datadog-operator/refs/heads/main/config/crd/bases/v1/datadoghq.com_datadogmonitors.yaml

for repo in rollout-controller environment-controller openkruise-controller; do
  if [ -d "$SCRIPT_DIR/../../$repo" ]; then
    (cd "$SCRIPT_DIR/../../$repo" && make dev-deploy)
  fi
done

(cd frontend && npm run build; rm -rf ../kodata; cp -r build ../kodata)

kubectl create ns kuberik-system -o yaml --dry-run=client | kubectl apply -f -
kustomize build deploy/dev | KIND_CLUSTER_NAME=rollout-dev KO_DOCKER_REPO=kind.local ko apply -f -

HOST_IP=$(ip route get 8.8.8.8 | awk '{print $7}')

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
EOF

# Create Gateway
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
      hostname: ${HOST_IP}.nip.io
      tls:
        mode: Terminate
        certificateRefs:
          - name: rollout-dashboard-tls
      allowedRoutes:
        namespaces:
          from: Same
    - name: http
      protocol: HTTP
      port: 80
      hostname: ${HOST_IP}.nip.io
      allowedRoutes:
        namespaces:
          from: Same
EOF

# Create HTTPRoute
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

"${SCRIPT_DIR}"/build-and-push.sh "${env}"
GITHUB_USER=$(gh api user --jq .login | tr '[:upper:]' '[:lower:]')
SCRIPT_DIR=$(dirname "$0")
for env in dev prod staging; do
  kustomize build "example/hello-world/app/deployments/${env}" | kubectl apply -f -
  kustomize build "example/hello-world/cd/deployments/${env}" | kubectl apply -f -
  kubectl -n hello-world-${env} create secret generic github-token --from-literal=token=${GITHUB_TOKEN} -o yaml --dry-run=client | kubectl apply -f -
  kubectl -n hello-world-${env} create secret docker-registry github-registry-credentials --docker-server=ghcr.io --docker-username=${GITHUB_USER} --docker-password=${GITHUB_TOKEN} -o yaml --dry-run=client | kubectl apply -f -
done
