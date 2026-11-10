#!/bin/bash
# Push the current Dex CA (scripts/dex-certs/dex-ca.crt) to every consumer on
# every kind cluster, and restart only the consumers whose CA actually changed.
# Idempotent: a second run with an unchanged CA changes and restarts nothing.
#
# Consumers per cluster:
#   - ConfigMaps  auth-system/dex-ca-cert, cert-manager/dex-ca-cert,
#                 cert-manager/custom-ca-bundle (when they exist)
#   - oauth2-proxy  (pod template carries a checksum/dex-ca annotation, so a
#                    new CA forces a rolling restart)
#   - kube-apiserver (--oidc-ca-file is read once at start; the CA file inside
#                    the node is rewritten in place and the static pod bounced
#                    only if the content changed)
#
# Usage: sync-dex-ca.sh [kind-cluster-name ...]   (default: every kind cluster)
set -e

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
CA="${SCRIPT_DIR}/dex-certs/dex-ca.crt"
[ -f "${CA}" ] || { echo "Error: ${CA} not found. Run generate-dex-tls.sh first."; exit 1; }
SUM=$(sha256sum "${CA}" | cut -d' ' -f1)

# Host-side copy that kind mounts into every node (see kind-config.yaml). Write
# in place (same inode) so existing bind mounts see the new content.
cat "${CA}" > /tmp/dex-ca.crt

CLUSTERS=("$@")
[ ${#CLUSTERS[@]} -gt 0 ] || mapfile -t CLUSTERS < <(kind get clusters 2>/dev/null)
[ ${#CLUSTERS[@]} -gt 0 ] || { echo "No kind clusters found"; exit 0; }

NODE_PATHS="/usr/local/share/ca-certificates/dex-ca.crt /usr/share/ca-certificates/mozilla/dex-ca.crt /usr/share/ca-certificates/dex-ca.crt /etc/ssl/certs/dex-ca.crt"

for name in "${CLUSTERS[@]}"; do
    ctx="kind-${name}"
    node="${name}-control-plane"
    k="kubectl --context ${ctx}"
    echo "==> ${name}: syncing Dex CA (sha256 ${SUM:0:12})"
    if ! ${k} get --raw=/readyz >/dev/null 2>&1; then
        echo "    cluster not reachable, skipping"; continue
    fi

    # ConfigMaps
    for ns in auth-system cert-manager; do
        ${k} get ns "${ns}" >/dev/null 2>&1 || continue
        ${k} -n "${ns}" create configmap dex-ca-cert --from-file=ca.crt="${CA}" \
            --dry-run=client -o yaml | ${k} apply -f - >/dev/null
        echo "    configmap ${ns}/dex-ca-cert ok"
    done
    if ${k} -n cert-manager get configmap custom-ca-bundle >/dev/null 2>&1; then
        ${k} -n cert-manager create configmap custom-ca-bundle --from-file=ca-certificates.crt="${CA}" \
            --dry-run=client -o yaml | ${k} apply -f - >/dev/null
        echo "    configmap cert-manager/custom-ca-bundle ok"
    fi

    # oauth2-proxy: annotation change triggers a rollout only when the CA changed.
    if ${k} -n auth-system get deploy oauth2-proxy >/dev/null 2>&1; then
        ${k} -n auth-system patch deploy oauth2-proxy --type merge -p \
            "{\"spec\":{\"template\":{\"metadata\":{\"annotations\":{\"checksum/dex-ca\":\"${SUM}\"}}}}}" >/dev/null
        ${k} -n auth-system rollout status deploy/oauth2-proxy --timeout=120s >/dev/null
        echo "    oauth2-proxy at checksum ${SUM:0:12}"
    fi

    # kube-apiserver
    if docker inspect "${node}" >/dev/null 2>&1; then
        # The node file is a bind mount of /tmp/dex-ca.crt, already rewritten above,
        # so it cannot tell us what the running apiserver loaded. Keep a marker
        # of the CA the apiserver was last (re)started with.
        have=$(docker exec "${node}" cat /etc/kubernetes/dex-ca.sha256 2>/dev/null || true)
        if [ "${have}" != "${SUM}" ]; then
            for p in ${NODE_PATHS}; do
                docker exec -i "${node}" sh -c "cat > ${p}" < "${CA}" || true
            done
            echo "    node CA changed, restarting kube-apiserver"
            docker exec "${node}" sh -c \
                "mv /etc/kubernetes/manifests/kube-apiserver.yaml /tmp/kas.yaml && sleep 3 && mv /tmp/kas.yaml /etc/kubernetes/manifests/kube-apiserver.yaml"
            sleep 5
            until ${k} get --raw=/readyz >/dev/null 2>&1; do sleep 2; done
            docker exec "${node}" sh -c "echo ${SUM} > /etc/kubernetes/dex-ca.sha256"
            echo "    kube-apiserver ready"
        else
            echo "    kube-apiserver CA already current"
        fi
    fi
done
echo "Dex CA synced to: ${CLUSTERS[*]}"
