# `/revisions` — repository sections, one row grammar, a findable build (2026-09-05)

Spec for `frontend/src/routes/revisions/+page.svelte` (+ its scoped `<style>`), answering the
seven-point critique. Measured against the live fleet: `kuberik-testing` (5 services, 36 builds,
15 places) and `kuberik-testing-second` (2 services, 5 builds, 6 places). Today the page is
**1952px at 1440** and **3058px at 390**. Target with the second repo collapsed: **~1050 / ~1750**.

Binding: `src/lib/CLAUDE.md` (head band, 47px card header, spacing `2/4/6/8/10/12/16/24`, radii
`4/8/12/pill`, the rail rule, Loading states, the vocabulary decision, "repo ≠ release line") and
`COMPOSITION-GRAMMAR.md` §1–§8. Rulings honoured: single-fill bar, no action-styled navigation,
one verb per action, no tracked-uppercase header rows, no coloured accent on a rounded element.

## 1. Each repository is ONE card, collapsed by default

**Decision.** The multi-repo section header row and the single-repo rail identity card are both
replaced by one **repository card**, always drawn, which is also the section's disclosure. Its body
is the per-service ledger (§7), so the collapsed state carries the page's most useful answer rather
than a title bar. Expanding appends the build cards below it.

**Composition.** `Card`, radius 8, `icon={CodeBranchOutline}`.
- Header 47px (`px-4 py-3`, bottom hairline). It is a `<button type="button">` spanning the
  header, `aria-expanded`, `aria-controls="repo-<key>-detail"`, hover `bg-gray-50 / gray-700/40`.
  Left: `ChevronRightOutline` 16px (rotate 90° when open, `transition-transform 150ms`), gap 10,
  the repo title at `t-card-title` (`repoTitle(repo.repoLabel)`, `break-words`).
  Right, hard-right via the header's own `justify-between`: the rollup at `t-card-rollup` (§6).
  It is a local view toggle, so button chrome is legal and it is NOT a `.btn` and NOT a `.nav-link`.
- Body: the service ledger (§7), a hairline, then the meta line at `t-micro text-gray-500`
  (`px-4 py-2`) with `View repository ↗` (`.nav-link`, `ArrowUpRightFromSquareOutline`,
  `title={repo.repoLabel}`) hard-right on the same row. One control, one destination.

**Default open state.** `ledgers` is already sorted most-recently-active first → **index 0 open,
the rest closed**, remembered with `rememberShape('revisions', { repos, open, services })`. `open`
is a comma-joined list of **indices** (`"0"`, `"0,2"`), never a repo key — indices are shape, keys
are fleet data, which `skeleton-hints.ts` forbids. `services` is a comma-joined per-repo service
count (`"5,2"`) so the skeleton can size each ledger.

**Bounded.** A ledger prints at most **6** service rows, then the existing `more` snippet:
`Show 3 more services` / `Hide 3 more services`. Twelve repos therefore cost ~230px each.

## 2. The bar draws only when it measures a shortfall — and it is one fill

**Decision.** `coverageSegments()` is not used on this page. The bar is **one mint fill on the
neutral track**, width `live / total`, and it renders **only when `live < total`**. At full
coverage the bar is omitted entirely; the count above it already said so. Failing, held and
moved-ahead places are said in **words and chips**, never as a second colour in the bar.

- `<CoverageBar segments={[{ key: 'live', count: cov.liveCount }]} compact />` on the neutral
  track. Height 6, radius 4, `mt-1.5` under its count. The aria `label` keeps the full sentence:
  `running in 8 of 9 places · 1 not here yet`.
- **The contradiction this kills.** `6 of 6 running it · 3 held on 2.67.0-67` over a full green bar
  becomes: no bar; the figure `6` `of 6` with `places running it` beneath it; an alarm chip
  `3 HELD` (`Chip role="alarm" wide`, `title="3 places are held by a rule"`) under the figure. The
  release-split sentence (`3 of them on 2.66.0-66; 2.67.0-67 is held in dev, staging and prod.`)
  is unchanged, `t-body text-gray-500`, full width, above `View commit`.
- Failing somewhere: bar fills to `live` only, plus `Chip role="adverse" label="FAILING"` beside
  the count. Red never enters the bar.

## 3. One row grammar, optional cells

**Decision.** All three build lists use `.bld-row`. The TRACKS are identical in every card so ids
line up down the whole page; cards differ only in which cells they fill.

```
grid-template-columns: 16px minmax(0,1fr) 200px 16px;   gap: 12px;  padding: 10px 16px;
   [1] state glyph   [2] id + names   [3] rollup stack (right)   [4] chevron (absolute, right 16)
```

| cell | Still running | No longer running | Never deployed (rail) |
|---|---|---|---|
| 1 glyph | `BuildStateMark` | empty (track kept) | empty (track kept) |
| 2 id | `t-code` sha + `names` snippet | same | sha only (rail is 340px) |
| 3 line a | `Running in 8 of 9 places` `t-dense` | — | `3 services` `t-dense` |
| 3 line b | bar, only if `< 100%` | — | — |
| 3 line c | `Deployed 1d ago` `t-micro` | `Last deployed 5d ago` | `Built 7d ago` |
| 4 chevron | yes | yes | yes |

Removed: `.rev-row--quiet`'s `1fr 96px 16px` tracks and `Never deployed`'s bespoke
`flex items-baseline gap-3` row — the reason nothing aligns between the three lists today.

**Reflow is by CONTAINER, not viewport**: the rail is 340px at 1440 and needs the same form 390
does. `@container (max-width: 560px)` on the card → tracks `16px minmax(0,1fr) 16px`, `.bld-roll`
to `grid-column: 2`, `text-align: left`, `flex flex-wrap gap-y-1 gap-x-12`, bar on its own
full-width line. One rule, three places (rail 340, main column under 560, phone 358).

## 4. The object is a build

Every user-visible "revision" on this page becomes **build**. Exact changes:
- Head band: `19` `of 41 builds deployed · 2 repositories`; the definition stays as the rollup's
  `title`, unchanged.
- Repo meta line: `36 builds · 14 deployed at least once · 15 places to deploy to`,
  `title="A place is one service in one environment."`
- The nav's `Revisions`, the route, `<title>kuberik | Revisions</title>` and `SHAPE_KEY` name the
  SECTION and do not move — the 2026-09-03 vocabulary ruling says exactly this.

## 5. Every age names its event

`ageOf()` returns a verb-led string chosen by which list the row is in — stable inside a card, so
nothing is inferred from a present/absent word:

| list | string | source |
|---|---|---|
| hero / Still running | `Deployed 1d ago` | `lastDeployMs` |
| No longer running | `Last deployed 5d ago` | `lastDeployMs` |
| Never deployed | `Built 7d ago` | `createdMs` |

Any row with no `lastDeployMs` falls back to `Built {t} ago`. `title` stays the absolute
`formatDate(...)`. Bare `9h ago` is removed from the page.

## 6. The repo header leads with distance

