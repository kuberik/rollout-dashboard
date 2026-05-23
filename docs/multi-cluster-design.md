# Multi-Cluster Dashboard Design

## Goal

Single rollout-dashboard instance on a hub cluster (e.g. prod) that shows rollout data
from multiple clusters. Users authenticate once. Hub backend fans out to spoke clusters.
Spoke clusters have no knowledge of the hub.

## Architecture

```
Browser
  │
  ▼
Envoy Gateway (prod) ── OIDC flow ──► IdP
  │
  ▼
rollout-dashboard (hub, prod cluster)
  ├──► rollout-dashboard (staging cluster)
  └──► rollout-dashboard (dev cluster)
```

- Frontend talks only to hub
- Hub discovers other dashboard instances via `environmentUrl` in Environment statuses
- Hub forwards user's ID token to each remote dashboard as Bearer
- Remote dashboards validate token independently via shared OIDC issuer
- No credentials or config needed — discovery and auth are fully dynamic

## Authentication Flow

1. User hits hub dashboard → Envoy OIDC redirect → authenticates with IdP
2. Envoy stores ID token in `IdToken` cookie, access token in `Authorization` header
3. Hub middleware extracts ID token from `IdToken` cookie (already implemented)
4. Hub calls spoke K8s APIs with `Authorization: Bearer <id_token>`
5. Spoke API servers validate JWT against `--oidc-issuer-url` (same IdP)
6. Per-cluster RBAC enforced based on user identity claims in token

### Envoy Configuration Requirement

Envoy currently forwards access token in `Authorization` header. The ID token must
also be surfaced — configure the OIDC SecurityPolicy to set the `IdToken` cookie:

```yaml
# SecurityPolicy OIDC config (Envoy Gateway)
oidc:
  ...
  cookieConfig:
    sameSite: Strict
  # Envoy sets IdToken cookie containing the ID token JWT
```

The existing middleware priority (`IdToken` cookie → `id_token` cookie →
`access_token` cookie → `Authorization` header) already handles this correctly
once Envoy is configured.

### Cluster Requirements

Each spoke cluster's K8s API server must be configured with:

```
--oidc-issuer-url=https://<shared-idp>
--oidc-client-id=<client-id>
--oidc-username-claim=email   # or sub
--oidc-groups-claim=groups    # optional, for RBAC group bindings
```

All clusters must trust the same OIDC issuer. No other changes needed on spokes.

## Cluster Discovery

No changes to the `Environment` CRD. Each Environment controller already syncs
full deployment state via the GitHub Deployment API, including `environmentUrl`
for every known environment in `status.environmentInfos[]`.

Example (current cluster, all environments share the same base URL):

```
status:
  environmentInfos:
  - environment: dev
    environmentUrl: https://kuberik.192.168.1.102.nip.io/rollouts/hello-multi-dev/hello-multi-app
  - environment: staging
    environmentUrl: https://kuberik.192.168.1.102.nip.io/rollouts/hello-multi-staging/hello-multi-app
```

In a multi-cluster setup, environments on different clusters would have different
base URLs. Hub kuberik reads all Environment statuses, extracts base URLs from
`environmentUrl`, deduplicates, and treats each unique base URL as a remote
kuberik dashboard to fan out to.

No config files, no new fields, no CRD changes — discovery is fully dynamic.

## Hub API Changes

Hub fans out requests in parallel to all discovered kuberik dashboard instances
(including itself) and merges results. Frontend always talks to the local hub only.

```
GET /api/rollouts          # fans out to all discovered dashboards, merges
GET /api/rollouts/:ns/:name?dashboard=https://kuberik.staging.example.com  # specific instance
```

Response includes a source URL field on each item identifying which dashboard it
came from. Unreachable dashboards return a partial response — error surfaced
per-instance, not as a global failure.

## Frontend Changes

- Cluster selector component (populated from distinct clusters in Environment list)
- "All clusters" view fans out via `allClusters=true`
- Each rollout card/row shows which cluster it belongs to
- Errors per cluster surfaced inline (e.g. "staging unreachable")

## Cluster Identity (Name + URL)

The dashboard reads two optional env vars:

- `CLUSTER_NAME` — short human-readable name shown in the UI (e.g. `prod`)
- `DASHBOARD_URL` — external base URL of this dashboard, used for self-exclusion
  during fan-out (critical behind reverse proxies that drop the Host header)

The deployment wires both via `configMapKeyRef` with `optional: true`, so the
user populates them by creating a `kuberik-cluster-info` ConfigMap if desired:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: kuberik-cluster-info
  namespace: kuberik-system
data:
  name: prod
  url: https://kuberik.prod.example.com
```

If neither env var is set, the backend falls back to:
- Name: parse `kuberik.<name>.<rest>` from the request hostname; if `<name>` is
  numeric (IP octet from nip.io/sslip.io) use the full hostname instead
- URL: reconstruct from `X-Forwarded-Proto` / `X-Forwarded-Host` request headers,
  then `Host`

**`DASHBOARD_URL` is strongly recommended in multi-cluster setups** — without it,
self-exclusion may fail when the in-cluster request `Host` (e.g. internal Service
name) does not match the public `environmentUrl`, causing the hub to attempt to
call itself via the external URL.

## Write Operations (Mutations) for Spokes

Currently, only `GET /api/rollouts` and `GET /api/rollouts/:ns/:name?dashboard=<url>` are
proxied through the hub. POST mutation endpoints (pin, force-deploy, bypass-gates, etc.)
are not yet proxied — the detail page shows a read-only banner when viewing a spoke rollout.

Planned: extend the proxy pattern to all mutation endpoints using the same `?dashboard=<url>`
query param convention.

## Open Questions

1. **RBAC gaps** — user may have access on hub but not on a spoke. Spoke returns 403;
   hub should surface this per-cluster, not as a global error.
2. **Token expiry** — ID token expires mid-session. Hub needs to propagate 401s from
   spokes back to frontend to trigger re-auth via Envoy.
3. **Hub in UI** — hub cluster is always shown as "local" or by its `kuberik-cluster-info`
   name. Cluster pills appear only when spokes are discovered; single-cluster setups
   see no extra UI.
