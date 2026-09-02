# Operator critique of `polish/overnight-craft` — 2026-08-31

A UX critic drove the branch end to end, ran real deploys, force-deployed to prod through
three closed gates, rolled back with a pin, and scaled the dashboard to 0 to force an API
outage. This is the triage list. **Two findings falsify claims made in earlier commits on
this branch** — those are marked ⚠️.

## Not reproducible — do not action

**"The command palette never navigates."** Filed as blocking. Re-tested three ways after
the report: Enter from `/` (→ `/rollouts/prod/hello-dep-prod/hello-api-app`), ArrowDown+Enter
from `/apps` (→ `/rollouts/dev/hello-world-dev/hello-world-app`), click `#cp-opt-0` from
`/environments` (→ `/rollouts/prod/hello-multi-prod/hello-multi-app`). All three navigate.
Four agents shared one browser daemon that night and demonstrably crossed streams — a
verification screenshot of mine came back showing the critic's rollback modal. Treat as
contention, not a defect.

**"Empty query shows `Browse`, not `Needs you`."** Working as designed: the group draws
nothing when nothing is failed or stuck, and `behind` is not `needs you`. My briefing
overstated the promise, and the critic held the product to my words.

---

## BLOCKING

### 1. Two pages give opposite answers to "do I need to wake someone up?"
Same rollout, same moment:
- `/apps/hello-world-app`: *"STAGING is waiting on an approval … **This will not clear on its own.**"*
- rollout detail: *"Automatic deploys are paused … **until 13h 34m (8/31/2026, 1:00:00 PM)**."*

The API says **both are true**: `ghd-p2fld` is `passing:true` with zero allowed versions,
`schedule-gate-nwm62` is `passing:false`. One page says escalate at 3am; the other says go
back to bed. The `Investigate` CTA on the first takes you to the second.

**Wanted:** one blocking story per rollout — every gate holding it, and for each, whether it
clears on a clock or needs a human. **`/versions` already does this correctly.** The model
exists in the codebase; the other pages don't use it.

### 2. ⚠️ A failed API renders as an eternal skeleton on every page
With `/api/rollouts` returning 503: `/rollouts` and rollout detail sit forever on grey
placeholders; `/`, `/apps`, `/apps/<name>` and `/activity` render a title and nothing else.
No error, no "cannot reach the cluster", no retry.