**Decision.** The card header's rollup is **how far the repo's deployed frontier is behind its
build frontier**, and nothing else. The three jargon figures demote to the `t-micro` meta line.

```ts
const newer = repo.pending.filter(p => p.createdMs > (repo.rows[0]?.createdMs ?? 0)).length;
verdict      = newer > 0 ? `${newer} newer build${newer === 1 ? '' : 's'}` : 'Newest build deployed';
verdictTitle = 'Builds newer than the newest one any service here is running. None of them has been deployed anywhere.';
```

A claim about **builds in one repo ordered by creation time** — never about a service being
behind a build it can never reach (`repo ≠ release line`). Per-SERVICE distance stays on the
service's own ladder (§7's rank chip) and is never summed into a repo figure.

## 7. Find a build; answer "what is `hello-api-app` running everywhere"

**(a) The service ledger** — the repository card's body and the page's per-service answer. One
group per service, one line per build that service runs:

```
grid-template-columns: minmax(140px, 200px) 88px auto minmax(0,1fr);  gap 12; py 6; px 16
   [service name]  [sha t-code]  [rank chip]  [env chips]
```
- Name `t-body text-gray-700`, `<wbr>` after each hyphen (reuse `identParts`); sha `t-code`
  linking to `revisionPath(...)`, `title` = full revision.
- Rank chip from `rankLabel()`: `NEWEST` (green) at `svc.rank === 0`, `N BEHIND` (orange) above 0,
  nothing at `svc.rank === null` — never a guessed number. Env chips: `Chip role="env"` per live
  slot, in `compareEnvironmentNames` order.
- No live slot → one line: name + `t-micro text-gray-500` `Not deployed`. Later lines of a group
  leave the name cell empty; alignment carries the group.

**Each group row is a filter toggle.** `<button aria-pressed>` over the row; pressed =
the settled selected-toggle treatment (`bg-gray-900 text-white / dark:bg-gray-100
dark:text-gray-900`, radius 8, no accent bar), `aria-label="Show only {appName}"`. Pressing
filters this repo's build lists to rows whose `services` include that app and expands the section.
Multi-select; press again to clear; view state only, not remembered.

**(b) The search field** — one row at `y=72`, the first content element (a filter bar is content
and may legitimately sit there). `w-full` at 390, `max-w-sm` from 640.
- `SearchOutline` 16px inside the field, left; `placeholder="Find a build or service"`;
  `aria-label="Find a build by sha or a service by name"`; radius 8, height 36, `t-body`. The
  unlayered iOS input-zoom rule already covers this input — do not touch it. `×` clears
  (`aria-label="Clear the search"`); Escape clears.
- Matching, case-insensitive: `revision.startsWith(q)` OR `short.includes(q)` OR any
  `services[].appName.includes(q)` OR any `labelGroups[].label.includes(q)`.
- While `q` is non-empty every section renders expanded; clearing restores the remembered open
  set. Each build card's rollup reads `{n} of {m} builds`; the ledger filters to matching services.
  A repo with no match keeps its card and prints `No build matches “{q}”.` (`t-body
  text-gray-500`, `px-4 py-6`, centred) in place of its lists. Nothing is hidden silently.

## The page, at 1440

```
19  of 41 builds deployed · 2 repositories                                    ← head band, y=24
[ 🔍 Find a build or service            ]                                     ← y=72, h36

┌─ ⌄ ⑂ kuberik-testing                                     3 newer builds ──┐  ← 47px header
│  hello-api-app        9f10e49   NEWEST     [DEV][STAGING][PROD]           │
│  hello-frontend-app   9f10e49   NEWEST     [DEV][STAGING][PROD]           │
│  hello-multi-app      064b655   2 BEHIND   [DEV][STAGING]                 │
│                       6f9524e   3 BEHIND   [PROD]                         │
│  hello-world-app      064b655   2 BEHIND   [DEV][STAGING][PROD]           │
│──────────────────────────────────────────────────────────────────────────│
│  36 builds · 14 deployed at least once · 15 places   View repository ↗    │
├───────────────────────────────────────────────────────────────────────────┤ ← expanded below
│ ┌─ 🚀 Newest build in use                                  2 services ──┐ │
│ │  NEWEST BUILD                                                  6      │ │  24px figure
│ │  9f10e49                                                   of 6       │ │  24px mono id
│ │  ⏸ held in 3 places                              places running it    │ │
│ │                                                        [ 3 HELD ]     │ │  (no bar: 100%)
│ │  3 of them on 2.66.0-66; 2.67.0-67 is held in dev, staging and prod.  │ │
│ │  View commit ↗                                                        │ │
│ └───────────────────────────────────────────────────────────────────────┘ │
│ ┌─ ✓ Also still running        2 builds ─┐ ┌─ ⧗ Never deployed  22 blds ─┐│
│ │ ⧗ 064b655        Running in 8 of 9 pl. │ │ 479b874          3 services ││
│ │   hello-multi-app · …   ▓▓▓▓▓▓▓▓░  ›   │ │               Built 7d ago ›││
│ │                     Deployed 1d ago    │ │ …                           ││
│ └────────────────────────────────────────┘ │ › Show 16 more builds       ││
│ ┌─ ▤ No longer running anywhere  11 blds ┐ └─────────────────────────────┘│
│ │   3bcdfa2  hello-world-manifests       │                                │
│ │                  Last deployed 5d ago ›│                                │
│ └────────────────────────────────────────┘                                │
└───────────────────────────────────────────────────────────────────────────┘

┌─ › ⑂ kuberik-testing-second                          Newest build deployed ┐  ← collapsed
│  hello-second-app        7d8de32  NEWEST  [DEV][STAGING][PROD]             │
│  hello-second-manifests  7d8de32  NEWEST  [DEV][STAGING][PROD]             │
│  5 builds · 5 deployed at least once · 6 places      View repository ↗     │
└────────────────────────────────────────────────────────────────────────────┘
```

## At 390 — one column, everything else identical

```
19  of 41 builds deployed          ← head band wraps; 24px lead unchanged
· 2 repositories
[ 🔍 Find a build or service     ]

┌─ ⌄ kuberik-testing ─────────────┐   rollup wraps to its own line, flush left
│              3 newer builds     │   (Card's justify-between, single-item rule)
│ hello-api-app                   │   ledger stacks: name / sha+rank / env chips
│   9f10e49  NEWEST               │
│   [DEV][STAGING][PROD]          │
│ …                               │
│ 36 builds · 14 deployed …       │
│ View repository ↗               │
├─────────────────────────────────┤
│ ┌ 🚀 Newest build in use ──────┐│
│ │ NEWEST BUILD                 ││
│ │ 9f10e49              6 of 6  ││
│ │ ⏸ held in 3 places  [3 HELD] ││
│ └──────────────────────────────┘│
│ ┌ ✓ Also still running  2 ─────┐│   .bld-row two-band form: id+names on top,
│ │ ⧗ 064b655                    ││   rollup below at the same left x, bar full
│ │   hello-multi-app · …        ││   width. No longer running / Never deployed
│ │   Running in 8 of 9 places   ││   follow in the same single column, same
│ │   ▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░          ││   row grammar.
│ │   Deployed 1d ago         ›  ││
│ └──────────────────────────────┘│
└─────────────────────────────────┘
```

