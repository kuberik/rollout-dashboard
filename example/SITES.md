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
