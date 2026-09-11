# Changes: what they are, and what "no release" means

`/changes` and the change page (`/changes/<owner>/<repo>/<number-or-sha>`) answer one
question — *how far did this merged pull request or commit get?* — for every service on the
cluster that repository deploys. This doc is the model behind that answer: what a change is,
how its affected services are decided, what "no release" means (and does not mean), how
containment works, the verdict grammar, and what the per-family meter draws.

Needs `docs/github-app.md` configured — without it, `/changes` degrades to the ledger
fallback (below).

## A "change" is a merged PR or a bare commit

`GET /api/github/changes` returns one entry per merged pull request on the repository's base
branch, plus bare commits pushed directly to base with no PR behind them (`kind: 'pr'` vs
`kind: 'commit'`). Both kinds are folded through the exact same pipeline
(`view-models/pr-pipeline.ts`'s `buildPrPipeline`) — there is no special-cased "PR" code path.

## Which services are affected by a change

**A service is affected by a change only when it has a release built from the change's own
commit** — CI released that exact `mergeCommitSha` for that service. Services with no such
release are **unaffected** and do not appear on the change at all: not in the landing grid,
not in "N of M rollouts", never a "not built yet" card, never an ETA, never a `builtElsewhere`
hint. They are dropped silently and listed only in `unaffectedServices` (a debug-only field —
no product surface renders it).

This is deliberately **not** "any service whose release contains this commit in its ancestry."
A service's own release can be a *later* commit that happens to be a descendant of (and so,
technically, "contains") an older merged change — that does not mean CI built that service
*for* the older change. Using descendant containment for eligibility was a real bug: one
service's single held release was a descendant of nearly every older commit on its repo, so
*every one* of those older, unrelated changes read "held in dev on `<that service>`" — a hold
that had nothing to do with them. The fix: eligibility is exact-sha only. Descendant
containment (below) is used only *after* a service is confirmed affected, to decide whether an
environment's current build or head carries the change.

**We cannot see a build that failed or was skipped.** If CI decided not to release a commit for
some service — a failed build, a path filter, a service untouched by the diff — this dashboard
has no signal for that decision and does not try to guess it. "Assume CI didn't release it for
a reason" is the operating assumption; distinguishing "CI chose not to release this" from "CI
tried and failed" is **not implemented** and is explicitly future work.

A change where **zero** services have any exact-sha release anywhere on the cluster reads
`noRelease: true` — one line, "no release for this commit," and no per-service cards at
all. This is distinct from "no app on this cluster deploys this repository," which reads "not
built here" (`verdictWord`) / "not deployed here" (the dense standing word) — a fact about the
*repository*, not about *this* commit.

## Containment: exact sha, descendants, and the 300-commit cap

Once a service is confirmed affected, `buildCell` (`pr-pipeline.ts`) decides each
environment's own cell state using the backend's `containedIn` set: `{mergeCommitSha} ∪
{commits on base since mergedAt}`, capped at 300 entries (`containedInAll: true` means the list
was truncated at that cap).

- An environment's **current head** revision in the set → `live` (`superseded: true` when the
  head is a *later* commit than the exact merge sha — the change shipped via a later build that
  also carries it).