## Breakpoints (container queries, not media queries)

| rule | threshold | effect |
|---|---|---|
| `.rev-cols` | `@container (min-width: 860px)` | main + 340px rail; below, one column. 860 is the product's ONE rail number (`.apps-split`/`.env-split`/`.ab-grid`) — do not derive a fourth. Between 860 and ~900 the main column is under 560 and its rows take the stacked form: the trade `/apps/<name>` already makes. |
| `.bld-row` | `@container (max-width: 560px)` | two-band row (rail + phone) |
| ledger row | `@container (max-width: 560px)` | name / sha+rank / env chips stack, 4px row gap |
| head band | unchanged | 24px lead, `t-dense` rollup on its baseline, `mb-5`, first content y=72 |

## States

- **Loading.** Reserve head band (28px) + search field (36px, disabled, real geometry) first.
  Then `repos` cards from the hint (1 on a first-ever visit): 47px `CardSkeleton` header,
  `services[i]` ledger rows (fallback 3) at 26px, a meta bar. A card at an index in `open` also
  reserves the hero and the `.rev-cols` block, exactly as today's skeleton does. Flip test:
  nothing may move.
- **Error / empty fleet.** `ErrorState`, and `Nothing built yet` + its sentence — both unchanged.
- **Repo with no deployed build.** No hero and no running/retired cards; every ledger row reads
  `Not deployed`; rail shows `Never deployed` only; rollup counts every pending build.
- **Repo with everything deployed.** `Never deployed` still renders, `0 builds` rollup and its
  honest empty sentence — the rail is part of the layout.
- **Search with no match anywhere.** Every repo card stays, each printing `No build matches “{q}”.`

## What changes for a single repository

The single-repo page is no longer byte-identical, and that is the deliberate part of this pass.
Today one repo gets no section header and its identity sits in a rail card at the bottom
(`Places to deploy to` + `View repository`), 900px below the content it names. That card is
**deleted**; §1's repository card opens the page instead, expanded by default, carrying the
identity, the distance rollup, the service ledger and `View repository`. The hero and the three
build cards below are unchanged in kind. The landmark order changes from
`['Revisions','Newest build in use','Also still running','No longer running anywhere','Never
deployed','repo-a']` to `['Revisions','repo-a','Newest build in use','Also still running','No
longer running anywhere','Never deployed']` — the repo name moves from last to second, and the
pinned test in `routes/revisions/page.svelte.test.ts` must be updated to that array in the same
commit, with a comment recording that the rail identity card was folded into the section card. The
`· 1 repository` assertion stays; `Also still running` keeps its existing `lead ? … : 'Still
running'` conditional. One repo is expanded by default; collapsing it is the operator's choice and
is remembered.

## Removed

1. The multi-repo section header row and its three-figure meta line (§1 card replaces it).
2. The single-repo rail identity card and its one-row `<dl>` (§1 card replaces it).
3. The coverage bar wherever coverage is 100% — hero and rows (§2).
4. `coverageSegments()` on this route; the bar is single-fill (§2).
5. `· 3 HELD ON 2.67.0-67` from the hero's `t-label` line — now a chip plus the split sentence.
6. The hero's `Running it now` service→env spread — it is the service ledger now, one statement
   in one place, and it is visible while the section is collapsed.
7. `.rev-row--quiet` and the bespoke `Never deployed` row; both become `.bld-row` (§3).
8. Bare `9h ago` / `7d ago` ages (§5).
9. The word "revisions" from every page label (§4).

## Risks / where this stretches the system

- **The pinned single-repo test changes.** Structural, named above, not a slip.
- **A row that is also a toggle.** The gray-900 selected fill is settled for toggles but has never
  been applied to a LIST ROW. If review reads it as selection rather than filtering, fall back to a
  multi-select `.pill-btn` chip strip under the ledger — `/rollouts`' own mechanism — at ~34px per
  repo.
- **`newer builds` assumes `createdMs`.** Where `rows[0]` carries none, render `Newest build
  deployed` rather than a guess.
- **`.rev-cols` moves from a 1024px media query to an 860px container query.** Trade named above.


## Round 4 rulings (2026-09-05, after the operator walk and craft review)

1. **A row is about one release.** Two releases can share a commit (`9f10e49` carries `2.66.0-66`,
   running everywhere, and `2.67.0-67`, held everywhere). A ledger row, hero and coverage count
   describe ONE release; when a revision has several, one row per release with the sha followed by
   the version. The head count counts releases. Both rows link to the same detail URL — the detail
   page already lists every release of a sha and prints `built` per release.
2. **Peer comparison follows release order, not history containment** (`compareRollouts`,
   94f35ca). A dev rolled back to a build prod never ran put prod's build in dev's past, and prod
   read STUCK on the newest release for a day. `availableReleases` (oldest-first) decides who is
   ahead; history containment only when no list places both versions.
3. **A list-less passing gate vouches** (`gatesAllow`, 94f35ca). The dialog no longer claims "the
   rules holding dev do not allow this build" when the only holder is the pin.
4. **The held state is a filled AlertPanel** at the top of the repository's disclosed block —
   consequence sentence with named subjects, contract clause, the rule — and the hero drops it.
5. **Hero title names the release line** (`Newest build · service · service`); the rollup carries
   the verdict; below 560 the service list folds to `N services`.
6. **Search tells the truth once.** A card with no matches inside a repository that has one prints
   nothing; a repository with no matches is one line; every count on screen follows the filter.
7. **The age names its environment.** One age per row is the laggard's, labelled, with every
   environment's date in the title.
8. **Every environment chip is a link** to its own rollout; a pinned place offers Clear pin first.
9. **`live` is conditional** on the change stream being healthy; otherwise "updated N ago".
10. **Chip + age is one atom** on the detail page; one per line on phones.


## Round 5 rulings (2026-09-06, after the second operator walk and craft review)

1. **Coverage counts the revision.** "N of M places" counts places whose running release has
   this sha; a place on an older release of the same commit is LIVE (`onRevision && !onIt`),
   never "not here yet". The release split is said once — by the repository banner and the row
   chips — and by nothing else. (Supersedes the reading of ruling 4.1 that made the hero count a
   single release; a row is still about one release.)
2. **In flight is a state.** A place whose bake is Deploying/InProgress is its own bucket,
   excluded from "live"; "fully rolled out" only when every place is past bake; blue/yellow per
   DESIGN-INTENT, words from `bake-status.ts`. /revisions showed green for two minutes of canary.
