# Second operator critique — the failure states, 2026-08-31 ~01:40–02:05 UTC

A critic manufactured the states nobody in this project had ever rendered: a failed health
check, a **recovered-but-previously-failed** health check, an 18-minute stuck deploy, a
genuinely failed production deploy, a blocking dependency gate, 121 never-deployed
rollouts, and a 58-character rollout name.

Its one-line summary: **the failed-deploy path is one of the best things in this product —
and the moment you press the button it offers you, the product forgets the failure ever
happened.**

⚠️ **Finding 4 falsifies commit `ac8e045`** ("one blocking story, told the same way on every
page"), which I pushed four hours earlier.

---

## BLOCKING

### 1. A health check failing after a successful deploy is invisible on every list surface
`hello-world-prod/hello-world-app`'s check set to `Unhealthy` ("p99 latency 4.2s exceeds SLO
of 500ms for 5m"). The controller reacted correctly — `DeploymentBlocked: True, reason:
UnhealthyHealthChecks` — and the API carries it verbatim. At that same second:

| Surface | What it said |
|---|---|
| `/` | **"Trailing 2 — healthy, but behind a newer build"**, chip `deploy succeeded` |
| `/rollouts` | `Attention 0 · In motion 0 · Pending 0 · Trailing 2 · Steady 13` |
| `/apps` | banner lists 3 *gates*, never the failing check |
| `/environments` | prod `4/4 running` |
| rollout detail | **correct** — names the check and the reason |

At 3am they read *healthy* on the rollout whose SLO is blown and go back to bed. An
unhealthy check must promote the rollout into the attention group everywhere, and
`Attention` must count it.

*Critic's own caveat:* this rollout also had three gates closed, so gate precedence may
contribute. But "healthy" in the group caption and `Attention 0` are not gate-conditional.

### 2. `LastErrorTime` survives recovery. The UI deletes it.
Check recovered to `Healthy` with `lastErrorTime` left in place — the witness semantics this
system deliberately relies on. The API returns it; the other three checks have no such field,
so it is a perfect discriminator. The page rendered **"Health Checks — 4/4 healthy"** and
nothing else: when everything passes there is **no list and no expander**, so there is no
affordance anywhere in the product to learn a check was erroring ninety seconds ago.

They see 4/4 green, conclude the page that woke them was noise, and close the tab. The
controller still holds that error as evidence; the dashboard threw it away. A check passing
now with a `lastErrorTime` inside the current deploy's window must read as **recovered**,
not clean, and stay visible at rest.

### 3. Pressing `Retry` erases the failure from History *and* Activity
A real failed production deploy, then the `Retry` the failure banner offers (`200`):

| Surface | Before | After |
|---|---|---|
| History header | `Total 5 · ✓4 · ✗1 · 80% success` | `Total 5 · ✓4 · 2 rolled back · **80% success**` — no failed count, no failed row |
| History rows | `064b655` **Failed** | `064b655` **Deploying** |
| `/activity` | "44 deploys … 1 failed" + banner | "45 deploys … 1 still going" — banner gone |
| `/activity` → Failed filter | the failed deploy | *"Widen the window above, or clear the filters."* |
| Health Checks | `Unhealthy — p99 latency 6.8s` | `Pending — reset due to new deployment` |

The success rate still says **80%** while every visible row is green or blue — the page
asserts a failure it will not show you. "Did this fail before?" becomes unanswerable in a
product whose two audit surfaces are named *History* and *Activity*. **A completed attempt is
an immutable event; a retry is a new attempt, not an edit of the old one.**

### 4. ⚠️ A blocked dependency gate is reported as "waiting on an approval" on the rollout's own page
`rel-67` declares `requires.api=^1.67.0`; newest api provides `1.66.0`. The gate blocked in
all three environments — the state the previous run could not reach. Same rollout, same
second:

- **rollout detail**, amber banner with a **person icon**: *"DEV is waiting on an approval —
  Nothing promotes itself until **someone approves it**. This will not clear on its own."*
- **`/apps`**, **`/apps/<name>`**, **`/environments`**, **Dependencies tab**: all correct —
  *"hello-api-app ships a newer api than 1.66.0. **Nobody has to approve anything.**"*

**Nobody can approve a machine dependency gate.** The classifier on rollout Overview appears
to fall through to `person` for any gate kind it does not recognise — the same defect shape
as the previous run's finding 7, which `ac8e045` was supposed to close. Rollout detail is the
natural destination from every list and from the command palette. At 390 it is worse: the
false banner is above the fold and the corrective tab is an unlabeled glyph.

---

## PAINFUL

5. **`Retry` is one click, unconfirmed, straight into production** — while deploying the *same*
   build by hand now demands a typed sha (`7af14fa` works). Retry redeploys it with no modal,
   no mention of production, no statement that the check which just failed is still failing —
   and it resets the health check holding the evidence (finding 3).
6. **`/`'s "Needs you now" CTAs are navigation, not actions** — `Retry deploy` is an `<a>` to
   the rollout page. And under `MOCK_API=1` every rollout href is `/rollouts//<ns>/<name>` —
   an **empty cluster segment** — so every rollout link on `/` and `/rollouts` is dead in the
   fixture the team develops against. The URL builder has no fallback when a rollout carries
   no source cluster, which is plausible for the single-cluster deployment this product is
   billed as. Separately, **`Promote now` is the wrong verb** for a rollout whose final health
   check has been hanging an hour.
7. **An 18-minute stuck deploy is indistinguishable from a 10-second one.** Rollout detail was
   excellent; `/` said *"deploying & checking right now"* unchanged for eighteen minutes with
   **no elapsed time at all**. The only stuck rule keys off `checking >1h`; a deploy stuck in
   `Deploying` — never reaching the check — has no stuck rule.
8. **`/environments`: a red "1 failing" header above a green "All 4 apps here are up to
   date"** — parity computed ignoring the failure directly beneath it. Previous finding 8's
   splice recurring in the failure state.
9. **The Change Version modal never names the contract** it is overriding — "a rule is
   holding it", where the Dependencies tab one click away names the contract, the provider and
   the version. The modal is the single moment where it matters and has the least information.
10. **Once you break the contract, the product goes silent.** After force-deploying through
    the gate, dev is the *good* one — "1 of 3 up to date", filed under **Steady**. Nothing says
    dev is running a build whose api requirement is unmet.
11. **Two banners stack and contradict each other** on a failed rollout: the schedule gate
    ("a deploy you start by hand still applies immediately") sits **above** the production
    failure ("automated deployments are paused until this is resolved").
12. **`/apps` says "4 apps"; `/rollouts` says 126.** Rollouts with no `Environment` CR are
    dropped silently from the page the operator is told to triage with.
13. **121 never-deployed rollouts are filed under "Steady"** on `/` (a first-class `Pending`
    counter on `/rollouts`, a footnote inside another group on `/`). "Steady" is not a word for
    "has never shipped". ~41 rows of near-empty cards precede anything real.
14. **`/versions` says "fully rolled out" while a build from that commit is held in three
    places.** It is keyed on the git commit, and this repo's own harness publishes the api and
    frontend halves of `hello-dep` from **one commit** with different contract versions.

## COSMETIC
Mock cards render **`failed failed`**; mock `/` lists `stuck` rollouts in both "Needs you now"
and "In motion" (same card twice, `4 + 4` counters over 6 rollouts); controller strings still
say **bake** inside labels that now say **Check** ("…before starting bake"); `/activity` shows
8 skeleton bars *beneath* its outage error, reading as still-loading forever, and no page has a
manual retry; truncated names have no `title`; `"1 rollout· 1 need attention"` — missing space,
wrong verb; at 390 the rollout-detail tab bar is icon-only.

---

## What is genuinely good — the critic went looking for the opposite

**The failed-deploy path, before you touch it, is the best work on this branch.** Six surfaces
agreed within one refresh, no reload: `/` opened a **"Needs you now 1"** group with a red card
and `4/5 stages done · 1 failing`; `/rollouts` `Attention 1`; `/apps` *"PROD's last deploy
failed. No newer version gets past PROD until a deploy there succeeds"*; `/environments` a red
banner; `/activity` a working `Failed` filter; History `80% success` with the row marked
Failed; and rollout detail naming the check, quoting the reason, stating the consequence, and
offering two actions. Verified at 390 dark as well as 1440.

Also confirmed fixed by this run: **previous finding 2** (outage states — measured 5 retry
requests in 45s, so "trying again" is true rather than decorative) and **previous finding 10**
(typed confirm on the dangerous direction). **`MOCK_PARTIAL`'s copy is the best in the
product** — *"a rollout that lives on prod is missing from these counts, not healthy in
them"* — and that sentence is exactly what findings 1, 3 and 10 are missing.

**Scale mostly holds.** 126 rollouts: search box appears, `/` caps at "+123 more", 563KB
served in 55ms, no overflow at 390. At 22 environments `/environments` splits into **pipeline
stages** and **production regions, furthest behind first** — the stages-are-a-line /
regions-are-a-set intent, implemented.

---

## Cluster state left behind — read before debugging anything

**Reverted and verified clean:** the `critic-payment-latency` HealthCheck (created, cycled,
deleted), `bakeTime` restored to 15s, 121 Rollouts and their namespaces deleted, pins removed,
`hello-frontend-app` dev reverted to `rel-66`.

**Deliberately left in place:**
- **`hello-dep/frontend:rel-67` is published** (requires `api ^1.67.0`) and loaded into both
  kind clusters. **This is why the dependency gate is blocking in dev, staging and prod right
  now** — the state we asked for. To clear it, publish `hello-dep/api:rel-67` with
  `org.opencontainers.image.version=1.67.0-67`; to keep it, do nothing.
- **`hello-world-prod/hello-world-app` is now on `064b655` (newest)**, not `991829b`, so it is
  no longer the "rolled back, 15 behind" rollout the first report describes. Its History
  carries two extra entries authored by `admin@example.com` with messages beginning `critic:`.
  `hello-world-staging` is untouched and still 15 behind.

**Script bug worth fixing:** `scripts/build-and-push.sh 1` published `rel-16`, not `rel-67` —
`git rev-list --count HEAD` on the freshly cloned `kuberik-testing` returned 16. Those tags sit
below the current `rel-66` and the numerical ImagePolicy ignores them, so nothing moved, but
**the script can no longer produce a newer hello-dep pair** until that repo's history exceeds
66 commits.

## LEFT — still unreached
Recovery from an API outage without a reload (needs the shared dashboard down); hundreds of
rollouts in *mixed real* states (the 121 were all Pending); a rollout stuck in `checking` >1h
(the only observable stuck rule); a very long *gate* name (they are controller-generated);
`bypass-gates` (documented in `CLAUDE.md`, still no control in the UI); `MOCK_SLOW` and the
`MOCK_FAIL` fixtures; a failing health check on a rollout with **no** gates closed, needed to
isolate finding 1 from gate precedence; and what `Release the hold` does now that it is a deep
link.
