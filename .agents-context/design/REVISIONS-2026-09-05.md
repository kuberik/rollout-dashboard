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
