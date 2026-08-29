# hello-dep — dependency-gated rollouts

Two services that must roll out in order. `hello-api` provides a contract named
`api`; `hello-frontend` consumes it. When a `hello-frontend` release is built
against a newer `api` contract than what is currently deployed, it waits — and
rolls out on its own as soon as `hello-api` catches up.

The result is a topological rollout: providers advance before the consumers that
depend on them, without anyone hand-sequencing the deploys.

## How the dependency is expressed

Nothing about the dependency lives in the manifests of the running workloads. It
is carried by the images themselves, as OCI annotations:

```
# on a hello-api image — the contract version it serves
org.opencontainers.image.version     = 1.64.0-64

# on a hello-frontend image — its own version, plus what it was built against
org.opencontainers.image.version     = 2.64.0-64
com.kuberik.rollout.requires.api     = ^1.64.0
```

The requirement is a version constraint parsed by
[Masterminds/semver](https://github.com/Masterminds/semver#checking-version-constraints),
applied verbatim — there is no kuberik-specific grammar to learn, so that page
is the reference. `^1.2.0`, `~1.2.0`, `>=1.2.0 <2.0.0`, `1.2.x` and combinations
all work.

Watch out for one thing: a bare version (`1.2.0`) is an **exact match** there,
not a floor. A release that tolerates later providers has to say so — which is
why this example publishes `^1.64.0` rather than `1.64.0`.

The `-64` suffix is a monotonic per-release ordinal, attached as a SemVer
*pre-release* identifier so that images sharing a triple still sort by build
order. It must not be build metadata (`+64`), which SemVer ignores for
precedence — every build of one triple would tie.

That ordinal, and only that ordinal, is stripped before the constraint is
evaluated. This matters: by SemVer §11 a pre-release sorts *below* its own
triple, so evaluating a suffixed provider version against a constraint on that
triple would never admit anything. A real pre-release like `1.64.0-rc.1` is
kept, and correctly fails `^1.64.0` — it has not shipped the triple yet.

Note that `org.opencontainers.image.revision` is left as the real git SHA. The
environment controller passes that value to the GitHub Deployments API as the
deployment ref, which rejects anything that is not a git ref — the release
ordinal belongs in the version suffix, not there.

## The wiring

A single `RolloutDependency` connects the two rollouts:

```yaml
apiVersion: kuberik.com/v1alpha1
kind: RolloutDependency
metadata:
  name: hello-frontend-needs-api
spec:
  rolloutRef:            # the consumer being gated
    name: hello-frontend-app
  providerRef:           # the rollout that provides the contract
    name: hello-api-app
  contract: api          # matches com.kuberik.rollout.requires.api
```

The controller reads each `hello-frontend` release's `requires.api` value out of
`hello-frontend-app`'s `status.availableReleases`, compares it against the
contract version of the release `hello-api-app` has **successfully deployed**
(bake succeeded, not merely started), and publishes the verdict as a
`RolloutGate` whose `allowedVersions` lists exactly the admitted releases.
Rollout admission itself is unchanged — the gate is evaluated the same way
schedule and manual approval gates already are.

Because the verdict is an allow list rather than a single pass/fail flag, a
dependency holds back only the releases whose requirement is unmet. Older
releases stay deployable, so rollback still works while a newer release waits.

## Running the demo

The example is deployed by `scripts/setup-dev-environment.sh` alongside
`hello-world` and `hello-multi`, into `hello-dep-{dev,staging,prod}`.

Releases come from `scripts/build-and-push.sh`, whose argument is a release
count. Each iteration publishes a fresh `hello-api` release and a `hello-frontend`
release built against it, tagged `rel-<commit-height>` so that **every run
produces new releases** rather than rewriting the same tags:

```bash
./scripts/build-and-push.sh        # default: 5 iterations
./scripts/build-and-push.sh 2      # or however many you want
```

Because the frontend requires the api release published alongside it, the
dependency gate holds the frontend on every iteration until the api half has
baked. The topological ordering is exercised continuously, not once.

Unlike `hello-world` and `hello-multi`, which record a git short SHA in
`org.opencontainers.image.version`, `hello-dep` records a real semantic version
there — the gate compares those, so they have to be orderable.

While the api half is still baking, the frontend is held and the dependency
explains why:

```console
$ kubectl -n hello-dep-dev get rolloutdependency
NAME                       ROLLOUT              PROVIDER        PROVIDED   SATISFIED
hello-frontend-needs-api   hello-frontend-app   hello-api-app   1.64.0     False

$ kubectl -n hello-dep-dev get rolloutdependency hello-frontend-needs-api \
    -o jsonpath='{.status.blockedReleases}'
[{"reason":"ConstraintNotSatisfied","requiredVersion":"^1.66.0","tag":"rel-66"}]
```

The gate it manages carries the allow list the Rollout actually reads:

```console
$ kubectl -n hello-dep-dev get rolloutgate dependency-hello-frontend-needs-api \
    -o jsonpath='{.spec.allowedVersions}'
["rel-2","rel-63","rel-64"]
```

Once it bakes, the frontend follows a few seconds later, unprompted:

```
api      rel=rel-64 contract=1.64.0-64 bakeEnd=2026-07-29T16:56:25Z
frontend rel=rel-64 requires=^1.64.0   deployedAt=2026-07-29T16:56:32Z
```

Each pod reports what it is paired with, so the ordering is visible from the
outside too:

```console
$ kubectl -n hello-dep-dev run probe --rm -i --restart=Never \
    --image=curlimages/curl:8.10.1 --command -- curl -fsS http://hello-frontend/
{
  "role": "frontend",
  "release": "rel-64",
  "upstream": {
    "role": "api",
    "release": "rel-64",
    "upstream": null
  }
}
```

## Layout

```
app/    the workloads: hello-api and hello-frontend Deployments and Services,
        published per environment as an OCI manifest artifact
cd/     the control plane: one Rollout, ImageRepository, ImagePolicy and
        Environment per service, the RolloutDependency joining them, and the
        shared OCIRepository, Kustomization and HealthCheck
```

Each service also has an `Environment`, chained `dev → staging → prod` like the
other examples. `hello-frontend-app` therefore carries two gates at once — the
environment gate holding a release until the upstream environment has taken it,
and the dependency gate holding it until `hello-api` provides the contract
version it needs.

Both rollouts drive the same Flux `Kustomization`, each owning one `postBuild`
substitution variable (`HELLO_API_VERSION`, `HELLO_FRONTEND_VERSION`), so the
two services advance independently.

## Notes and limits

- A Rollout with **no deployment history** deploys its newest release without
  waiting on gates — `rollout_controller.go` deliberately falls back to the raw
  release candidates when gates filter them all out, so a rollout always reaches
  an initial version. A brand-new consumer is therefore *not* held back by an
  unmet dependency on its very first deploy; it is gated from the second release
  on. Each iteration publishes a mutually satisfiable pair, so a bootstrap can
  never land on an incompatible combination.
- The provider must have **successfully baked**. A release that is still
  deploying, baking, failed or cancelled does not count as providing its
  contract, so a consumer is never unblocked by a provider release that has not
  proven itself.
- The contract name defaults to the provider Rollout's name when `spec.contract`
  is omitted.
- The provider may live in another namespace via `spec.providerRef.namespace`;
  the consumer must be in the same namespace as the `RolloutDependency`, because
  a `RolloutGate` can only reference a Rollout in its own namespace.
