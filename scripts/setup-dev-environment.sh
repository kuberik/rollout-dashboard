#!/bin/bash
set -e

SCRIPT_DIR=$(dirname "$0")

# Check if Kind cluster exists, if not run the setup script
if ! kind get clusters | grep -q rollout-dev; then
    "${SCRIPT_DIR}/setup-kind-cluster.sh"
fi

# Apply Flux
kubectl apply -f https://github.com/fluxcd/flux2/releases/latest/download/install.yaml
helm repo add openkruise https://openkruise.github.io/charts/
helm repo update
helm install kruise-rollout openkruise/kruise-rollout --version 0.6.1

# Apply rollout CRDs
kubectl apply -f https://raw.githubusercontent.com/DataDog/datadog-operator/refs/heads/main/config/crd/bases/v1/datadoghq.com_datadogmonitors.yaml

(cd frontend && npm run build; rm -rf ../kodata; cp -r build ../kodata)

kustomize build deploy/dev | KIND_CLUSTER_NAME=rollout-dev KO_DOCKER_REPO=kind.local ko apply -f -

"${SCRIPT_DIR}"/build-and-push.sh "${env}"
SCRIPT_DIR=$(dirname "$0")
for env in dev prod staging; do
  kustomize build "example/hello-world/app/deployments/${env}" | kubectl apply -f -
  kustomize build "example/hello-world/cd/deployments/${env}" | kubectl apply -f -
done