**This contradicts commit `408b63d`, which claimed error states were fixed.** The
*not-found* path is genuinely good ("This rollout does not exist… Try again / Back to all
rollouts") — so the machinery exists and the 5xx/network path simply never reaches it. At
3am a blank Rollouts page reads as *"the cluster has no rollouts."*

### 3. `/rollouts` says the fleet is fine while four other surfaces say it isn't
Header reads `Attention 0 · In motion 1 · Pending 0 · Healthy 14` with `hello-world-app` 20
behind and gate-blocked in all three environments. At the same moment `/` files them under
Trailing, `/apps` shows a full-width amber banner, `/environments` says "furthest behind: 20
versions", `/versions` says "5 blocked". `/rollouts` is where you go to scan everything and
it is the one page saying nothing is wrong.

---

## PAINFUL

### 4. ⚠️ "One definition of behind" is not used everywhere — two numbers on one card
All three environments are on the identical sha `991829b`. Union stream = 26 releases, so
`991829b` is 20 from newest; each rollout's own `availableReleases` gives prod 15, dev 16,
staging 15.

| Surface | dev | staging | prod |
|---|---|---|---|
| `/` chips | 20 behind | 20 behind | *rolled back* — no number |
| `/apps/<name>` chip | (in "Waiting") | **−20** | **−20** |
| same page, same card | **16 newer versions ready** | **15 versions ready** | **15 versions ready** |
| same page, right rail | 20 behind | 20 behind | 20 behind |
| rollout detail | — | — | **15 upgrades available** |

**This contradicts commit `aa79f97`, which claimed one definition used everywhere.** The
union-based number is also the *less* useful one — it counts releases that never entered
that rollout's stream and therefore cannot be deployed there.

### 5. "behind dev" / "behind staging" for environments running the identical build
`−20 STAGING behind dev` and `−20 PROD behind staging` while the rail beside it shows dev,
staging and prod all on `991829b`. The page asserts a lag chain between three identical
deployments.

### 6. `rolled back` evicts the lag chip on the two landing surfaces
On `/` and `/rollouts`, prod showed `ROLLED BACK 51b976a` with no lag while it was the most
behind rollout in the fleet. The group header counts it — *"Trailing 3, healthy but behind a
newer build"* — then refuses to say how far. `cardVerdict`'s precedence is eating a fact
rather than ranking two facts.

### 7. Gate attribution names the wrong gates
For prod `hello-world-app` the API reports `ghd-xm669` passing (allows only `991829b`),
`hello-world-manual-approval` passing (allows nothing), `schedule-gate-zvsqr` **failing**.
`/apps` blamed `hello-world-manual-approval`; rollout detail said "1 schedule"; `/apps/<name>`
said "ghd-xm669, hello-world-manual-approval". **Nowhere are the failing gate and the whole
set shown together.** Generated IDs are captioned "Needs a person to approve" — a person
cannot approve an environment-controller deployment gate. `/environments` lists gates
belonging to *hello-multi* under a heading about `hello-world-app`. The one human-readable
name — "Business Hours Only" — is buried inside the Change Version modal.

### 8. `/apps` contradicts itself in one viewport
Header *"4 of 4 the same version everywhere"*, card header the same in green, and the row
below *"0 of 3 up to date"*. The caption is spliced: *"0 of 3 up to date / in all 3
environments"* — that fragment belongs to the "All up to date" variant. Recurs whenever
every environment matches but none is at newest.

### 9. "Release the hold" does not release the hold
On `/apps` it is an `<a href="/apps/<name>">` styled as a button. On `/apps/<name>` it opens
**Change Version** — a version picker with no way to clear a pin. The real control is
`Clear pin` on rollout detail, two pages away.

### 10. Friction is inverted for the riskier action
Force-deploying an unvetted build to **production** through three closed gates: two clicks,
no confirmation, and the modal never says "production". Going *backwards* demands a typed
sha. The typed gate is the right mechanism on the wrong direction — a rollback is the
recovery you want fast at 3am. Related: `Rollback` pre-selects the previously-deployed
version, which is not necessarily older; it opened a modal reading *"Deploy 51b976a →
aa17645"* (a roll-forward) captioned "Pin Version — Required for rollback".

### 11. Rollback is invisible on the page whose job is history
The history tab shows three green ticks, all "Succeeded", header "100% success". The word
"Rollback" appears only after expanding a row that has no visible affordance at rest — while
`/` and `/rollouts` flag it at rest. The audit strings don't match the buttons either: a
forward deploy wrote "Force deploy" (the UI never said "force"); a rollback-with-pin wrote
"Pinned version", losing the rollback entirely. Three deploys 6 minutes apart all read "1d".

### 12. The `baking` → `checking` rename is half-landed, on the wrong half
`/` and `/activity` say "checking". **Rollout detail — where the phase actually happens —
says Bake ×7, Baking ×3, bake ×2, checking ×1**, plus a raw `InProgress` enum on the version
card. During one bake, home said "checking", the pipeline chip said "Baking", and the version
card said "InProgress", for the same rollout at the same second. The word is fine; three
vocabularies is not.

### 13. `/rollouts` labels staging namespaces "dev", and five filter chips are ambiguous
Group headers read `dev / hello-world-staging` — the *cluster* name where it reads as the
*environment*, with rows inside correctly saying "staging". The filter row's accessible names
are literally `prod`, `dev`, `dev`, `staging`, `prod`: two families, no labels, adjacent. At
390 they wrap to three rows with an orphaned `PROD`.

### 14. `/environments`: "4/4 healthy" on cards that also say "needs a person"
Green `4/4 healthy` above bodies showing `20 BEHIND` and a gate holding. The dev card — the
one the page's own banner points at — is missing both the "furthest behind" summary and the
"Choose a version" CTA that staging and prod have.

---

## COSMETIC

- `/environments/<unknown>` returns a bare **404 Not Found**, no sidebar, no way back, while
  every other unknown route has a designed empty state.
- The `/apps` pin banner prints the full 60-char OCI tag where every other surface shows `991829b`.
- History timeline defaults to 7D with six empty days and all deploys in one pixel column.
- The "Version pinned" banner is a rounded box with a coloured left edge stripe — the shape
  the human has banned twice — and echoes the audit string as an italic quote under a heading
  that already says it.
- Sidebar says "Revisions"; the route is `/versions`.
- Logs tab keeps "Loading…" visible while logs are already streaming.

---

## What is genuinely good — the critic said so unprompted

- **In-flight consistency is the strongest part of the branch.** A deploy watched through its
  whole life: `/` "In motion 1 · deploying & checking right now" with stage bar, `/rollouts`
  row moved and counter updated, `/apps` "1 deploying now", rollout detail updated live with
  no reload, closed its own modal, streamed pod events at 6-second granularity. **Every
  surface agreed.** In-flight reads completely differently from settled.
- **The blocked banner's claim is true** — force-deployed through a failing schedule gate, a
  zero-allowlist approval gate and a deployment gate permitting only one other sha. It applied
  immediately, exactly as the banner promises.
- **The Clear Pin confirmation is the best copy in the product**: states the consequence, the
  non-consequence, and names the rule in human terms.
- **Change Version to an older sha transforms correctly** — "Rollback 0afab6f → 991829b",
  "Commits deployed" → "Commits reverted", typed sha demanded.
- **`/versions` gets the whole blocking story right** — the model findings 1 and 7 need.
- `/apps` ranks correctly and is actionable; `/activity` is clean; Dependencies works both ways;
  the baking spinner does have a mark at rest.

### Timed tasks
1. *"Prod looks wrong — what do I do?"* — 1 click, 2 page loads to answer + action. Flow is
   good; the failure is upstream: `/` gave prod no lag number and filed it under healthy.
2. *"Which apps need attention?"* — answered at a glance. Best flow in the product, but it
   disagrees with `/rollouts`.
3. *"What changed between prod and newest?"* — **the product cannot answer this.** Every commit
   surface says "Connect your GitHub account". Honest, offers the action, question unanswered.
4. *"Get me to the thing that fixes it."* — `Investigate` delivers; `Release the hold` does not.

## LEFT — states never reached, for the next run to stage
A dependency gate actually blocking (`hello-dep` published no new versions); a failed deploy,
health check or bake — **every deploy succeeded, so "100% success" was never tested against a
real failure**; `Pending`/queued (the counter read 0 all session); recovery from an API outage
without a reload; bypass-gates (documented in `CLAUDE.md`, no control found in the product);
hundreds of rollouts; a very long app or gate name; a stale `LastErrorTime`.

---

# STATUS — annotated 2026-08-31, overnight

Every finding below was verified by me on the running product before its commit was
pushed, not taken from the agent's report.

| # | finding | status | commit |
|---|---|---|---|
| — | palette never navigates | **not a defect** — re-tested three ways, all navigate. Shared-browser contention. | — |
| — | empty query shows `Browse` | **working as designed** — `behind` is not `needs you` | — |
| 1 | opposite answers to "wake someone up?" | **fixed** — one blocking story, four surfaces, identical sentence | `ac8e045` |
| 2 | ⚠️ 503 renders as eternal skeleton | **fixed** — 12 surfaces had a 12px red line; recovery heals with no reload | `68a9c00` |
| 3 | `/rollouts` says the fleet is fine | **fixed** — shared predicates; Trailing/Steady match `/` | `8bfa829` |
| 4 | ⚠️ two numbers for "behind" | **fixed, ruling reversed** — the rollout's own list wins | `8bfa829` |
| 5 | lag between identical builds | **fixed** — every comparison short-circuits on an identical build | `8bfa829` |
| 6 | `rolled back` evicts the lag chip | **fixed** — state moved into the status disc, no chip added | `8bfa829` |
| 7 | gate attribution names wrong gates | **fixed** — three writers distinguished; only one is approvable | `ac8e045` |
| 8 | `/apps` contradicts itself | **fixed** — spliced caption was fall-through | `8bfa829` |
| 9 | "Release the hold" doesn't | **fixed** — verified by clearing a real pin from both entry points | `7af14fa` |
| 10 | friction inverted | **fixed** — verified on the live modal, prod primary disabled | `7af14fa` |
| 11 | rollback invisible in history | **in flight** — agent still running at time of writing | — |
| 12 | `baking`→`checking` half-landed | **fixed** — measured after: Bake 0, Baking 0, InProgress 0 | `7af14fa` |
| 13 | cluster labelled as environment | **fixed** — namespace leads; chips say `cluster` / `Environment` | `db52d1a` |
| 14 | `4/4 healthy` above a held body | **fixed** — `4/4 running` + a separate `1 held` rollup | `ac8e045` |
| c1 | `/environments/<unknown>` bare 404 | **in flight** | — |
| c2 | 60-char OCI tag on `/apps` | **fixed** | `db52d1a` |
| c3 | history timeline 7D, one pixel column | **in flight** | — |
| c4 | pin banner: rounded box + edge stripe | **fixed** — the `quoted` prop is deleted, not worked around | `db52d1a` |
| c5 | sidebar "Revisions" vs `/versions` | **in flight** | — |
| c6 | Logs "Loading…" while streaming | **in flight** | — |

## Two root causes worth carrying forward

**The backend makes the cluster/environment collision possible.** `main.go` reads
`CLUSTER_NAME` from the `kuberik-cluster-info` ConfigMap and it is set to `prod`/`dev`.
Naming them `rollout-prod`/`rollout-dev` removes the ambiguity at the source. The display
fix stands either way.

**`Pinned by <author>` is still the last deploy's actor, not the pinner** — the same class
of defect as the quoted audit string that was removed. Fixing it needs the pin's own
provenance from `managedFields`.

## The pattern behind almost all of it

Every defect fixed on this branch — four ink roles, three vocabularies, the eternal
skeleton, the wrong gate attribution — survived because **nobody rendered the state it
lived in**. The mock fixture could not even reach rollout detail (four endpoints compared
`req.url` to a bare path while the mock advertises three clusters), so whole classes of
state had no reachable render anywhere. That is now fixed, and `MOCK_OUTAGE`, `MOCK_SLOW`,
`MOCK_PARTIAL` and `MOCK_FAIL` exist so the next person does not have to scale down a
shared cluster to see a failure.
