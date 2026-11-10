#!/bin/bash
# Multi-cluster dev setup. Creates two kind clusters:
#   - rollout-prod  (hub)   on host port 8080 → kuberik.<HOST_IP>.nip.io
#                            deploys prod app environments
#   - rollout-dev   (spoke) on host port 8081 → kuberik-spoke.<HOST_IP>.nip.io
#                            deploys dev + staging app environments
#
# A host-side haproxy SNI router on :443 forwards browser/hub-pod traffic
# to the right cluster based on TLS SNI:
#   kuberik.<HOST_IP>.nip.io       → host:5173 (vite, hub frontend)
#   kuberik-spoke.<HOST_IP>.nip.io → host:8081 (kind spoke Envoy)
#
# The hub dashboard runs with INSECURE_SKIP_TLS_VERIFY=true so it can call
# the spoke's self-signed cert without a shared CA.
set -e
set -x

SCRIPT_DIR=$(dirname "$0")
PROJECT_ROOT=$(dirname "${SCRIPT_DIR}")
HOST_IP=$(ip route get 8.8.8.8 | awk '{print $7}')

HUB_HOSTNAME="kuberik.${HOST_IP}.nip.io"
SPOKE_HOSTNAME="kuberik-spoke.${HOST_IP}.nip.io"

echo "==> Writing haproxy SNI router config"
HAPROXY_CFG_DIR="${HOME}/.local/state/kuberik-dev"
mkdir -p "${HAPROXY_CFG_DIR}"
cat >| "${HAPROXY_CFG_DIR}/haproxy.cfg" <<EOF
global
  log stdout format raw local0
  maxconn 4096

defaults
  mode tcp
  timeout connect 5s
  timeout client 1h
  timeout server 1h
  log global

frontend https
  bind *:443
  mode tcp
  tcp-request inspect-delay 5s
  tcp-request content accept if { req_ssl_hello_type 1 }
  use_backend spoke if { req_ssl_sni -i ${SPOKE_HOSTNAME} }
  default_backend hub

backend hub
  mode tcp
  server hub ${HOST_IP}:5173

backend spoke
  mode tcp
  server spoke ${HOST_IP}:8081
EOF

echo "==> Stopping old socat router if running"
docker compose -f "${PROJECT_ROOT}/docker-compose.socat.yaml" down 2>/dev/null || true
# A router started by an older version of this setup (other compose project
# name, /tmp config mount) holds the container name; replace it.
if docker inspect sni-router >/dev/null 2>&1 && \
   [ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' sni-router)" != "kuberik-sni" ]; then
  docker rm -f sni-router
fi

echo "==> Starting haproxy SNI router on host:443"
docker compose -f "${PROJECT_ROOT}/docker-compose.sni-proxy.yaml" up --wait --force-recreate
# `up --wait` returns before haproxy has parsed its config (no healthcheck), so a
# router that exits at once would go unnoticed. Require it to stay up.
sleep 5
if [ "$(docker inspect -f '{{.State.Running}} {{.RestartCount}}' sni-router)" != "true 0" ]; then
  docker logs --tail 20 sni-router >&2
  echo "sni-router is not running; see its log above" >&2
  exit 1
fi

echo "==> Creating HUB cluster (rollout-prod, port 8080, prod env)"
CLUSTER_NAME="rollout-prod" \
HOST_PORT="8080" \
HOSTNAME_PREFIX="kuberik" \
CLUSTER_DISPLAY="prod" \
APP_ENVS="prod" \
INSECURE_SKIP_TLS_VERIFY="true" \
SKIP_PROXY="true" \
  "${SCRIPT_DIR}/setup-dev-environment.sh"

echo "==> Creating SPOKE cluster (rollout-dev, port 8081, dev+staging envs)"
CLUSTER_NAME="rollout-dev" \
HOST_PORT="8081" \
HOSTNAME_PREFIX="kuberik-spoke" \
CLUSTER_DISPLAY="dev" \
APP_ENVS="dev staging" \
INSECURE_SKIP_TLS_VERIFY="true" \
HUB_URL="https://${HUB_HOSTNAME}" \
SKIP_PROXY="true" \
  "${SCRIPT_DIR}/setup-dev-environment.sh"

# Dex's CA must be identical on every cluster. Regenerating it during the second
# cluster's setup would leave the first stale; push the current CA to every
# consumer (configmaps, oauth2-proxy, kube-apiservers) on both clusters.
echo "==> Syncing Dex CA to both clusters"
"${SCRIPT_DIR}/sync-dex-ca.sh" rollout-prod rollout-dev

echo "==> Multi-cluster dev setup complete"
echo ""
echo "Hub:   https://${HUB_HOSTNAME}   (kind: rollout-prod, prod envs)"
echo "Spoke: https://${SPOKE_HOSTNAME} (kind: rollout-dev, dev+staging envs)"
echo ""
echo "Browser hits the hub. Hub fans out to spoke via SNI router on host:443."
echo "kubectl context: 'kind-rollout-prod' or 'kind-rollout-dev'."
