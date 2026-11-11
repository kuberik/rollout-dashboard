# Example topology: sites and waves (prod)

Prod overlays are split into sites (environment-controller "Sites and waves"). Each
site is a full copy of `cd/deployments/prod/common` in its own namespace, with its own
Environment (`spec.site`, `spec.wave`, optional `spec.lockstep`) and a Flux Kustomization
that sets `spec.targetNamespace` (the app manifests hard-code `<app>-prod`).
`kustomize build example/<app>/cd/deployments/prod` yields every site.

| App | Namespace | Site | Wave | Notes |
| --- | --- | --- | --- | --- |
| hello-world | hello-world-prod-eu-west | eu-west | 1 | wave-1 leader; manual-approval gate lives here only |
| hello-world | hello-world-prod-us-east | us-east | 1 | follows the leader |
| hello-world | hello-world-prod-ap-south | ap-south | 2 | starts after wave 1 baked |
| hello-second | hello-second-prod-eu-west | eu-west | 1 | lockstep: true |
| hello-second | hello-second-prod-us-east | us-east | 2 | lockstep: true |

dev/staging, hello-multi and hello-dep stay single-site. The cluster-scoped
`ClusterRolloutSchedule` is emitted once (eu-west) and deleted from the other sites.

## Release sources

Every Rollout gets its releases from a release-controller `ReleaseSource` named by
`spec.releaseSourceRef`; `spec.releasesImagePolicy` is deprecated and inert, so a
Rollout without a ref receives no releases. Each app or stream in `cd/base/resources.yaml`
has one `ReleaseSource` (same name as its Rollout) that lists the OCI repository
itself: `spec.oci.image`, `secretRef`, `filterTags` and `policy`, translated from the
Flux ImageRepository/ImagePolicy pair it replaced. Nothing else in these examples
used the Flux image objects (no ImageUpdateAutomation), so they were removed. The
env overlays retarget the per-environment manifests image at
`ReleaseSource` `spec.oci.image`. Every prod site gets its own copy of the sources.

**hello-multi is the deliberate migration example.** It keeps its Flux ImageRepository
and ImagePolicy, and its ReleaseSource points at the policy with `oci.imagePolicyRef`
instead of repeating the image and policy. Use this bridge to move an existing Flux
image-policy setup over without rewriting it; the Rollout still uses
`releaseSourceRef` and no longer sets `releasesImagePolicy`.

## How the examples reach the clusters

The `cd/` overlays (Rollouts, ReleaseSources, Environments) reach the clusters by
`scripts/setup-dev-environment.sh` running `kustomize build example/<app>/cd/deployments/<env> | kubectl apply -f -`
from the local checkout; Flux does not pull them. `scripts/build-and-push.sh` also copies
`example/**` into the `LittleChimera/kuberik-testing` (hello-world at the root, hello-multi
under `multi/`, hello-dep under `dep/`) and `LittleChimera/kuberik-testing-second`
(hello-second) repos, so ReleaseSources show up there on the next build-and-push, as a
reference copy only. Flux pulls only the `app/` manifest artifacts built from them.
The setup script installs release-controller (with its readers RBAC) before applying the
overlays, because they contain `ReleaseSource` objects.