3. **The row age is the most recent deploy**, named with its environment when environments
   disagree by more than a minute (supersedes 4.7's laggard). The title keeps every date.
4. **Environment chips link everywhere**, on the list as on the build page.
5. **A multi-line repository prints no distance verdict** in its header; the hero cards speak per
   line. A single-line repository keeps `Newest build deployed` / `N newer builds` / `Newest build held`.
6. **The filter reaches the header**: chip only if a held build matches, `N of M builds`, no
   meta line, and no empty list cards.
7. **The hero is header + View commit when the bar is omitted.** The rollup is always coverage;
   the body never restates it.
8. **One cause drawn once** on the build page too: the contract clause appears one time with the
   environments it bites and the provider link, in the drawn form, not per environment in prose.
9. **Queued is not stuck.** A place whose generation the controller has not observed yet (or that
   changed in the last minutes) is queued/deploying; STUCK needs eligibility plus stillness.
10. **Lists sort by the field they show**, and when relative ages collapse to one label the
    compact absolute time is printed.


## Round 7 rulings (2026-09-06, after the third operator walk and craft review)

1. **A hero with no shortfall is a row.** When the bar is omitted the hero is its 47 px header —
   title, coverage rollup, `View commit` — and nothing else. A card body exists only for a drawn
   bar or a banner. The 24 px sha body was the largest and least informative ink on the page.
2. **A status sentence about a multi-release commit names the release**, never the bare sha:
   `hello-frontend-app 2.67.0-67 is held`, not `9f10e49 is held` above `9f10e49 · 6 of 6`. In the
   ledger, a service with more than one release on the row's revision shows the release label as
   the joined chip value.
3. **The blocking banner is never collapsible.** It sits under the ledger footer, outside the
   `N builds` disclosure, with its rule and its action, whenever the hold exists.
4. **In flight is one mark per row.** The environment chip takes the treatment inside its own box;
   the age column says since when; no inserted word, no second chip. The chip run never changes
   width.
5. **The head band is the verdict**: the figure is the number of places not on their newest
   allowed build (held, behind, deploying) and the sentence names them; the lifetime "N of M builds
   deployed" belongs to repository footers.
6. **The repository header is the toggle** (`.tap-zone`, chevron at the left, the labelled pill as
   `.tap-link`), not a 93 px control in a 1199 px header.
7. **One empty-state treatment**, flush left, and no empty card under a filter.
8. **A row's measure is capped** (~46rem) so an age never sits half a screen from its id.
9. **The deepest page carries the fix**: the build page's hold disclosure leads with the blocking
   cause, drawn once, with who has to ship what and the link; other rules follow, labelled as
   clearing on their own.
10. **Facts that only live in `title` are not on the page**: per-environment dates open from the
    age (button + popover), service names print where they fit.
11. **The bar is omitted at 0 % as at 100 %.** No second fill hue for in flight; the words carry it.


## Round 9 rulings (2026-09-06, convergence round)

1. **The hero names its build and is a build row**: `Newest build 9f10e49 · services`, the header
   navigates to the build page, `View commit` stays the external link. A held sibling release is
   said in the rollup (`6 of 6 places · 2.67.0-67 held`). Under a filter, title and counts follow
   the filter.
2. **Fold on fit**: the hero title truncates (full names in the title attribute) so title and
   rollup always share one line; the `N services` fold is only for < 560.
3. **The ledger age is right-aligned** at the card's content edge, like the header rollup and the
   footer (supersedes 5.3's "after the chips"); build and environment columns share fixed tracks
   across repositories; the chevron track is reserved even when nothing can be disclosed.
4. **State chips live beside the rank chip**, never inside the environment run.
5. **One rule for the services cell**: filtered count, names where they fit, a tap disclosure
   below that. No dead labels on touch.
6. **The search counts builds (commits)**, releases are said separately; a zero-result query keeps
   the verdict.
7. **The line caption is gone**; the rows and the banner carry the releases.
8. **Environment chips are never full-width**; the hold summary names the cause and counts what it
   draws; a service label equal to the sha is not printed.
9. **One row grammar per card** on the build page: chips inline in one wrapping run, ages inline
   beside their chips when they differ.


## Round 11 rulings (2026-09-09) — the bar comes back, one page per repository

Two asks from the human, verbatim:

> "we lost the bar that says on how many places the version is active / passed by"

> "i think we also don't want to list all repos in detail on one page but rather have page per repo."

Both are structural. **A overrules §2, Removed §3–4, round 5.7 and round 7.1/7.11's bar clauses.
B overrules §1's disclosure, round 7.6, and the §7(a) "row is also a toggle" mechanism on the
index.** Everything else in rounds 4–9 stands.

---

## A. THE BAR COMES BACK, AND IT ALWAYS DRAWS

### A.1 What was actually lost, measured on the baseline

`/tmp/claude/rev6/base/list-1440.png`: the page draws **zero bars**. Both hero cards are at full
coverage (`6 of 6 places`, `9 of 9 places`) so §2 omits them; `Also still running` has 0 builds; `No
longer running anywhere` (10 builds) and `Never deployed` (24 builds) were never given one. On the
build page (`detail-1440.png`) the head band's `.rev-build-bar` is gated on `liveCount > 0 &&
liveCount < totalCount`, which is false at `6 of 6`. **The bar is a conditional that is false on
every row this fleet has.** §2's reasoning ("the count already said so") was right about
*redundancy* and wrong about *comparability*: `REVISION-PAGES.md` criterion 2 is "how far did each
one get — comparable down the column", and a column of nothing compares nothing.

### A.2 The ruling

**The bar draws on every build, always, including 0 % and 100 %.** It is `CoverageBar`, cellular,
one cell per place. It carries ONE quantity — *places this build has reached* — in ONE hue at two
weights, on a neutral track.

| weight | cells | meaning |
|---|---|---|
| **here** (solid) | `live` + `failing` + `deploying` | the build is on this place right now |
| **movedOn** (tint) | `ahead` | this place has moved past this build |
| **notReached** (track) | `notYet` | the build has not got here |
| **unplaceable** (hollow) | `unplaceable` | no comparison exists; counted in the denominator only |

**This is not a two-tone bar and the distinction is load-bearing.** The human's rejection (three
times, most recently 2026-09-03: *"Revisions pages bars are still split into 2"*) was of a bar
carrying **two hues = two quantities**, read as two objects. Here there is one hue and one
quantity; the tint is a *depth* within it, exactly as `here`'s own light/dark pair is. One
continuous bar, one radius, one clip, the same 1–2px gutter between every cell whether or not the
weight changes at that gutter — **no group gutter, ever** (the 8px gutter is what made the old bar
read as two objects and it stays deleted).

**Where I had to choose.** "Passed by" is not knowable from the data. `ahead` means *this place is
running a newer build*; nothing in `RevisionSlot` records whether this build ever ran there. So the
tint is worded **"moved past"/"moved on"** — a claim about the place — and never **"ran it
before"** — a claim about the build. The human's own phrase ("passed by") is the place-centric one,
so this is their reading, not a compromise. Flagged to the tech lead all the same.

### A.3 The fill table — one hue, three weights

Replaces `COVERAGE_FILL`'s per-bucket table **for the bar only**. `COVERAGE_SWATCH` and the six
bucket cards on the build page are untouched.

| weight | light | dark | provenance |
|---|---|---|---|
| `here` | `bg-green-700` | `dark:bg-green-600` | `COVERAGE_FILL.live`'s exact pair. Zero new values. |
| `movedOn` | `bg-green-300` | `dark:bg-green-800` | same hue, one weight down. NEW pair, and the only new values in this round. |
| `notReached` | `bg-gray-200` | `dark:bg-gray-700` | the pair the three shipped painted tracks (`.single-bar`, `.bld-fill-track`, `.rev-build-bar`) already use. |
| `unplaceable` | `bg-transparent border border-gray-400` | `dark:border-gray-500` | unchanged. |

Ordered by **contrast against the ground**, not by raw lightness, so the ladder reads the same in
both themes: light `L_ok 0.928 → 0.871 → 0.527`, dark `0.373 → 0.448 → 0.696`. Monotonic in both.

⛔ **`COVERAGE_FILL.notYet`'s `dark:border dark:border-gray-600 dark:bg-gray-800` hack is deleted.**
It existed only because `gray-800` IS `Card`'s dark ground (dE00 0.0, measured 2026-09-02). On
`gray-700` the cell has its own edge, so the conditional border goes and the bar and the three
painted tracks converge on one spelling. **Red never enters the bar** (§2, unchanged): a `failing`
place is running this build, so it takes `here`, and `Chip role="adverse" label="FAILING"` beside
the count carries the adversity. **Blue never enters the bar** (round 7.11, unchanged): a
`deploying` place takes `here`, and the word carries it.

**The one accessibility risk, and its pre-decided fallback.** In light theme `movedOn`
(`green-300`, `L_ok 0.871`) and `notReached` (`gray-200`, `L_ok 0.928`) separate mostly by chroma;
under a deuteranopia simulation they fall back to 5.7 L-units. **If the implementing lane measures
light-theme `movedOn` vs `notReached` under deuteranopia at dE00 < 3, step `movedOn` to
`green-400`** (`L_ok 0.792`) and leave dark alone. Do not invent a third option.

### A.4 Geometry

`CoverageBar`'s existing two scales, one value changed:

| scale | height | radius | cell min | gutter | used by |
|---|---|---|---|---|---|
| default (`compact={false}`) | **16px** (was 26) | 8 | 5px | 2px | list hero, build-page head band |
| `compact` | 8px | 4 | 3px | 1px | every `.bld-row` |

16 : 8 is exactly 2 : 1 — the same object at two scales, which is `CoverageBar`'s founding rule.
26px was sized for a hero body that no longer exists (round 7.1); 16px is a spacing token, radius 8
is a radius token, and `16 ≥ 2 × 8` so the radius still reads as a radius rather than a pill.
`CELL_MAX = 32` and the proportional-only fallback above it are unchanged.

### A.5 The segment keys — a NEW type, `CoverageKey` untouched

`CoverageKey` is the **bucket-card** vocabulary on the build page and must not fork. So the answer
to "do `'live' | 'past' | 'notYet'` map straight on" is **no** — add a second, smaller type used
only by the bar, in `revision-coverage.ts`:

```ts
export type CoverageWeight = 'here' | 'movedOn' | 'notReached' | 'unplaceable';
export const WEIGHT_ORDER: CoverageWeight[] = ['here', 'movedOn', 'notReached', 'unplaceable'];
export function coverageWeight(key: CoverageKey): CoverageWeight;   // live|failing|deploying→here, ahead→movedOn, notYet→notReached, unplaceable→unplaceable
export const WEIGHT_FILL: Record<CoverageWeight, string>;           // the A.3 table
export function weightFill(w: CoverageWeight): string;
export function coverageBarSegments(cov: RevisionCoverage): CoverageSegment[]; // exactly 4 entries, WEIGHT_ORDER, zero counts included
export function coverageBarLabel(cov: RevisionCoverage, short: string): string; // A.7
export function coverageCounts(cov: RevisionCoverage): { here; deploying; movedOn; notReached; unplaceable; total };
```

`CoverageSegment.key` becomes `CoverageWeight`; `CoverageBar` calls `weightFill(seg.key)` instead of
`coverageFill(seg.key)`. **`coverageSegments()` is deleted** along with its two dead call sites (the
unused `CoverageBar` import in `routes/revisions/+page.svelte`, and `RevisionLead`'s
`barPercent === undefined` branch, which nothing reaches). `coverageFill` / `COVERAGE_FILL` /
`COVERAGE_SWATCH` survive for the build page's bucket cards and swatches, unchanged.

### A.6 Where the count sits, per composition

§2's rule is "the count sits directly above the bar". Held/failing/behind stay in chips and words
and never enter the bar.

**1. `.bld-row` rollup column** (every row in *Also still running*, *No longer running anywhere*,
*Never deployed*), line a → line b, unchanged tracks:

```
line a   {here} of {total} running · {deploying} deploying · {movedOn} moved on     t-dense, right
line b   ▓▓▓▓▓░░░░                                                        8px bar, mt-6, right
line c   Deployed 1d ago / Last deployed 5d ago / Built 7d ago            t-micro, right
```
Clauses 2 and 3 omit at zero; clause 1 always draws, including `0 of 9 running`. Below
`@container (max-width: 560px)` line a wraps and the bar goes full width — the existing rule,
unchanged.

This is the round's biggest visible gain and it is free: the 200px `.bld-roll` column on *No longer
running anywhere* and *Never deployed* is empty today. A never-deployed build now reads its own
future off the bar — **all track** = "nowhere yet, and it is still a candidate"; **all tint** =
"every place is already past it, it will never land". The page cannot say that today at all.

**2. List hero (`RevisionLead`, `compact`).** The card header keeps the verdict rollup, hard-right,
and the body never restates it (round 5.7's half that survives). The body is:

```
[BuildStateMark word]                                     t-dense, left, only when state.key !== 'done'
[16px bar, full width, mt-2]
```
`p-4`. At full coverage that is a 48px body containing nothing but the bar — which is the point.
**Round 7.1 ("a hero with no shortfall is a row") is overruled for the bar and only for the bar**:
its complaint was that the 24px sha body was "the largest and least informative ink on the page",
and that body stays deleted. The hero body does not reprint the sha.

**3. Build-page head band.** Under the existing figure line, full width, `mt-3`, 16px bar. Replaces
`.rev-build-bar`/`.rev-build-bar-fill` and its `liveCount > 0 && liveCount < totalCount` gate.

**4. Repository page head band** (B.4): no bar. Coverage is a property of a build, not of a repo.

**5. The `/revisions` index repository card: NO BAR.** Same reason. This is the obvious wrong move
and it is ruled out here so nobody makes it.

**6. `/apps`, `/apps/<name>`, `/environments`: unchanged.** Audited — `CoverageBar` has exactly two
import sites and both are on the revision pages. `/apps/[name]`'s `ExposureBar` is a different
object (ready pods) on shared `.prop-bar` geometry and is out of scope.

### A.7 Rollup and aria copy

Rollup clauses, hard-right, `t-card-rollup`, in this order, each omitted at zero:

```
{here} of {total} places · {deploying} deploying · {movedOn} moved on · {release} held
```

One aria/`title` sentence, from `coverageBarLabel()`, identical at both scales:

```
Across 9 places: 4 running 9f10e49, 1 deploying it, 2 have moved past it, 2 not reached yet.
```
- Every clause omits at zero; `not reached yet` is the remainder and prints whenever it is > 0.
- `unplaceable > 0` appends `, 1 on a different release line`.
- All of here/deploying/movedOn zero → `Across 9 places: none is running 9f10e49 yet.`
- Per-group `title` on the cells: `4 running this build` / `2 have moved past this build` /
  `2 not reached yet` / `1 on a different release line`.

---

## B. ONE PAGE PER REPOSITORY

### B.1 URLs

| URL | page |
|---|---|
| `/revisions` | **index** — one repository card per repo, no expansion |
| `/revisions/<repoSlug>` | **repository page** — e.g. `/revisions/github.com/littlechimera/kuberik-testing` |
| `/revisions/<repoSlug>/<key>` | **build page** — unchanged in kind |

`repoSlug` is `version-utils.ts`'s existing `repoSlug(repoKey)`; nothing new is invented.
**Resolution order in `[...slug]`: match the WHOLE slug against `repoBody(l.repoKey)` first → repo
page; otherwise pop the last segment as the build key → build page; otherwise not-found.** Repo
first, because a repo's last path segment is never a 12-char hex slug in practice and the order has
to be deterministic. Mechanics are the frontend IC's; the order is not.

### B.2 The index card — enough to answer "is anything held or behind here" without opening

It is §1's repository card with the disclosure removed. From top:

- **Header, 47px** (`px-4 py-3`, bottom hairline). The WHOLE header is an `<a href="/revisions/
  <repoSlug>{?q}">`, hover `bg-gray-50 / dark:bg-gray-700/40` — "a region that reads as a
  destination must BE one". Left: `CodeBranchOutline` 16px, gap 10, `repoTitle(repo.repoLabel)` at
  `t-card-title`, `break-words`. Right, via the header's own `justify-between`: the verdict, then
  `ChevronRightOutline` 16px `text-gray-400`.
  - ⛔ The chevron **moves from left to right and stops meaning "expand"**. Round 7.6 (*"the
    repository header is the toggle"*) is overruled: there is no toggle. The `36 builds ⌄` pill is
    deleted; its figure already lives in the meta line.
- **The verdict rollup**, `t-card-rollup`, first that applies:
  1. held > 0 → `Chip role="alarm" label="{n} held" wide` + `{n} places held`
  2. places behind their newest allowed build > 0 → `{n} places behind`
  3. newer undeployed builds > 0 → `{n} newer builds`
  4. → `Everything on its newest build`
  This is round 7.5's "the head band is the verdict" applied to a card, and it is what makes a
  stack of repos scannable without opening one.
- **Body: the service ledger** (§7a), unchanged grammar — name, sha, rank chip, state chips, env
  chips, right-aligned age. Capped at **6 rows** + the `Show N more services` snippet, **except at
  `ledgers.length === 1`, where every row draws** (B.7).
  - ⛔ **The ledger rows are NOT filter toggles on the index.** There is nothing on this page to
    filter to. §7(a)'s `aria-pressed` row and the fallback pill strip both move to the repository
    page. This deletes §1's own "a row that is also a toggle" risk from the index entirely.
- **Footer**: hairline, then `t-micro text-gray-500` `px-4 py-2`:
  `36 builds · 12 deployed at least once · 15 places to deploy to · across 2 release lines`,
  with `View repository ↗` (`.nav-link`, `ArrowUpRightFromSquareOutline`, `title={repo.repoLabel}`,
  external) hard-right on the same row. It is a separate `<a>` inside the header link's card, so it
  sits in the FOOTER, not the header — one control per destination, no nested anchors.
- **No held banner on the index.** The banner (cause, contract clause, rule, action) is the
  repository page's, under its ledger card, never collapsible (round 7.3, unchanged — only its
  address moves). The hold stays findable from the index by the header's `{n} HELD` alarm chip and
  by the `HELD` chip on the ledger row, both inside the card link: one tap to the banner.
- **No bar** (A.6.5), no hero, no build lists.

Head band on the index is unchanged: `3` `3 held · every other place on its newest build ·
2 repositories · live`.

### B.3 What the index costs, and what it buys

Repo A's expanded block is ~1500px at 390 and ~1250px at 1440. The index is head band + search +
two cards ≈ **~700px at 390, ~640px at 1440**, against today's 2719 / 1952. Nothing an operator
scans for on the index (held, behind, who runs what, when) leaves the card.

### B.4 The repository page

Order, top to bottom:

1. **Breadcrumb**, y=24, `t-dense text-gray-500`: `All revisions` (`.nav-link` → `/revisions{?q}`).
   No arrow glyph, no `.btn` — "no action-styled navigation". The build page's trail becomes
   `All revisions › kuberik-testing`, separator `ChevronRightOutline` 12px `text-gray-400`, the
   repo item linking to `/revisions/<repoSlug>{?q}`. The current object is never in its own trail —
   the head band names it. At 390 the trail wraps; the repo name truncates with the full label in
   `title`.
2. **Head band — the verdict, with the object's name on it.** `mb-5`, first content at y=72,
   the existing rhythm:
   ```
   kuberik-testing   3   places held · every other place on its newest build · live
   ```
   `repoTitle(repoLabel)` at `t-display` and it is the page's real `<h1>` (not `sr-only`: the
   navbar prints the ROUTE name `Revisions`, so the repo name is not a duplicate — the rule the
   `sr-only h1` exists for does not bite here). The figure at `t-display`, the sentence at `t-dense`
   on its baseline. Same clause set as the index band with `· N repositories` dropped.
   ⛔ **No repository CARD on this page.** Its header would restate the name and its rollup would
   restate the verdict, 24px apart. The card is an INDEX object.
3. **Search field**, `w-full` at 390 / `max-w-sm` from 640, scoped to this repo, same matcher,
   same `placeholder="Find a build or service"`, same clear/Escape. Bound to `?q=`.
4. **The ledger, as its own card.** `Card`, radius 8, `icon={CodeBranchOutline}`, title
   **`What each service runs`** (the operator's question, and the sibling of the build page's
   `What each service calls it`), rollup `5 services`. Body: the §7(a) ledger, uncapped. Footer
   hairline + the meta line + `View repository ↗` hard-right, exactly as B.2's footer.
   **The ledger rows ARE the multi-select filter here** (§7a's `aria-pressed` row, gray-900 /
   gray-100 pressed fill, `aria-label="Show only {appName}"`, view state only, not remembered).
5. **Held banner**, filled `AlertPanel`, under the ledger card, never collapsible, whenever the hold
   exists (round 7.3, unchanged).
6. **Hero card(s)**, one per release line, with A.6.2's body.
7. **`.rev-cols`**: main column `Also still running` + `No longer running anywhere`, 340px rail
   `Never deployed`. `@container (min-width: 860px)` — the product's one rail number, unchanged.

### B.5 `?q=` at each level

| level | behaviour |
|---|---|
| index | filters across every repo, as today. A repo with no match keeps its card and prints `No build matches “{q}”.` (`t-body text-gray-500`, `px-4 py-6`, flush left per round 7.7) in place of its ledger; its rollup reads `0 of 36 builds`. Under a filter every rollup reads `{n} of {m} builds` (round 5.6). `singleSearchMatch`'s direct link under the field survives. Every card header link carries `?q=` through. |
| repository | filters within the repo; identical matcher; identical counts-follow-the-filter rule; a zero-result query keeps the verdict (round 9.6). Breadcrumb carries `?q=` back to the index. |
| build | ignored, but carried in the breadcrumb's two links so the round trip preserves it. |

### B.6 Landmark orders (pin these)

`routes/revisions/page.svelte.test.ts` — index, one repo:
```
['Revisions', 'repo-a']
```
index, two repos:
```
['Revisions', 'repo-a', 'repo-b']
```
`'Revisions'` stays the `sr-only h1`. Every build-list heading leaves this file; the test comment
must record that they moved to `/revisions/<repoSlug>` in this round.

New `routes/revisions/[...slug]/repo.svelte.test.ts` — repository page:
```
['kuberik-testing', 'What each service runs', /^Newest build ·/, 'Also still running',
 'No longer running anywhere', 'Never deployed']
```
The repo name is now a visible `h1`. `Also still running` keeps its existing
`lead ? … : 'Still running'` conditional.

`routes/revisions/[...slug]/deploying.svelte.test.ts` — build page, unchanged.

### B.7 One repository: SHOW THE CARD, do not redirect

**Decision: `/revisions` always renders, even with one repository.** Three reasons, in order:

1. **Navigation must be stable.** A redirect makes `/revisions` a URL that never renders — the nav
   entry, a bookmark and every `All revisions` breadcrumb land somewhere the operator did not type.
   And the destination would silently change the day a second repo appears, which this fleet has
   already demonstrated once (`kuberik-testing-second`).
2. **The index owns a verdict nobody else has.** Its head band is the FLEET verdict; redirecting
   deletes it for exactly the installs most likely to be single-repo.
3. It is a reduction dressed as a convenience — one click saved, one page's worth of design gone.

**The concession that pays for the click:** at `ledgers.length === 1` the head band drops
`· 1 repository` (it says nothing) and the card's ledger is **uncapped** — every service row draws,
no `Show N more services`. A single-repo operator therefore sees their whole fleet ledger, the
verdict and the held chip on the index without opening anything. The card is the page's only
object, so the target is unmissable.

### B.8 Skeleton shape hints (`rememberShape`, indices never keys)

| page | key | shape |
|---|---|---|
| index | `'revisions'` | `{ repos: number, services: string }` — `services` is the comma-joined per-repo ledger row count (`"5,2"`). **`open` is deleted**: nothing expands. |
| repository | `'revisions/repo'` | `{ services, heroes, heldBanner, running, retired, pending }` — all counts/booleans, capped at the number of rows actually reserved (`min(n, 5)`). |
| build | unchanged | unchanged |

ONE key for every repository page, not one per repo: a per-repo key would put fleet data in the
storage key, which `skeleton-hints.ts` forbids. Across repos the hint is an approximation — that is
what a hint is, and the flip test only requires that nothing MOVES on a repeat visit to the same
page.

**Reserve, index:** head band (28px) → search field (36px, disabled, real geometry) → `repos` cards,
each 47px header + `services[i]` ledger rows (fallback 3) at 26px + a 53px meta bar. No hero, no
`.rev-cols`, no banner block — the index has none of them, and reserving them was the old skeleton's
job.
**Reserve, repository:** breadcrumb (18px) → head band (28px) → search (36px) → ledger card
(47 + services × 26 + 53) → `heldBanner ? BannerSkeleton(122 / 162 mobile) : nothing` →
`heroes ×` 47px header + 48px bar body → `.rev-cols` block sized from `running` / `retired` /
`pending`. Flip test: nothing may move.

### B.9 States

- **Index, empty fleet** — `Nothing built yet` + its sentence, unchanged.
- **Index, error** — `ErrorState`, unchanged.
- **Index, `?q=` matches nothing anywhere** — every card stays, each printing its own
  `No build matches “{q}”.`; nothing is hidden silently.
- **Repository page, unknown slug** — the existing not-found state, reworded for the object that is
  missing: `No repository <code>{slug}</code> is known to this dashboard.` + the `All revisions`
  breadcrumb. Never one glued string (the existing rule).
- **Repository page, error** — `ErrorState` with `backHref="/revisions"`, `backLabel="All
  revisions"`.
- **Repository with no deployed build** — no hero, no running/retired cards; every ledger row reads
  `Not deployed`; the rail shows `Never deployed` only; every bar on it is all-track or all-tint,
  which is now the page's clearest statement of that state.
- **Repository with everything deployed** — `Never deployed` still renders, `0 builds` rollup, its
  honest empty sentence. The rail is part of the layout.

### B.10 Breakpoints — container queries only, unchanged

| rule | threshold | effect |
|---|---|---|
| `.rev-cols` | `@container (min-width: 860px)` | main + 340px rail (repository page only) |
| `.bld-row` | `@container (max-width: 560px)` | two-band row; bar full width |
| ledger row | `@container (max-width: 560px)` | name / sha+rank / env chips stack, 4px row gap |
| index card header | `@container (max-width: 560px)` | rollup wraps to its own line, flush left (`Card`'s single-item rule) |

---

## Lanes

Three lanes, split by file ownership. **No two lanes name the same file.** Order: L1 and L2 may run
in parallel (they share no file; L2 consumes names L1 exports, pinned in A.5). L3 consumes the
components L2 creates, so it starts once L2's component props are committed — a sequencing
dependency, not a shared file.

### Lane 1 — THE BAR (view-model + shared components)

**Owns:** `frontend/src/lib/view-models/revision-coverage.ts`,
`frontend/src/lib/components/CoverageBar.svelte`,
`frontend/src/lib/components/RevisionLead.svelte`,
`frontend/src/lib/view-models/revision-coverage.test.ts` (new).

Implements A.2–A.7: `CoverageWeight`, `WEIGHT_ORDER`, `coverageWeight`, `WEIGHT_FILL`,
`weightFill`, `coverageBarSegments`, `coverageBarLabel`, `coverageCounts`; deletes
`coverageSegments` and `COVERAGE_FILL.notYet`'s dark-border hack; `CoverageBar` height 26 → 16 and
`weightFill`; `RevisionLead`'s always-drawn bar body, `barPercent`/`hideBar` props deleted.

**Acceptance**
- `coverageBarSegments` returns 4 entries in `WEIGHT_ORDER` for every fixture, and
  `Σ count === cov.totalCount` — assert on a 0 %, a 100 %, a mixed, and an all-`ahead` fixture.
- `coverageBarLabel` at 0 %, at 100 %, with `deploying > 0`, with `unplaceable > 0`.
- No `blue-`, `red-`, `amber-` or `yellow-` value reachable from `WEIGHT_FILL`.
- `CoverageBar` renders `total` cells at `total ≤ 32` and one segment per weight above it.
- Canvas-measured dE00 in BOTH themes, on `Card`'s own ground: `here` vs `movedOn`, `movedOn` vs
  `notReached`, `notReached` vs ground — all ≥ 3. Plus the deuteranopia check in A.3 with its
  named `green-400` fallback.
- `pnpm test` green; `rg 'coverageSegments|barPercent|hideBar' frontend/src` returns nothing.

### Lane 2 — THE INDEX, and the components the repository page needs

**Owns:** `frontend/src/routes/revisions/+page.svelte`,
`frontend/src/routes/revisions/page.svelte.test.ts`,
and creates `frontend/src/lib/components/RepoLedgerCard.svelte`,
`frontend/src/lib/components/BuildRow.svelte`,
`frontend/src/lib/components/BuildLists.svelte` (new files, Lane 2's).

Implements B.2, B.3, B.5 (index), B.6 (index landmarks), B.7, B.8 (index), B.9 (index),
B.10 (index card header). Extracts the ledger, the `.bld-row` grammar and the three build lists +
`.rev-cols` out of the route and into the three new components **before** deleting them from the
route, so Lane 3 has something to import. Publishes those components' props in the PR body.

**Acceptance**
- `/revisions` at 1440 and 390, both themes: one card per repo, no hero, no build lists, no banner,
  no bar. Height ≤ 800px at 390 with two repos.
- Card header is one `<a>` to `/revisions/<repoSlug>`; `View repository` is a separate `<a>` in the
  footer; no nested anchors (`rg '<a[^>]*>[^<]*<a'` and a DOM assertion).
- Held repo: alarm chip + `{n} places held` in the header rollup; unheld repo: rule 2/3/4's string.
- `?q=` filters across repos; a no-match repo keeps its card with `No build matches “{q}”.`; each
  header link carries `?q=` through.
- One repo: landmark order `['Revisions', 'repo-a']`; ledger uncapped; head band has no
  `· 1 repository`.
- Skeleton flip test at 1440 and 390: nothing moves between skeleton and loaded.
- `pnpm test` green.

### Lane 3 — THE REPOSITORY PAGE and the build page

**Owns:** `frontend/src/routes/revisions/[...slug]/+page.svelte`,
`frontend/src/routes/revisions/[...slug]/deploying.svelte.test.ts`,
`frontend/src/routes/revisions/[...slug]/repo.svelte.test.ts` (new).

Implements B.1 (resolution order), B.4, B.5 (repository + build), B.6 (repo landmarks), B.8
(repository reserve), B.9 (repository states), B.10, and A.6.3 (the build-page head-band bar,
replacing `.rev-build-bar`).

**Acceptance**
- `/revisions/github.com/littlechimera/kuberik-testing` renders head band → search → ledger card →
  banner → heroes → `.rev-cols`, at 1440 and 390, both themes.
- Landmark order matches B.6 exactly.
- A slug that is a known repo resolves to the repository page; the same slug plus a build key
  resolves to the build page; an unknown slug gets the reworded not-found.
- Breadcrumbs: repo page `All revisions`; build page `All revisions › kuberik-testing`; both carry
  `?q=`.
- Every `.bld-row` in all three lists draws an 8px bar, including a never-deployed row (all track)
  and a no-longer-running row (all tint) — screenshot both.
- Build-page head band draws the 16px bar at `6 of 6`; `rg 'rev-build-bar' frontend/src` returns
  nothing.
- Skeleton flip test at 1440 and 390.
- `pnpm test` green.

## Round 11 outcomes (2026-09-09, after three critic passes and eight lanes)

Rulings that landed differently from the section above, each measured live:

- **Bar cells are capped**, not stretched: ≈36px per cell with a 2px gutter, so a 3-place bar
  is visibly shorter than a 9-place one (6 places ≈ 226px at 1440). A `width: fit-content`
  attempt collapsed to 40px in Chromium (nested-flex intrinsic sizing); the width is computed.
- **`movedOn` is a greyed green, not a fresh mint** (light `oklch(82% 0.07 154)`, dark
  `green-100`): the "No longer running anywhere" wall of tint read healthier than "running".
  Measured: light dE00 here/movedOn 29.7, movedOn/ground 23.2; dark ΔL here/movedOn 0.33,
  movedOn/ground 0.68; deuteranopia sim movedOn/notReached 13.3.
- **Cells are addressable**: `CoverageBar` takes `cells` (`coverageCells()`: dev → staging →
  prod, then service) with a title per place; the held chip sits on the count line, never
  alone under the bar. The hero header rollup carries the held fact only; the count is said
  once, directly above the bar.
- **Below `sm` the held banner precedes the ledger card** (container-query reorder), so the
  blocking fact is first on a phone. The banner shares the cards' edges at every width.
- **One ledger**: `RepoLedgerCard` on both pages (standard Card, 8px, 47px header);
  `filterable` on the repository page turns names into toggles (plain at rest, bordered on
  hover, filled when pressed). Grid: name `minmax(170px, max-content)`, chips
  `minmax(200px, max-content)`, envs, a `1fr` spacer, age; 16px insets; sibling cards share one
  chip x; stacked fallback under a 768px container so a 1024 laptop keeps the grid.
- **Rows say what runs first**: `1 BEHIND│2.66.0-66` then `HELD│2.67.0-67`; a held label whose
  revision is the row's own says "this same build under a newer label".
- **The banner's constraint is the gate's** (`api ^1.67.0`, from `blocking-story.ts`), said
  once with the order; rule names on a muted `t-micro` line; "rolled back to" where dev did;
  no "waiting" when no candidate can pass.
- **`?q=` recounts**: index head band, card rollups and rows share one matcher (service name,
  label, sha); every number on a filtered repository page is computed on the matching services.
- **"Never deployed" is claimed only when history was checked** (`historyLimit.checked`);
  otherwise "No deploy on record" with the window footnote.
- **The palette finds builds** by sha prefix or label and pages by name; a rolled-back commit's
  two ledger rows carry distinct keys.
- Copy: "Open on GitHub ↗" for the external link; "Repositories and their builds" in ⌘K.

Deferred, product-wide or standing rules: inner-scrolling `<main>` at `sm+`; `t-dense` 12.5px /
`t-code-sm` 11.5px roles; amber `1 BEHIND`; `bannerTitle` dead code; env-column budget
(145px each) on the build page re-measure for a 4+ environment fleet.