- An **older history entry** (not head) in the set, head not in the set → `rolled-back`.
- An `availableReleases` candidate in the set, not yet promoted here → `queued` (its own turn
  hasn't come up), `gated`/`pinned`/`waiting-upstream` (something is actively refusing it), or
  `promoting` (nothing is blocking it, the controller hasn't reconciled yet).
- Nothing in the set at all for this environment, on an otherwise-affected service → `queued`,
  "not offered to `<env>` yet" — never the retired "not built" reading.

When `containedInAll` is `true` (the list was truncated), a release outside the literal set can
still be read as contained via a fallback: its own `created` timestamp compared against the
change's `mergedAt`. This fallback is **cell-classification only** — it never grants a service
eligibility on its own (see above); it only helps `buildCell` classify an *already-affected*
service's other environments correctly when the authoritative list ran out of room.

## The verdict grammar

`buildChangeVerdict` (the one frontier-verdict function every surface — change page, index row,
Home card — reads) names the **frontier**: the earliest-environment-rank cell, among affected
services, that is not yet live. Naming the frontier rather than "the worst state anywhere"
matters because a later-ranked cell is usually just waiting on the frontier anyway — "held in
dev" is more actionable than "held in prod" when dev is where the actual block is.

Words in play, none of which is ever "not built yet" any more:

| shape | example |
|---|---|
| everything affected is live | `live everywhere` |
| a service is held on a rule or dependency | `<service> held in <env> on <subject>` |
| a dependency that cannot resolve on its own | `… · will not move on its own — needs <provider> <contract> <range>` |
| nothing anywhere carries this exact commit | `no release for this commit` (`noRelease: true`) |
| no app on this cluster deploys the repo at all | `not built here` |

The dense "standing" word (`standingWords`/`standingWordsCompact` — Home's row, the compact
card) is a *different*, ≤4-word vocabulary from the full verdict sentence above, and never says
"built": `no release` for a `noRelease` change, `not deployed here` for the repo-mismatch
case, `held in <family>` / `failed in <family>` / `<verb> to <family>` for an in-flight one.

### An approval hold names its rule after the lazy fetch, never before

A held cell whose gate resolves to a manual approval (no promotion order, no cross-service
dependency, no deploy-window join) reads **"held for approval"** the instant the pipeline VM
builds it — a best-effort guess (`PrCell.gateApprovalGuess`), because this VM never fetches
`rolloutGates` and cannot back up a specific rule NAME yet (see "Which services are affected",
above, for the same non-guessing discipline applied to a different fact). The change page's own
row (`PipelineRow.svelte`) is the one place that guess gets confirmed: its "Why is it held?"
disclosure fetches the single-rollout endpoint (which DOES carry `rolloutGates`) either lazily,
on click, or eagerly for the frontier row. Once that fetch settles and genuinely classifies the
gate as an approval, the row upgrades to **"held for approval · `<pretty name or gate name>`"**
— the same "pretty name, falling back to the gate's own name" lookup the disclosure's own record
uses, so the two can never name the rule two different ways. If the fetch instead reclassifies
the gate as something else entirely (a closed schedule, most often — the one false-positive this
guess is known to produce), the row falls back to the honest generic "held by a rule" rather than
keep naming an approval that was never real. No ETA is ever printed on an approval hold, before
or after the fetch — clearing it needs a person, not a clock.

An estimate ("usually N min once it starts") is only ever printed for a **normal order wait**
(`queued`/`promoting`) — a build that exists and just hasn't reached this environment yet. It is
never printed for `gated`/`pinned`/`waiting-upstream`: those clear on a rule, a person, or an
upstream shipping something, and none of that is a countdown. Printing an ETA on a hold that
will not resolve on its own is a direct contradiction with the verdict's own "will not move on
its own" tail, and used to happen.

## The meter

The landing grid's compact form (`ChangeLine`'s per-family meter, `familyProgress` in
`changes.ts`) draws one step per environment *family* (`DEV`/`STG`/`PRD`, `TEST` when present),
not one mark per service/environment cell — walked in promotion order, freezing at the first
stuck/failed family so a service independently held three stages downstream never repaints
every stage amber. A `noRelease` change (or the no-GitHub ledger fallback, which also has no
services to draw) still shows a meter: **three neutral, dashed placeholders** — `DEV`/`STG`/
`PRD`, no color, nothing to name — rather than an absent meter. The meter never disappears; it
just has nothing to report. **No release means not affected**, so `noRelease`'s three dashed
placeholders are not "held" or "behind" for those families — there is nothing to draw yet, which
is a different fact from a family this change genuinely cannot reach.

Each step's field/glyph is state-only, never identity, and reduces to four readings:

| reading | field | meaning |
|---|---|---|
| solid green, check glyph | `live` | every affected service in this family has this build live |
| green **ring**, no fill | `live` (partial) | at least one affected service is live here, at least one is not yet — "getting there", still green because nothing here is stuck |
| **amber** (orange), filled | `stuck` | this is the frontier family and something here needs a person, a pin, or an upstream that cannot proceed on its own — the one reading a reader should stop and look at |
| **dashed**, no fill | `none` | not reached yet — either past the frontier (normal, nothing wrong) or `noRelease`/the ledger fallback (nothing to draw at all) |

A neutral gray clock (`queued`, waiting its normal turn) and a pulsing blue/yellow dot
(`deploying`/`baking`) exist too, for a family genuinely mid-promotion — amber is reserved for
`stuck` alone; a normal promotion-order wait is never painted the same color as a family that
needs attention.

## The ledger fallback

When GitHub is not configured or not connected, `/changes` still renders — `buildLedgerChangeRows`
reads the same rollout/environment data every other page streams and produces a simpler row: a
revision, its short sha, and how many of the cluster's slots are running it. No author, no PR
link, no landing grid (there is no GitHub metadata to build one from), and the meter draws its
three dashed placeholders exactly as a `noRelease` change does.
