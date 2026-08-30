# Rollout Dashboard — design constraints & open issues

Running log of user feedback. Each item is either **enforced** (already
landed and must stay landed) or **open** (still to address). Before
making any UI change, re-read this file and check whether the change
violates an enforced item.

## Before you run the tests: the paraglide hazard

`vitest` (and `npm run build`, and starting Vite) triggers a paraglide compile, and a
paraglide compile **fetches its message-format plugin from `cdn.jsdelivr.net` at build
time**. That host is not on the agent sandbox's network allowlist, so inside the sandbox the
fetch fails, paraglide reports success having compiled ZERO messages, and it overwrites the
gitignored `src/lib/paraglide/messages/en.js` with an **18-byte stub** — which silently
empties every string in the running dev server on 5173.

It is **not** a Node version problem. "Run it under Node 22" was the diagnosis for weeks and
it never worked, because the Node version was never the mechanism.

Run anything that compiles with the sandbox disabled, or hand the test run to the human.
Healthy `en.js` is **160 bytes**. Full write-up in
`.agents-context/ENVIRONMENT.md`.

## ⛔ "N BEHIND" HAS ONE DEFINITION NOW, AND THE OLD ONE MADE A PAGE CONTRADICT ITSELF (2026-08-30)

> Measured on the live hub, `hello-world-app`, cluster fully settled, nothing deploying:
>
> ```
> /rollouts     dev −15 991829b │ staging  newest 991829b │ prod −19 51b976a
> /apps/[name]  19 behind       │ 19 behind               │ 24 behind
> ```
>
> **dev and staging run the IDENTICAL build `991829b`, on the same page, in adjacent rows —
> one said `−15`, the other said `newest`.** That is not two defensible definitions
> disagreeing. That is one page contradicting itself.

### THE DEFINITION, AND THE ARGUMENT FOR IT

**`N behind` = the rank of the build an environment is RUNNING on its APP'S BUILD LADDER** —
the union, across every environment of that app, of every rollout's `availableReleases` plus
every build any of them has actually deployed, ordered newest-first by release creation time.
That is `view-models/build-ladder.ts`, read through `view-models/env-rank.ts`. **One
derivation, one module, and every surface reads it.**

Three denominators were defensible and the codebase was silently mixing them. On
`hello-world-app`:

| | dev `991829b` | staging `991829b` | prod `51b976a` |
|---|---|---|---|
| **1. this rollout's own `availableReleases`** | 15 | **14** | 19 |
| **2. the app's ladder (union) — CHOSEN** | **19** | **19** | **24** |
| **3. every build the repo produced** | unresolvable | unresolvable | unresolvable |

**(1) THE ROLLOUT'S OWN LIST LOSES, AND ITS OWN NUMBERS ARE THE PROOF.** It is a real
quantity — *"what could this rollout deploy next"* — and the product still prints it, as
`N versions waiting to move` and `15 newer versions ready`. It cannot be the RANK, because it
is **not a property of the build**: dev and staging run one sha and their own lists answer 15
and 14, because each rollout's gates and retention admit a different subset. Put that in a
chip attached to a sha and the same sha carries two numbers on adjacent rows. **A person
cannot act on a number that moves when a DIFFERENT rollout's window rolls.** This is the same
argument that ruled out the hop lag in 2026-08-23, applied one level down.

**(2) THE LADDER WINS, AND IT EXPLAINS THE ASYMMETRY RATHER THAN HIDING IT.** dev publishes
16 releases, staging 15, prod 20 — the asymmetry the brief called out as real data. Those are
**not three ladders; they are three WINDOWS onto one ladder of 25 builds.** The union is the
app's history; each rollout's list is a view of it. That is exactly why the union answers
*"how old is the code running here"* and each rollout's own list answers *"what can move next"*
— two questions, two numbers, and neither is now spelled in the other's words. It is also the
only candidate that is per-APP and shared, which `/apps` and `/environments` require: those
pages RANK ENVIRONMENTS AGAINST EACH OTHER, and a ranking needs one denominator or it is not
a ranking.

**(3) REPO-WIDE LOSES.** `/versions` groups by repo and apps that share a source repo ship
independent streams — `hello-world-app` and `hello-multi-app` are both built out of
`kuberik-testing` and are 19 and 0 behind respectively. Ranking one against the other's builds
is a comparison that cannot be resolved, and this file's own rule is that those print
`unknown`.

### THE MECHANISM — TWO BUGS IN ONE FUNCTION

`rollout-cards.ts::computeBehind`, which fed `/` and `/rollouts` and nothing else:

1. **It counted against the rollout's own `availableReleases`**, so dev printed `−15` where
   staging would have printed `−14` for one build.
2. **Worse: when it could not answer it returned `null`, and both call sites rendered `null`
   as the word `newest`.** staging fell into exactly that hole — `compareRollouts` went silent
   (no history overlap) and no peer had a smaller own-list count. **The card's most confident
   word was rendered from its least confident state.** `ControlCenter`'s
   `(behind?.behindBy ?? 0) === 0` did the same thing one level up and filed a
   nineteen-builds-behind staging under **Steady**.

`computeBehind` still exists and **no longer measures anything** — it names a peer.
`behind.behindBy` is overwritten from the ladder rank so the two cannot disagree.

### `rankLabel` IS TOTAL NOW, AND THAT IS THE STRUCTURAL FIX

It used to return `null` for `unknown`, which **invited every call site to spell its own
fallback** — and four of them fell through to `newest`. A `null` return is a branch waiting to
go wrong. Every verdict has a word now:

| verdict | label | `Chip` role |
|---|---|---|
| `newest` | `newest` | `newest` (`head` where a page argues per-row repetition) |
| `behind` | **`N behind`** | `rank` |
| `diverged` | `unreleased` | `diverged` |
| `unknown` | **`unknown`** | `unranked` |

`rankRole` is total for the same reason, and `rankTitle` writes the tooltip so the three pages
that had hand-rolled one now share a voice.

### ⛔ `−N` IS GONE FROM EVERY CHIP IN THE PRODUCT

The debt this file logged on 2026-08-30 (*"`/` AND `/rollouts` STILL PRINT `−N`, AND THAT IS A
KNOWN, DELIBERATE SPLIT"*) is closed, and two more call sites nobody had logged went with it:

| call site | was | now |
|---|---|---|
| `RolloutGrid.svelte` (`/rollouts`) | `−15` / `newest` | `19 behind` |
| `ControlCenter.svelte` (`/`), Trailing + Steady | `−N` / `newest` | `N behind` |
| `versions/[...slug]` stage chips | `−19` | `19 behind` |
| `revision-ledger.ts::rankSentence` | `−1` | `1 behind` |

**The one `−N` left in the product is deliberate:** `/apps/[name]`'s 24px `tk-glyph` in the
gap column. It is a **display-id glyph in a fixed-width grid track**, not a chip — `19 behind`
at 24px would be a layout change, which this pass explicitly was not. Its `title` already
reads `19 builds behind the newest`. Logged, not hidden.

### THE COST, MEASURED — `wide` IS REQUIRED, IT IS NOT A PREFERENCE

`19 BEHIND` at the chip's uppercase tracking exceeds `.chip`'s 12ch cap and rendered
**`19 BEHI…`** on `/` and `/rollouts`. A truncated label is not a word, so both call sites take
`wide` — **the same opt-out `/environments` and `/envs/*` already use for this exact
string**, and the only sanctioned way to lift the cap. Measured after, at 1440 and 390, both
themes: `scrollWidth === clientWidth`, and **0 clipped chips of 22 on `/` and 33 on
`/rollouts`**.

⚠️ **It costs ~35px on the badge, and one row pays for it.** On `/` at 1440 the Trailing card
for `hello-world-prod` carries THREE chips (`PROD` + a new `ROLLED BACK` + the rank badge) in a
400px track and now ellipsises its name to `hello…`. The other two Trailing cards, which carry
two chips, do not truncate. The rank badge alone does not cause it; the third chip does.

### ⛔ A PINNED ROLLOUT NOW SHOWS ITS RANK ON `/` AND `/rollouts`

`computeBehind` returned `null` for anything with a `spec.wantedVersion`, and `null` rendered
as `newest`. So a rollout **pinned twenty-three builds back was the product's good-news word**
on the two pages the human uses most. A pin is a REASON a rollout is behind, not a reason it is
not, and `PinBadge` already sits beside the chip to name the cause — which is exactly what
`/apps` and `/apps/[name]` already did (*"the actual cause was the pin, which the page never
mentions"*). Confirmed live: `hello-multi-app` in prod was pinned to `aa17645` mid-pass and
`/rollouts`, `/apps/hello-multi-app` and `/environments` all print `23 behind`.

### THE BEFORE/AFTER, EVERY SURFACE, `hello-world-app` ON THE LIVE HUB

| surface | dev `991829b` | staging `991829b` | prod `51b976a` |
|---|---|---|---|
| `/` — **before** | `−15` (Trailing) | **`newest` (Steady)** | `−19` (Trailing) |
| `/` — after | `19 behind` | `19 behind` | `24 behind` — all three Trailing |
| `/rollouts` — **before** | `−15` | **`newest`** | `−19` |
| `/rollouts` — after | `19 behind` | `19 behind` | `24 behind` |
| `/apps` | `19` | `19` | `24` — unchanged |
| `/apps/[name]` | `19 behind` | `19 behind` | `24 behind` — unchanged |
| `/environments` | `19 behind` | `19 behind` | `24 behind` — unchanged |
| dependencies tab | `19 behind` | `19 behind` | `24 behind` — unchanged |
| `/versions/<rev>` — before | `−19` | `−19` | `−24` |
| `/versions/<rev>` — after | `19 behind` | `19 behind` | `24 behind` |
| API, own list | 15 | 14 | 19 — **still printed, as `N versions waiting to move`** |

`hello-multi-app` (converged) and `hello-api-app` / `hello-frontend-app` read `newest`
everywhere, before and after.

### ⚠️ A SECOND BUG THE LADDER WAS HIDING — IT UNDER-REPORTED BY 25

`buildLadder` ordered by `created`, then by *which environment is running it*. When **no**
rollout publishes `created` (a bare fixture, an app with no image policy wired, `orders-api`
in the mock) every `createdMs` is 0 and the env-order fallback ran alone — so a production
sitting at index 8 of its own 33-entry release list, with 24 entries **provably** newer,
ranked **1**, because dev happened to be running the only build above it.

**`availableReleases` array position is a signal the ladder was throwing away.** The list is
oldest-first by contract, so `len − 1 − idx` counts the builds a single rollout can prove are
newer. It sits directly under `created` and above env order.

⚠️ **It is the MAX across lists, not the MIN.** Two lists have different HEADS whenever one has
seen a release the other has not, so "distance from the end" is not on a common scale between
them. Taking the MIN lets a build near the end of a SHORT list jump above a build further from
the end of a LONG one — measured, it ranked `rel-5`, `rel-6` and `rel-7` as newer than the
build at index 8 of **the very list that contains all four**: a sort contradicting its own
input. The MAX is the most pessimistic proof, preserves each list's internal order, and where
two builds never co-occur in any list their relation is genuinely undetermined — **over-stating
a lag is the safe direction; under-stating one is what this whole pass exists to stop.** Live
data always carries `created`, so this never fires on the hub.

### THE TESTS THAT PIN IT

`view-models/rank-agreement.test.ts` — 14 tests, built on a synthesised copy of the live shape
(25 builds, three lists of 16 / 15 / 20). Every one fails on the old behaviour:

- **the dev-vs-staging contradiction, as one assertion** — two environments on the identical
  build get the identical verdict.
- no card prints `newest` when it is 19 behind; no card prints a label starting `−`.
- **shrinking a rollout's retention window 15 → 4 entries does not move its rank.**
- the card, the matrix cell and the ladder agree rollout by rollout; the fleet-wide door
  (`rankVerdictsByRollout`) agrees with the per-app one.
- Steady/Trailing split by verdict, not by a falsy number.
- every verdict formats to a non-empty word that is not `0`.
- **a fan-out fixture** — four prod regions on one build whose own lists say 6, 2, 4 and 1,
  and whose ladder rank is one number.

`env-rank.test.ts` and `rollout-cards.test.ts` were updated where they asserted the OLD
contract, and each change carries the reason inline. `rollout-cards.test.ts`'s aged-out
fixture moves **24 → 26**: 24 was prod's own-list count; the union additionally holds dev's
head and the build prod's list replaced.

## ⛔ DARK IS NOT A DERIVATION OF LIGHT — THE CONTRAST PASS (2026-08-30)

> *"some icons on the dark theme are black and therefore have poor visibility. i'm wondering
> what else you missed then."*

The second sentence was the assignment. **Every `<svg>`, every text node, every border and
every chip in `<main>` was measured against its REAL composited background** — canvas-resolved
(`ctx.fillStyle = c` then `getImageData`, never divided by alpha), the whole ancestor stack
composited, cumulative `opacity` folded in — on twelve pages × two themes × 1440 and 390.
**8,164 measured rows.**

### The three root causes, all of them systemic, none of them per-page

**1. THE PRODUCT HAD TWO SPELLINGS OF ITS MUTED INK AND ONLY THE MINORITY ONE FAILED.**
`text-gray-500 dark:text-gray-400` was already the majority token — **249 call sites**. A
minority of **99** spelled the same role one step fainter on each side
(`text-gray-400 dark:text-gray-500`, 82 sites; `text-gray-300 dark:text-gray-600`, 17), and
those are exactly the ones that fail:

| pair | light on white | dark on `gray-800` card | dark on `gray-900` page |
|---|---|---|---|
| `gray-300` / `gray-600` | **1.47** | **1.94** | **2.35** |
| `gray-400` / `gray-500` | **2.60** | **3.03** | 3.62 |
| `gray-500` / `gray-400` ✅ | **4.90** | **5.74** | **6.91** |

All 99 were collapsed onto the majority pair. It clears **4.5:1 for text and 3:1 for non-text
in both themes on both grounds**, and it removes `gray-300` and `gray-600` from the INK
vocabulary entirely (they stay as border/surface values). **Zero new colour values** — the
target pair was already the most-spent one in the product, including `Chip`'s own `NEUTRAL`
constant and `.chip-value--dim`. The hover partners moved with the base
(`hover:text-gray-600` → `-700`, `dark:hover:text-gray-300` → `-200`) so no hover state
collapsed onto its own resting colour. `placeholder-gray-400`/`dark:placeholder-gray-500`
took the same swap — there were two placeholder conventions and only one of them passed.

This is the SAME defect this file already recorded once, on the other side: *"the muted gray
pair was measured too dark once before (`text-gray-400` at 2.60:1 light)"*. It is one token,
and it is fixed once.

**2. ⛔ `tone-live` / `tone-mute` / `tone-bad` WERE DEAD CSS AND EVERY GLYPH RENDERED PURE
BLACK.** This is the bug the human saw, and the mechanism is a Svelte 5 rule, not a colour
choice. The three inks were declared in TWO `<style>` blocks — `BuildStateMark.svelte` and
`routes/versions/[...slug]/+page.svelte` — and applied to a `<Glyph>`, i.e. to a CHILD
COMPONENT's root `<svg>`. **Svelte 5 does not put the scoping hash on a child component's
elements**, so `.tone-mute.svelte-hash` matched nothing, `currentColor` fell back to the
initial value, and 24 glyphs on `/versions` and `/versions/<rev>` painted `#000000`:

| | before | after |
|---|---|---|
| `tone-mute` on the `gray-800` card | **1.43:1** | **5.64:1** |
| `tone-mute` on the `gray-900` page | **1.18:1** | **6.91:1** |
| `tone-live` (the mint) | **1.43:1** | **6.11:1** |

**IN LIGHT THE IDENTICAL BUG MEASURES 21:1 AND LOOKS DELIBERATE.** That is the whole thesis
of this section: the defect was equally present in both themes and only one theme could
show it, so verifying light and reporting dark could never have found it. The three inks are
GLOBAL in `app.css` now (`@layer components`, so a call site can still override with a
utility) and cannot be lost to a component boundary again. **Do not move them back into a
component.**

**3. DARK HAD NO BASE INK AT ALL.** The app shell computes `color: rgb(0, 0, 0)` in dark, so
anything that fails to name its own colour inherits BLACK — which is the ambient condition
that turned cause 2 into an invisible glyph rather than a wrong-coloured one.
`app.css` now carries `html.dark { color: var(--color-gray-100) }` in **`@layer base`**,
which every Tailwind utility and every `@layer components` rule outranks, so it can only ever
catch an element that names no colour. **Measured before/after over all 8,164 rows: zero
elements changed colour.** It is a net, not a paint.

### Beyond icons — what the sweep found

- **THE FILLED BANNER'S ALPHA LADDER WAS UNMEASURABLE BY THE USUAL METHOD AND FAILED IN BOTH
  THEMES.** `AlertPanel`'s container is a GRADIENT, so `getComputedStyle` on it returns
  `transparent` and every contrast number computed against the page ground was wrong.
  Re-measured **pixel-wise off a screenshot**, all four severities:

  | | icon | message | footnote |
  |---|---|---|---|
  | light before | **2.57 – 3.69** | **3.34 – 4.20** | **2.35 – 3.11** |
  | light after | 3.86 – 4.80 | 7.4 – 8.7 | 7.4 – 8.7 |
  | dark before | 6.17 – 6.78 | 5.68 – 6.08 | **3.58 – 3.83** |
  | dark after | 6.17 – 6.78 | 5.68 – 6.08 | 4.89 – 5.26 |

  **There is no alpha that works in light**: `<hue>-700` at 95% over the `<hue>-50/100`
  gradient is still 4.46:1. So in light the message and the footnote are the **full
  `<hue>-900` — the value the TITLE already prints on the same object**, and the ladder is
  carried by size and weight (16px/700 bold → 14px → 12px). **Zero new colour values.** In
  dark the alpha has headroom and is kept, raised 55% → 70% on the footnote. The icon moved
  `<hue>-600` → `<hue>-700` in light only: it sits on the `<hue>-200` DISC, not on white, so
  it was competing with a mid-ramp ground.

- **THE DARK PRIMARY BUTTON HAD NO BOUNDARY.** `blue-600` on the `gray-800` card is
  **2.79:1**, against **6.83:1** for the same button in light. The FILL cannot move (white on
  `blue-500` is 3.73:1 and fails 4.5 for 14px), so the BORDER carries it: `blue-500`, which is
  already this button's own hover fill → **3.96:1**. `.dark .btn-secondary`'s border went
  `gray-600` → `gray-500`: **1.94 → 3.03** on the card, 3.62 on the page. Zero new values.

- **`DeploymentTimeline`'s x-axis, ticks, tick labels and "no deployments" label** were on the
  faint pairs (2.35:1 dark). They are on the muted token now (4.90 / 6.91). Its GRIDLINES
  (`stroke-gray-200 dark:stroke-gray-700`, 1.2:1) and its dot HALO
  (`stroke-white dark:stroke-gray-800`, 1.0:1 by construction) are deliberately left: a
  gridline is decoration and a halo is a knockout that is SUPPOSED to match the ground.

- **`text-amber-500 dark:text-amber-400`** (the warning glyph on `/apps`, `/apps/[name]`,
  `/environments`, `/envs/[name]`) was **2.13:1 in light** and 8.50:1 in dark — the light half
  of a pair nobody had measured. Light moved to `amber-600`: 3.25:1.

### ⚠️ BORDERS AND CHIPS ARE FINE IN DARK, AND DARK IS THE STRONGER THEME ON BOTH

This was the expected finding and it is the opposite of true. Measured:

| object | light | dark |
|---|---|---|
| card border (`gray-200` / `dark:gray-700`) vs the page ground | 1.24 | **1.72** |
| card GROUND vs page ground | **1.00 — white card on a white page** | **1.20** |
| list divider (`gray-100` / `dark:gray-700/60`) | 1.10 | **1.23** |
| `.btn-secondary` border | **1.47** | 3.03 (after) |

**In dark the card is a lighter plane on a darker page and the border is a second signal; in
light the card and the page are BOTH `#ffffff` and the 1.24:1 hairline is doing 100% of the
work.** If a composed layout reads flat, it reads flat in LIGHT. Nothing was changed here —
it is a light-mode observation, recorded for whoever opens the ground question.

Chips are healthy in dark and were never the problem — ink on its own fill, `<main>`,
1440: identity `dev` **12.26–14.13**, `staging` **10.95–12.51**, `prod` **13.58–15.57**,
`test` (same construction); status `NEUTRAL` **5.64**, mint `newest` **6.11**, `ADVERSE`
(red-400) **5.11**, `alarm` **7.28**. Light is the weaker theme here too (`dev` **4.76**, the
floor). **The environment palette was not touched.**

### Per page, icons under 3:1 and text under its own floor, before → after

`<main>`, both themes, both widths. The floor is 3:1 for a glyph and 4.5:1 for text (3:1 for
text ≥24px or ≥18.7px bold).

| page | icons <3:1 dark | icons <3:1 light | text fails dark | text fails light |
|---|---|---|---|---|
| `/apps` | **7 → 0** | **11 → 0** | 0 → 0 | 2 → 0 |
| `/apps/[name]` | 0 → 0 | **9 → 0** | **13 → 0** | **14 → 0** |
| `/environments` | 0 → 0 | **4 → 0** | 3 → 0 | 4 → 0 |
| `/envs/[name]` | 0 → 0 | **13 → 0** | **20 → 0** | **21 → 0** |
| `/versions` | **19 → 0** | **21 → 0** | 0 → 0 | 2 → 0 |
| `/versions/<rev>` | **13 → 0** | **7 → 0** | 5 → 0 | 7 → 0 |
| `/activity` | 1 → 1 † | 1 → 1 † | 0 → 0 | 0 → 0 |
| `/namespaces/<ns>` | 0 → 0 | 0 → 0 | 1 → 0 | 1 → 0 |
| rollout detail › dependencies | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |

Worst offender per page, dark: `/versions` **1.43 → 5.64**, `/versions/<rev>` **1.18 → 5.64**,
`/apps` **1.94 → 4.60**, `/envs/prod` **3.03 → 5.25**. † the one remaining `/activity` entry
is the timeline's gridline/halo described above, which is 1.21:1 by design.

### THE THREE REFERENCE PAGES — what reached them, and what was left alone

`/`, `/rollouts` and rollout detail were audited and **not restyled**. Every change that
reaches them is a SHARED TOKEN fix, named above, and each one closes a contrast failure:

| page | before | after |
|---|---|---|
| `/` | 4 text fails dark (3.67), 4 light (2.60) | **0 / 0** |
| `/rollouts` | 9 icons dark (2.35), 10 light (1.47); 61 text fails per theme | **0 icons dark, 1 light; 4 text fails per theme** |
| rollout detail | 1 icon dark (1.43), 8 light (1.00); 6 text dark, 8 light | **0 icons dark, 5 light; 2 text dark, 3 light** |

⚠️ **FIVE DEFECTS ON THOSE PAGES ARE PAGE-LOCAL AND WERE DELIBERATELY LEFT.** Reporting them
rather than fixing them, because a page-local edit to these three is out of bounds:

1. **`/rollouts` — `<span class="font-mono tabular-nums opacity-60">` (`RolloutGrid.svelte:238`),
   the promotion-chain count. `opacity-60` composites to 2.32:1 light / 3.27:1 dark at 11px.**
   This is DIM-INSTEAD-OF-EXPLAIN, the pattern this file has already rejected twice; the fix
   is to delete the opacity, not to pick a colour.
2. **rollout detail — `text-orange-600 dark:text-orange-400` on `19 upgrades available`**,
   3.58:1 light at 12px.
3. **rollout detail — `text-blue-400 dark:text-blue-500`** on the resource link glyph
   (`ResourcesCard.svelte:407`), 2.57:1 light.
4. **rollout detail — the resource-kind pills** (`bg-gray-100 text-gray-500` /
   `dark:bg-gray-700 dark:text-gray-400`) at 10px: **4.39:1 light, 3.96:1 dark**, both under
   4.5.
5. **`/rollouts` + rollout detail — bare `text-gray-400` with NO dark partner** (search glyph,
   two icon buttons). 2.60:1 in light; dark passes at 5.74. A single-value ink in a
   two-theme product is a bug in itself.

### COLOUR VALUES ADDED AND REMOVED — the whole list

**ADDED: none.** Every value written in this pass is a step the product already spends:
`gray-500`, `gray-400`, `blue-500`, `amber-600`, and the `<hue>-900` inks that
`AlertPanel`'s own title already prints.

**REMOVED from the ink vocabulary:** `gray-300` and `gray-600` as TEXT/ICON inks (they remain
as border and surface values); the composited alphas `text-<hue>-700/80` and
`text-<hue>-700/60` in the light banner; `#000000` as a rendered glyph ink.

### HOW TO MEASURE THIS, so the next pass does not get it wrong

- `getComputedStyle` returns `oklch()` / `oklab()` in this app. **Resolve every colour through
  a 1×1 canvas and read the pixel. Do not parse the string, and do not divide by alpha** —
  `getImageData` is already un-premultiplied (this file records that trap once already).
- **Composite the WHOLE ancestor chain**, not "the first ancestor with a background". Alpha
  fills over the dark card's chromatic ground (`C 0.0335 @ 257.7°`) are exactly where dark
  diverges from light.
- **A gradient defeats all of the above.** `backgroundColor` is `transparent` on
  `bg-gradient-to-r`. For `AlertPanel` — the only gradient object in the product — screenshot
  the element and take the modal pixel as the ground and the 1st-percentile luminance
  outlier as the ink.
- `<line>` and `<polyline>` compute `fill: black` and paint no fill; a stroke within 1.1:1 of
  its ground is a knockout halo. Both produce phantom failures if not excluded.

**Gates after the pass: vitest 20 files / 347 tests, 0 failures; `svelte-check` 4 errors /
0 warnings; `paraglide/messages/en.js` 160 bytes.**

## THE COMPOSITION PASS — `/apps` AND `/apps/[name]` (2026-08-30)

**Read `.agents-context/design/COMPOSITION-GRAMMAR.md` before this file.** Six pages were
rebuilt against the rules below and every one was rejected, and the diagnosis is arithmetic,
not taste: **every rule in this file is a REDUCTION rule.** Closed colour budget, two radii,
mark-the-deviation, the ink ceiling, cut anything that mostly draws the norm. Run without a
countervailing composition discipline they converge on one thing — small gray text in
undifferentiated rows.

Measured on the running product: rollout detail **115** SVG icons in `<main>`, radii 8px +
12px, *"beautiful"*. `/apps` **4** icons, 12px only, rejected. `/versions` **0**, *"criminally
underdesigned"*.

**Compose first, then apply the budget to what you built. Never the other way round.**

### What is superseded, and what still holds

| rule | status |
|---|---|
| "exactly two radii: 12px panels, 4px chips" | **superseded.** 8px is the CARD radius and the good page is built from it. 12px stays for the outermost panel, 4px for chips. |
| the ink ceiling (`area × chroma` vs the alarm) | **scoped to marks competing on a row.** It does not govern a page-level banner or a card header. A fill at banner scale is legitimate. `alarm` is still the only CHIP with a fill. |
| "mark the deviation, never the norm" | **holds for repeated marks in a list.** It never meant a page should have no colour, no icons and no fills. |
| "one filled primary per page" | **holds, for ACTIONS.** A filled banner is not a primary action. |
| colour count as a target | **wrong framing.** Six status + four identity hues is a CEILING; the good pages spend more of it than the rejected ones. |
| nine type roles | **holds as a scale.** Range must be at least 24 → 12; the rejected pages cluster at 10–13. |

### The three shared primitives — use these, do not invent a fourth

- **`src/lib/components/Card.svelte`** — the product's titled panel. 8px radius, white on the
  tinted ground, 1px neutral border, near-zero shadow, `min-h-47px` header with a 16px icon, a
  **14px/600** title and a **right-aligned rolled-up verdict** (`3/3 healthy`, `2 items`,
  `3 of 4 fleets on one build`). Every number is `getComputedStyle` off the reference page;
  note the title is 14px, not the 16px `COMPOSITION-GRAMMAR.md` states.
  **A panel with no header and no rollup is the shape that keeps getting rejected.**
- **`src/lib/components/AlertPanel.svelte`** — the FILLED BANNER, and it already existed: it is
  what rollout detail renders its schedule gate and its version pin in. 40px circular icon,
  bold headline, a second line with the concrete consequence, `actions` on the right.
  Severities `error` / `warning` / `pinned` / `info`. It gained one prop, `class` (default
  `mb-4`). **Do not build a second banner.**
- **`.btn` / `.btn-secondary` / `.btn-primary`** in `app.css` — 14px/500, `padding: 8px 16px`,
  `border-radius: 8px`, 16px icon. Measured off `View on GitHub` / `Change Version` /
  `Rollback`. ⚠️ **`.t-button` (12px/600) is the REJECTED pages' size.** Do not use it for
  anything a reader is meant to press.

### ⛔ `−N` IS NEUTRAL GRAY. RED MEANS ADVERSE.

From a live UX critique: *"`−N` chips render RED across the product, so normal pipeline drift
reads as failure while a pinned prod rollout gets a calm gray-amber chip."* `Chip`'s `rank`
role is `NEUTRAL` now, and `/apps/[name]`'s 24px `−N` gap glyph with it.

`DESIGN-INTENT.md` already said so and was overridden by two rounds of local colour reasoning:
*"Rank chips are mint for `newest` and NEUTRAL GRAY for `−N from newest` — never amber."* It is
not amber and it is not red. The predicate the red violated is this file's own enforced rule:
*"'Drift' is not a valid status"* — being behind is the normal state of a promotion pipeline
and may not wear the failure hue.

**The ink-hierarchy argument that put red there assumed `newest` is the NORM and `−N` the
deviation.** On the live cluster the opposite is true: most environments trail and reaching
head is the rare, informative event, so quiet mint on the rarer state and no colour at all on
the repeated one is "mark the deviation" applied correctly. Red keeps `diverged`, `failing` and
`blocked` — states that will not clear on their own. **ZERO colour values change.** This is
visible on `/` and `/rollouts`.

### ⛔ THE NEUTRAL ROW BAND IS DEAD, ON BOTH PAGES.

> *"i don't like that you're highlighting a stuck row like this… it feels like a bug. is this
> what you implemented when i said there should be a better way to mark something as needing
> attention rather than just a badge? there are many examples on the rest of the page that are
> much better."*

Both tombstones that argued for it (`/apps`'s `bg-gray-100 dark:bg-gray-700/60`,
`/apps/[name]`'s `tk--broken` recess) are **arithmetically right and wrongly concluded.** They
proved no CHROMATIC field is affordable at ~70,000px² and then reached for the only channel
left — LIGHTNESS — which is the channel a browser spends on `:disabled`, on a skeleton and on a
dimmed row. A gray band on a white list reads as *this one is broken*, not as *look here*.

**What marks attention instead:** a FILLED BANNER for the page's one blocking fact, and
MEMBERSHIP OF A TITLED CARD for the set (`Needs attention`, `Needs a decision`, `Waiting`).
The rows inside a card are byte-identical to the rows in any other card — on `/apps` they are
literally one `{#snippet}` — because the moment one row can be styled differently from its
neighbour this comes back under a new name.

### A GREEN TICK MEANS THE WHOLE FLEET IS ON HEAD. NOTHING WEAKER.

`/apps` showed a green tick beside `hello-world-app — PROD is 14 builds behind`. The circle
painted the row's true BAKE glyph and prod's last deploy had succeeded, so both halves were
locally right and the pair was a lie. A bake status answers *"did the last deploy work"*; a
list row's reader asks *"is this app OK"*, and those diverge on exactly the rows that matter.
When nothing is failing/deploying/baking but the fleet is not fully on head the circle falls to
`None` — `PauseSolid` on the gray disc, which `BakeStatusIcon` already owns. Same rule now
gates `/apps/[name]`'s `State` rollup going green.

### THE REVISION PAGES — ENTRY POINT, PLAIN ENGLISH, THREE NEW COMPONENTS (2026-08-30)

> *"Designer should create new components when it's advantageous to get a better UX … Key point
> of good UX is that it draws people in where necessary so that they don't need to be an expert
> in the tool to know how to use it."*

`/versions` presented eleven near-identical rows and asked the reader to find the interesting
one; the banner was the only thing that led. Three objects now carry the page, and each is
shared by the list and the detail page so the two cannot drift:

- **`RevisionLead.svelte`** — the entry point. Identifier at 24px, the state sentence under it,
  the measurement at 24px on the same baseline, the 26px bar directly under the count that
  names it, `FleetSpread` under the bar. On `/versions` it is **the newest build anything is
  running**, chosen by RANK and never by health — this is not the deleted "highlight the broken
  row" band under a new name. On `/versions/<rev>` it is the hero (`spread={false}`, because
  there the bucket cards ARE the spread). **ONE lead per page, not one per repo:** on a
  7-repo cluster, seven 24px identifiers down one page is a list of headlines and therefore no
  headline.
- **`FleetSpread.svelte`** — the coverage bar said in words: one group per bucket carrying the
  bar's own fill as a 10px swatch, a plain-English name, a count, and the real environments as
  wrapped chips per service. **It is not the rejected legend**: that was a key built from a
  DUMMY graphic; every swatch here sits on a group of real places and disappears with them.
  Verified at a 13-region fan-out — 14 chips wrap inside one column at 1440 and six lines at
  390, with no layout break.
- **`BuildStateMark.svelte`** — one glyph and one sentence, from `buildState()` in
  `revision-coverage.ts`. The phrase was computed in the page and drawn three ways; it is
  written once now, so the bar, the glyph and the words cannot disagree.

**THE NOVICE TEST — every string that assumed the domain, and what it became.** `6 of 9 places
live` → `Running in 6 of 9 places`, with **the unit defined once** (*"A place is one service in
one environment"*) where its number first appears — the word cannot be deleted, because
`/api/rollouts` carries no pod counts and a pod ratio would be invented. `has places left to
reach` → `3 places still to go`. `partly rolled past` → `8 places moved on`. `live everywhere it
is carried` → `fully rolled out`. `Live here` / `Moved ahead` / `Not yet` / `Can't place` →
`Running it now` / `Already moved on` / `Not here yet` / `On a different line`. `HELD BY
ghd-p2fld` → `Deploys here are paused on a schedule`, with the generated gate names kept BELOW
as evidence. `Superseded` → `Already on 7c14e2a, and newer builds are ahead of this one`.
`Rolled past` → `No longer running anywhere`. `Built, never deployed` → `Never deployed`, with
the sentence that says what that means. `Builds on the ladder` → `Commits your services can
deploy`. `Places · 15 service × environment` → `Places to deploy to · 15`. `Ships as` → `What
each service calls it`. **Concrete beats abstract:** every state phrase now carries the count it
is about, so a reader can check it against the bar beside it.

**Two row defects, both measured.** The state glyph sat in a 20px box at x=41 while the sha and
the service list started at x=64 — three left edges on one card. The track is now exactly the
16px glyph, so the card has two: the glyph, and everything else at one x. And the `›` trailed
the age string inside the rollup stack, which floated it mid-row at 390; it is now absolutely
positioned at the row's right edge and centred on the whole row (measured: 1px).

**One defect only a fan-out finds.** At 13 regions the detail page's `Not here yet` printed the
byte-identical sentence thirteen times. Places whose reasons and gate names are identical now
collapse into ONE row of wrapped chips; a place with a `Promote` button never groups, because
the button names its environment and two of them on a row have a target you infer from position.

### ⛔ A GLYPH ALIGNS TO ITS HEADLINE'S LINE BOX, NEVER TO THE TEXT BLOCK'S CENTRE

> *"I see that at least revisions are broken on mobile."*

**This defect has now shipped twice.** `/apps/[name]`'s `!` glyph was centred against a
multi-line sentence and fixed; days later `AlertPanel`'s 40px disc was found doing the same
thing on `/versions` at 390 — **icon centre y=294, headline centre y=207, 87px apart**. Both
times the mechanism is one line of CSS: `display:flex; align-items:center` on a row holding a
glyph and a text column. That centres the glyph on WHATEVER the column happens to be, which is
one line on a desktop and five on a phone, so the glyph drifts down the paragraph as the
viewport narrows. It reads as broken because the glyph is pointing at a sentence it does not
belong to.

**The rule:** a glyph that belongs to a headline is positioned against **the headline's own
line box**, and it contributes **no layout height** — so it can never push the headline off its
baseline either.

`AlertPanel` now implements it, and it is the shared banner on `/`, `/apps`, `/apps/[name]`,
`/environments`, `/envs/[name]`, `/versions`, `/versions/<rev>` and rollout detail
(via `ScheduleStatus`), so no page can lose it again:

- the icon and the text are a **two-row grid**, not a flex row;
- column 1 row 1 is an empty stretched cell; the 40px disc is `absolute top-3 -translate-y-1/2`
  inside it — `top-3` is 12px, half of the `text-base` headline's 24px line box;
- the message and footnote are row 2, column 2.

Deliberately **not** `top-1/2`: row 1 also holds the `extra` chips, which wrap onto a second
line at 390, and half of a wrapped row is not the headline either.

**Measured after, icon-centre minus headline-first-line-centre, light and dark, 390 and 1440:**
1px on all five pages that render a banner (1px is sub-pixel rounding of the line box).

**Fix a shared defect in the shared component.** The `/apps/[name]` fix was made on the page,
which is exactly why it came back somewhere else.

### A GATE IS NOT A BREAKAGE, AND A PIN OUTRANKS A GATE

> *"`NEEDS A DECISION — 3 items` offers no decisions — every card gives only `Investigate` and
> `View on GitHub`. One of the three genuinely is a decision (a manual-approval gate) and is
> rendered identically to the two that are not."*

`block.blocked` was folded into `adverse`, so every gate-blocked environment rendered the BROKEN
branch, whose whole action row is two links. `promotionBlock` already draws the line
structurally and the page now uses it:

- **`awaitingApproval`** — the gate published an allow-list and nothing is on it. Only a person
  moves that. **A DECISION**: a filled `Deploy <build>` (the same modal rollout detail's own
  `Available Version Upgrades` list uses), plus `Change Version` and `Investigate`.
- **`notPassing`** — a schedule window or a health check. Clears itself. **NOT a decision**: its
  own `Waiting` card, its own rollup, and deliberately **no action button**.

**And a PIN outranks every gate.** *"While prod was pinned, that panel blamed `HELD BY
hello-world-manual-approval`; the actual cause was the pin, which the page never mentions."* A
gate holds the next promotion; a pin refuses all of them, so while `spec.wantedVersion` is set
no gate is the cause even though every gate is also blocking. The `held` loop claims the
environment before the gate loop runs, and the banner checks the pin before the gate.

### `/apps`'s FLEET COLUMN — the fifth attempt, and it is not a graphic

> *"i don't like that fleet by build got simpler - it provides almost no information now."*

A `2 BUILDS` chip over an 11px caption is a QUANTITY with no verdict attached. It is now TWO
CHANNELS and no legend: a **glyph for consistency** (`CodeMergeSolid` = every deployed
environment on one build, `CodeBranchSolid` = split, `PauseSolid` = nothing deployed — merge and
branch are LITERAL, so unlike the four rejected strip forms there is nothing to teach), and a
**count for distance** at 14px in the reference's own rollup idiom: `3/3 on head`. Green only
when the answer is all of them. The caption carries what the mark cannot (`2 builds`,
`N pending`, `N diverged`) and never restates it.

### Measured before → after

| page | icons in `<main>` | card radii | type range |
|---|---|---|---|
| rollout detail (reference, unchanged) | 115 | 8 + 12 | 24 → 10 |
| `/apps` | **4 → 19** | 12 only → **8 + 12** | 24 → 10, 14px ×10 |
| `/apps/[name]` | **6 → 13** | 12 + 4 → **8 + 12 + 4** | 24 → 10, 14px ×5 |

`/` and `/rollouts` keep 11 and 27 icons and radii {4, 12} — structurally untouched. The one
deliberate cross-page change is the `−N` chip colour above.

## THE NOVICE PASS — `/apps`, `/apps/[name]`, `/environments`, `/envs/[name]` (2026-08-30)

The composition pass above was the floor: these pages now look like the same product as rollout
detail. This pass is about whether **a competent engineer who has never seen kuberik can use them
in five seconds.** They failed that badly, and every failure was the same failure — *the product
spelled its own internals on the screen and expected the reader to already know them.*

> *"Key point of good UX is that it draws people in where necessary so that they don't need to be
> an expert in the tool to know how to use it."*

### The rule that replaces the vocabulary

**Prefer language that states the CONSEQUENCE over language that states the MECHANISM.** Every
term below was replaced against that test, and **nothing but strings changed** in the great
majority of them — same chips, same roles, same colour values, same geometry.

| was | now | why the old one failed |
|---|---|---|
| `3/3 on head`, `0/3 on head` | `All up to date`, `1 of 7 up to date` | `head` is git's word for a pointer |
| `head` chip | `newest` chip | ditto, and every other string already said "newest" |
| `−19` chip | `19 behind` chip | a signed integer beside a build id reads as a diff, and names no unit |
| `diverged` chip | `unreleased` chip | git's word for two branches; the fact is "never released anywhere" |
| `pending` chip | `never deployed` chip | names a state machine, not the fact |
| `BEHIND NEWEST · 19 builds` | `FURTHEST BEHIND THE NEWEST · 19 versions` | a distance with only one end |
| `held by 2 gates`, `HELD BY ghd-p2fld` | `BlockReason` — see below | a count of objects, and a generated k8s name, presented as explanations |
| `1 of 8 converged` | `1 of 8 the same version everywhere` | "converged" |
| `1 of 8 fleets on one build` | `1 of 8 the same version everywhere` | "fleet", "build" |
| `1 in motion` | `1 deploying now` | |
| `Lead` column, `not observed` | `To prod`, `no full trip yet` | DORA jargon; instrument's voice |
| `PROD-X is 3 builds behind` | `PROD-X is 3 versions behind the newest` | behind *what* |
| `4 builds` (fleet caption) | `4 versions live` | a quantity with no verdict |
| `Throughput` · `25% on newest` | `How it's going` · `1 of 4 up to date` | a percentage of four hides its denominator |
| `Median bake` | `Typical deploy` | "bake" is this product's own word |
| `Promotion chain` column | `Path to here` | names a mechanism |
| bare `17` between chain chips | `17` + a header gloss (desktop) / `17 waiting` (phone) | a quantity of an unnamed thing |
| `Exposure` | `How much is on the newest` | progressive-delivery literature, not a thing on screen |
| `State` card | `Where it's running` | |
| `Needs a decision` (offering only `Investigate`) | `Needs you` | the title claimed something the card did not deliver |
| `Waiting` | `Waiting, nothing to do` | the whole point of the card is that nobody must act |
| `Promote` | `Deploy newest` | names a concept not yet taught, on the least undoable control |
| `Review gates` | `See what's blocking` | names a Kubernetes object kind |
| `Change Version` | `Pick a different version` / `Release the hold` | names a field |
| `Rollback` | `Go back a version` | |
| `released` (queue column) | `ready since` | released *when*, from *what* |
| `3 BUILDS` | `3 versions` | |
| `unchanged for 1h` | `no progress for 1h` | |

~~⚠️ **`/` AND `/rollouts` STILL PRINT `−N`, AND THAT IS A KNOWN, DELIBERATE SPLIT.**~~
✅ **CLOSED 2026-08-30.** Both pages print `N behind` now, from `rankLabel` in `env-rank.ts`,
which is total and is the product's ONE spelling. Two more `−N` call sites nobody had logged
went with it (`/versions/<rev>`, `rankSentence`). See *"`N BEHIND` HAS ONE DEFINITION NOW"* at
the top of this file — the labels were the small half of that change; the NUMBERS were wrong.

### Three new components, and what each buys

- **`UpToDate.svelte`** — the "is this thing current" verdict: a LITERAL glyph for consistency
  (`CodeMergeSolid` = one version everywhere, `CodeBranchSolid` = split, `PauseSolid` = nothing
  deployed) plus `N of M up to date` at 14px in the reference page's own rollup idiom. Lifted out
  of `/apps`, which is where the human accepted it on the fifth attempt. **Its value is WORDING
  reuse, not code reuse**: two pages asked the same question and were spelling it two ways.
  ⛔ It is NOT used on `/environments` — `spread` counts distinct versions of ONE app, and across
  the different apps in an environment that number is meaningless. An object whose glyph would be
  a lie on a page does not go on that page.
- **`BlockReason.svelte`** — *"an opaque generated gate name presented as an explanation"* was the
  charge. Two lines, always in this order: the CONSEQUENCE in ordinary English including whether a
  person is needed, then the name, on its own line, prefixed `rule:` in muted mono so it reads as
  a handle to go look up. The split (`awaitingApproval` needs a person / `notPassing` clears
  itself) is `promotionBlock`'s own STRUCTURAL split, never a match on the generated name. On
  `/environments`, `/envs/[name]` and `/apps/[name]`.
- **`NextStep.svelte`** — owns the VERB VOCABULARY. Callers pass the STATE; the label, icon and
  emphasis come from one table, so the same problem offers the same words on all four pages and
  `Investigate` can never appear where a decision is wanted. `.btn` at 14px, never `.t-button`.

### Being actionable, and what it is NOT

`/apps` rows gained a step column: **empty on every settled row**, a button on the rows that need a
person. It is the page's entry point — before it, four rows were near-identical and the eye had
nowhere to land but the banner.

⛔ **AND `/environments` DELIBERATELY DOES NOT DO THE SAME.** Offering `Deploy newest` on every
trailing environment put **fourteen identical buttons** on the 22-environment fixture and destroyed
the entry point the change existed to create; it was also wrong on the merits, because promoting is
the controller's job and being behind is the normal state. A verb is offered there **only when
something will not resolve without one**. Likewise `See what's blocking` is not offered on a card
that has already printed, 200px above, the sentence the button promised to fetch.

### `/environments` — the grid holes, and masonry

A CSS grid equalises ROW height. Four stages in three columns left **~350px of blank white** under
`dev` and `test`, the largest empty area in the product, and the region bracket had four more holes
of 90–150px. `items-start` stops the CARDS stretching and cannot stop the ROW being tall. Both
brackets are `column-count` flows now (`.env-stack` / `.env-stack-item`, 1 / 2 / 3 at the same
breakpoints the grid used). Reading order survives: the stage bracket is a LINE read left to right,
which is the axis a column flow preserves; the region bracket is a SET ranked worst-first, and
worst-first read down the first column is still worst-first.

### Measured

| page | icons in `<main>` | radii | all four combinations |
|---|---|---|---|
| `/apps` | 19 → **40** | 8 + 12 + 4 | looked at, 1440 + 390, both themes |
| `/apps/[name]` | 13 → **21** | 8 + 12 + 4 | ditto |
| `/environments` | 3 → **113** | 8 + 12 + 4 | ditto |
| `/envs/[name]` | **24** | 8 + 12 + 4 | ditto |

`scrollWidth === clientWidth` at 390 on all four, both themes; **zero clipped chips, buttons or
headings** at 1440 (the two that were clipping — `prod-ap-southeast-2` and `prod-ap-northeast-1`
card titles — are fixed by dropping `wide` from the card-header env chip, which is legitimate only
because the full name is the `h2` immediately to its left).

⚠️ **ONE CHANGE LANDED OUTSIDE THESE FOUR PAGES.** `StageChain.svelte` is shared with
`/rollouts/<cluster>/<ns>/<name>/dependencies`, which now also renders `14 behind` and `unreleased`
instead of `−14` and `diverged`. That is the point — a term the product spells two ways is a term
nobody learns — but it is a change to a page outside this brief and is recorded here as one.

## THE DEPENDENCIES TAB — BOTH PASSES, AND A SHIPPED FALSEHOOD (2026-08-30)

`/rollouts/<cluster>/<ns>/<name>/dependencies`. From the human: ***"dependencies page is
absolute meeh."*** The cause was structural — **this page was built before
`COMPOSITION-GRAMMAR.md` existed and no agent owned it during either pass since**, so it
still had the exact shape all six rejected pages had: `t-label` eyebrows over bare
`rounded-xl` boxes, **zero icons**, no card headers, no rollups, a 13px type ceiling, and
mechanism vocabulary throughout.

### ⛔ AND IT WAS STATING SOMETHING FALSE. THE CAUSE WAS THE SOURCE, NOT THE CHIP.

The DEV node of `hello-frontend-app` rendered a truncated `NOT DEP…` chip — *"this
environment has never deployed"* — beside a promotion chain with **one** node, for an app
running in three. `/apps/hello-frontend-app` said `DEV 2.66.0-66 · STAGING 2.66.0-66 ·
PROD 2.66.0-66 · 3 of 3 up to date`, and the API agreed.

**Both defects are ONE bug: the chain was derived entirely from
`Environment.status.environmentInfos`.** Measured on the hub, all three of this app's
namespaces serve exactly

```json
"environmentInfos": [ { "environment": "dev" } ]
```

— one self-entry, **no `relationship`, no `history`** — because the environment-controller's
GitHub-deployments backend has recorded nothing under this app's `spec.name`. `chain()`
produced one row; `currentEntry()` returned null for it; `StageChain` renders that as
`not deployed`. Every step was locally correct and the output was a confident lie, because
**an EMPTY MIRROR was being read as an OBSERVATION.**

**The fix is the source.** The chain is built from the app's **ROLLOUTS** —
`Rollout.status.history`, which the rollout controller wrote when it deployed, and which is
the same source `/apps/[name]` reads. That is exactly why that page was right about this app
while this one was wrong. `environmentInfos` is still UNIONED IN so an environment the
rollout list cannot see is never lost, but it may no longer be the only witness for "never
deployed". The ORDER comes from the `After` edges, read from each sibling `Environment`'s own
**`spec.relationship`** (which IS populated on the hub) with `environmentInfos[].relationship`
as the fallback.

**The general rule: AN ABSENT RECORD IS NOT AN OBSERVATION.** Nothing on the page says "never
deployed" unless a ROLLOUT with an empty history says so.

⚠️ **THE FIXTURE WAS MORE GENEROUS THAN PRODUCTION, WHICH IS WHY NO TEST COULD SEE THIS.**
`dev-mock-api.ts`'s `DEP_ENV_INFOS` carried three fully-populated entries with `After` edges
and four history rows each — the shape `hello-world-app` has, not the shape this app serves.
It is now the live degenerate shape and is the regression fixture: if
`/rollouts/dev/hello-dep-dev/hello-frontend-app/dependencies` ever renders one node again, or
says `never deployed`, that fixture catches it. **A fixture more generous than production is a
fixture that cannot see production's bugs.**

**Verified against real data:** the tab now renders `dev 2.66.0-66 · staging 2.66.0-66 ·
prod 2.66.0-66`, `All up to date`. And on `hello-world-app` it prints
`dev 19 behind 991829b · staging 19 behind 991829b · 5 versions waiting to move ·
prod 24 behind 51b976a` — **character for character what `/apps/hello-world-app` prints**,
which is the check that the two pages now share one source of truth.

### Two more falsehoods the same fold produced

- **`in hello-dep-prod` ON THE DEV PAGE.** `contractBlocks` folded `providedVersion` /
  `providerNamespace` to the FIRST non-null across every environment's gate. But a
  `RolloutDependency` is per-environment and **so is the provider it points at** —
  `hello-api-app` in staging is a different rollout from `hello-api-app` in prod, and they
  routinely run different builds. The block now takes `preferEnv` (this page's own
  environment) as the authority, keeps `providedVersion` per entry, and publishes
  `providedVaries`. When the providers agree it prints ONE badge; when they genuinely differ
  it lists them per environment instead of picking one and printing it as the truth.
- **A HOP BETWEEN TWO PRODUCTION REGIONS.** The old `chainHops` drew a rail and a count
  between every consecutive PAIR, so `prod-af-south-1 → prod-ap-southeast-2` printed
  `2 versions ahead` for a comparison that is not a promotion, and a SOLID rail (= "in sync")
  wherever two siblings' ranks matched. *"Stages are a LINE. Production regions are a SET."*
  A hop is now drawn only where the next row is this row's `After` child **and this row has
  exactly one child**. Inside a fan-out nothing is drawn; each region's own `N behind` chip
  carries its distance.

### The composition pass

- Both regions are `Card` — 8px radius, 47px header, 16px icon, right-aligned rollup.
  `Waiting on other services` rolls up `Nothing held` / `4 versions held`;
  `Where it's running` rolls up **`UpToDate`**, the same object and the same words `/apps`
  uses, so a reader learns it once.
- The one blocking fact is an **`AlertPanel`** (amber — a contract block neither clears
  itself nor clears on approval; *somebody has to ship the other service*), with a `.btn`
  at 14px via **`NextStep`** (`step="open"`) when a single provider is the cause.
- A 24px `h1` + env chip + one gray line, the same header the Overview tab uses. Before this
  the page's largest type was a **10px `t-label` eyebrow**.
- Each contract row gained the reference page's own row idiom: 16px glyph, name, joined
  `[API][1.66.0]` badge, and an `ml-auto` rollup (`in 5 of 7 environments`) — which is also
  where the asymmetry moved to, out of the middle of an 11px evidence line.

⚠️ **`max-w-[360px]` / `max-w-[44rem]` ON THE CARDS, NOT ON THE GRID TRACK**, so the caps hold
in BOTH shapes. With no contract card the grid has no template and the chain stretched to the
full 1024px, which put every environment chip **~800px from the build badge it belongs to** —
`StageChain` right-aligns that badge, so a wide card is the same proximity inversion the
`/apps` convergence bar was rebuilt to fix. And the rail is **360px, not 320**: at 320 the
`Card` title clipped to `Where it's run…` against `UpToDate`'s ~117px rollup.

### The novice pass

| was | now |
|---|---|
| `CONTRACT GATES` (eyebrow) | `Waiting on other services` (card title) |
| `PROMOTION CHAIN` (eyebrow) | `Where it's running` — `/apps/[name]`'s own words |
| `NEEDS api` | `[API][1.66.0]` — a bare `NEEDS` names a mechanism and carries no number, and the number is the whole of *"is it far enough along yet"* |
| `deployed 1.66.0 · rel-66` | `Now on api 1.66.0, from rel-66` |
| `in hello-dep-prod` | `runs in platform-prod`, and only when it really is another namespace |
| `gates 2 of 7 environments` | `in 2 of 7 environments` (row rollup) + `not needed in <names>` |
| `2 older builds blocked` | `also holds 2 older versions nobody is trying to deploy` |
| `blocked` chip | `held` chip — same `blocked` ROLE, same red, only the word moved |
| `requires api ^3.0.0 · ConstraintNotSatisfied` | **`BlockReason`** — `Needs payments ^3.0.0 from payments-core, which is on 2.4.1 — someone has to ship payments-core first`, with `rule: dependency-… · ConstraintNotSatisfied` demoted below it in muted mono |
| `2 waiting` (hop) | `2 versions waiting to move` — `/apps/[name]`'s wording |
| `NOT DEP…` (truncated at `.chip`'s 12ch cap) | gone; and where it is genuinely true the chip is `wide` |

**`BlockReason` gained a fourth branch, `contract`, and it is in the shared component on
purpose.** It is the same defect that file exists to kill, one object further out: the
dependency controller publishes a generated `RolloutGate` (`dependency-<name>`) and the page
was printing it, and the controller's own `reason` enum, as if either were an explanation.
The consequence is a THIRD thing, not one of the existing two — it does **not** clear itself
like a schedule window, and nobody here can approve it either — so it gets its own sentence
rather than borrowing one that would be wrong. ⛔ **`reason` IS AN OPEN STRING AND IS NOT
SWITCHED ON**: the same dependency reports `ConstraintNotSatisfied` on the spoke and
`ProviderVersionTooOld` on the hub, so a friendly label per case would ship its fallback. It
rides in `names`, beside the gate name, where the component already dresses text as a handle.
The semver constraint is printed **verbatim** — a bare version is an EXACT match in
Masterminds semver, so "at least 1.1.0" would be a lie with better grammar.

### Nothing draws `Satisfied=True`

It is the norm and true on every gate on the live cluster. No green tick, no "satisfied" chip,
no per-environment row for it. The card states its rollup once, in neutral gray, and the
adverse case — `blockedReleases` newer than what the holding environment runs — is the only
thing that spends colour. `splitBlocked` still keeps the live `rel-2` block (the app's OLDEST
build, blocked while every environment runs `rel-66`) out of the banner and out of the drawn
rows, because that is the gate WORKING and no action follows from it.

### Measured

| | before | after |
|---|---|---|
| SVG icons (live, converged, 1 contract) | **0** | **5** |
| SVG icons (`MOCK_API=1`, 3 contracts, 7 envs) | 0 | **14** |
| radii | 12 + 4 | **8 + 4** (12 from `AlertPanel` when a version is held) |
| type range | 13 → 10 | **24 → 10** |
| chain nodes on `hello-frontend-app` | 1, `not deployed` | **3, all `2.66.0-66`** |

All four combinations looked at on the live example (1440 + 390, light + dark) and on the
`MOCK_API=1` adverse fixture. `scrollWidth === clientWidth` at 390 and 1440 in both themes;
**zero clipped headings, chips or buttons** on either. `/`, `/rollouts` and the Overview,
History and Logs tabs are untouched — the only shared files changed are `BlockReason.svelte`
(additive: one optional prop, one new exported function; its four existing call sites render
identically) and `view-models/dependencies.ts`, which no other page imports.

## ⛔ AN ENVIRONMENT'S LABEL IS ITS OWN NAME. NEVER THE PRESET WORD. (2026-08-28)

**Do not "fix" this back to the preset label.** `resolveThemeLabel` in
`environment-theme.ts` used to end on

```ts
return preset?.label || environmentName || labelFromThemeName(themeName);
```

so an `Environment` actually named `eu-prod-1` resolved to the word **`Production`**. On a
multi-region cluster `eu-prod-1`, `us-prod-2` and `ap-prod-1` all resolved to that one string:
**three distinct environments, one indistinguishable mark.** That is the same defect class as the
12ch truncation that rendered three regions as `PROD-US…` and forced a product-wide fix, and it is
the failure mode this file already rejects everywhere else. It now ends on

```ts
return environmentName || preset?.label || labelFromThemeName(themeName);
```

### The rule, stated once

1. an explicit `dashboard.rollout.kuberik.com/theme-label` annotation wins;
2. an explicit `dashboard.rollout.kuberik.com/theme` annotation **names the theme**, so the preset
   word is printed — the identity deliberately did *not* come from the environment's name, and
   printing `eu-prod-1` on a *green* chip would make the word and the colour disagree;
3. otherwise the identity was **inferred from** — or merely **recoloured on top of** — the
   environment's own name, so print that name.

The preset word survives only as the fallback for a rollout that declares a theme with **no
Environment attached**, which is the one case where there is no real name to print.

### THE PRODUCT ALREADY DECIDED THIS, ON `/environments`

`routes/environments/+page.svelte` carries its own `PRESET_TITLES` map with an **exact-name match
only** rule, and its comment states the principle verbatim:

> *"Exact-name match only for the preset words: a `prod-eu-west` row headed `Production` would be
> naming a DIFFERENT environment from the one it describes."*

Measured on `/environments` at 390: six production-region rows, each headed by its full addressable
name (`prod-ap-northeast-1`, `prod-af-south-1`, `prod-sa-east-1`, …) beside a chip carrying only the
distinguishing segment (`AP-NORTHEAST-1`). `compareEnvironmentNames` sorts by the real name, `/envs/[name]`
prints the real name, and the mock fixture's regions are *named* `prod-eu-central` /
`prod-ap-northeast-1`. `resolveThemeLabel` was the one place that disagreed. It agrees now.

### VISUAL DELTA: NONE. NOT ONE PIXEL, ON ANY PAGE.

**`theme.label` is not what an env chip prints and never was.** Every env chip in the product
renders `shortEnvLabel(theme)`, which reads `theme.environmentName` **first** — so the chips already
showed the real name before this change. `theme.label` has exactly one live consumer left:

| consumer | before → after |
|---|---|
| `Navbar.svelte` breadcrumb chip `title=` | preset word → the environment's real name |
| `Navbar.svelte` breadcrumb chip `label=` | dead fallback behind `shortEnvLabel`, never reached |
| `namespaces/[name]` ×2, `ActivityRail` | dead fallback behind `shortEnvLabel`, never reached |

The one live consumer is a **`title` attribute**, which has no layout. It is also a bug fix in its
own right: that chip is *deliberately not* `wide` (it truncates at 12ch) and its own code comment
says **"The full name is in `title`"** — while the code handed `title` the preset word instead, so
the tooltip that exists to recover the truncated name was throwing it away.

**No chip widened. Re-measured in-browser, all four combinations, against this file's own published
figures:**

| page | widest identity chip | published | measured after |
|---|---|---|---|
| `/` | `prod-ap-southeast-2` | 143.6 × 20 | **143.6 × 20** |
| `/rollouts` | `prod-ap-northeast-1` | 143.6 × 20 | **143.6 × 20** |
| `/apps` | `prod-eu-central` | — | 115.3 × 20 |
| `/activity` | `prod-ap-southeast-2` | — | 143.6 × 20 |
| `/namespaces/<ns>` | `prod-ap-northeast-1` | — | 143.6 × 20 |

Every rendered colour channel is byte-identical too — light ink `#7b3306` (amber-900), border
`#fee685` (amber-200), fill amber-50 @ 0.72; dark ink `#fef3c6` (amber-100), border `#973c00`
(amber-800), fill amber-950 @ 0.28 — and `stuck` is unchanged at **48.1 × 20**, amber-400 fill /
amber-500 border / amber-900 ink in light, amber-800 / amber-600 / amber-200 in dark.
**Geometry and colour are both inputs to the presence formula and neither moved, so the alarm
ratios stand exactly as published: `/rollouts` light 218.6 vs 171.7 = 1.27x, dark 162.3 vs 134.8 =
1.20x; `/` light 1.27x, dark 1.23x; `/apps` light 1.57x, dark 1.25x.** `stuck` is still the loudest
mark on every page. **0 chips clipped and `scrollWidth === clientWidth` at 390 on all of
`/`, `/rollouts`, `/apps`, `/environments`, `/activity`, `/namespaces/<ns>`, in both themes.**

`/`, `/rollouts` and `/rollouts/<cluster>/<ns>/<name>` are **unchanged**. On the live cluster the
detail page's breadcrumb chip still reads `prod` with `title="Production"`, because those rollouts
carry `dashboard.rollout.kuberik.com/theme: prod` and therefore take rule 2 above.

### The one case left on the table — flagged, not decided

A rollout in `prod-ap-northeast-1` that **also** carries `theme: prod` takes rule 2, so its
breadcrumb `title` is still `Production` rather than the region name. The visible chip is unaffected
(it prints the real name via `shortEnvLabel`), so no indistinguishable mark reaches the screen — it
is a tooltip nicety only. Fixing it means changing an already-green test's contract and changing a
protected page's tooltip on the live cluster, so it is **left for the human** rather than decided
here.

## `/` HAS AN `h1` NOW, AND IT IS `sr-only` (2026-08-28)

`/` was the only page in the product with **no `<h1>`**. It opened on four sibling `<h2>`s
("Needs you now" / "In motion" / "Trailing" / "Steady") with no page title above them, while
`/rollouts`, `/apps`, `/versions`, `/environments`, `/activity` and every detail route all print
one — so heading-order navigation landed inside a section with nothing naming the page.

`ControlCenter.svelte` now opens on `<h1 class="sr-only">Home</h1>`. **It must stay `sr-only`.**
`/` is under the standing *"do not change the rollout list and detail and home pages"* constraint,
and `sr-only` is `position: absolute` with a 1px clip — measured at **1 × 1, out of flow, in all
four combinations**, so it cannot shift a sibling. Home is deliberately the one page with no
*printed* title: the navbar wordmark and the Home tab already name it.

`routes/page.svelte.test.ts` asserts both halves — that the `h1` exists, and that it carries
`sr-only` — so the pixel constraint is enforced in CI rather than left to this paragraph.

## THE FOURTH NORM-DRAWING OBJECT IS CUT, AND THE "DUPLICATE COLOUR" IS A SPELLING (2026-08-28)

Three things in one pass, all measured on `MOCK_API=1` at 1440 and 390 in both themes.
**Zero colour values added. Zero removed.** `/`, `/rollouts` and the rollout detail page are
untouched — proof at the bottom.

### 1. `DeployHistoryStrip` — CUT. It read the same array the rail beside it reads.

**The object:** six 6px dashes per app per row, oldest left, in the `/envs/[name]` `History`
column. It was the fourth object flagged for mostly drawing the norm, after `Fleet by build`,
`EnvHealthStrip` and `/versions`' coverage bar.

**Measured across 17 rows on seven `/envs/*` pages, 102 dashes:**

| dash | count | share |
|---|---|---|
| `gray-200` ABSENT padding (fewer than 6 deploys exist) | 52 | **51.0%** |
| `green-700` `Succeeded` — the norm | 46 | **45.1%** |
| `yellow-700` baking | 2 | 2.0% |
| `blue-700` deploying | 1 | 1.0% |
| `red-700` `Failed` — the deviation | **1** | **1.0%** |

**96.1% of the graphic is norm or padding**, which is worse than `EnvHealthStrip`'s ~92% and
worse than the coverage bar's 9-of-11. At row scope, 13 of 17 rows printed `all recent
succeeded`.

**But the count is not why it was cut. This is:**

> **NOT ONE of the 17 rows carried a deviation the row's own status circle was not already
> drawing.** All four non-green dashes sat in the NEWEST slot — the slot the 24px
> `getStatusCircleClass` + `BakeStatusIcon` atom 12px to the left draws at 4x the diameter in
> the same hue. Asserted programmatically over every row: `rows with an older-slot deviation
> = 0`.

The strip's only unique claim is *"a deploy failed and then recovered"* — a flap that the
present tense cannot show. It occurred **zero** times in the fixture and cannot occur on the
live cluster, which has nothing failing.

**And the page already answers it twice.** `ActivityRail` sits 24px to the right of the list on
the same screen, reads **the same `status.history` array**, and prints the last 8 deploys of
this environment newest-first with the app name, the from-sha, the to-sha, the time, and the
status **in words — but only when it is not `Succeeded`**. The rail marks the deviation; the
strip marked the norm 96% of the time. Same data, same screen, opposite discipline.

**So the `/versions` middle path was considered and refused.** Gated on `failed > 0` the strip
would have drawn on 1 of 17 rows — and that one instance is still `[pad][pad][pad][pad][green]
[red]`, i.e. **83% padding even where it "carries information"**. That is the difference from
`/versions`, where the gated coverage bar is dense with meaning wherever it is drawn. A gate
that leaves the object 83% furniture is not the `/versions` precedent; it is the cut with extra
steps, plus a `History` header over a column that is empty on 16 rows in 17.

**What the cut bought, measured at 1440:**

| | before | after |
|---|---|---|
| row tracks | `24px 179px 179px 116px 132px 44px 112px` | **`24px 243px 243px 132px 44px 112px`** |
| app track | 179px (against `checkout-edge`'s 171px + its `stuck` alarm) | **243px, +35.8%** |
| chain track | 179px (against ~190px of `DEV › STAGING › PROD` — it wrapped) | **243px, +35.8%** |

Both `fr` tracks were **under** their measured content and are not now. The four-link
`payments-core` chain (~300px) still wraps; every three-link chain fits with room.

Status-hue marks on the page, before → after (`<main>`, all four combinations):

| page | elements | painted area |
|---|---|---|
| `/envs/dev` | 46 → **30** (−35%) | 6,432 → 4,888px² at 1440; 7,392 → 4,896 at 390 (**−34%**) |
| `/envs/staging` | 48 → **35** (−27%) | 8,228 → 6,200px² at 390 (−25%) |
| `/envs/prod` | 29 → **20** (−31%) | 7,446 → 6,087px² at 390 (−18%) |

⚠️ **THE DISTINCT-VALUE COUNT DID NOT MOVE, AND THAT IS THE POINT, NOT A MISS.**
Measured before → after on five `/envs/*` pages × 2 themes × 2 widths, **20 captures, every one
unchanged**: `dev` 15 light / 17 dark, `prod` 19 / 20, `staging` 15 / 16, `test` 12 / 13,
`prod-eu-central` 13 / 15. Nothing added, nothing removed. The strip spent **no colour value of
its own** — all five of its dash hues are the tokens the status circle and the rail already draw
on the same row. *An object that costs zero new values because every value it paints is already
painted beside it is not cheap; it is redundant,* and the value census cannot see that. Element
count and painted area can, which is why both are published above.

**`DeployHistoryStrip.svelte` IS DELETED, NOT ORPHANED.** Its own header records that it had
been orphaned once before and was *rebuilt* rather than removed — an unimported file invites a
third life. The reasoning lives here and in the `/envs/[name]` page header instead.
**Do not rebuild it.** If the flap signal is ever genuinely wanted, it belongs in `ActivityRail`
(which already has the data and the chronology) or in the rollout detail page, not as a second
per-row graphic in a list whose every other cell is present tense.

### 2. `valueDim` on `/envs/[name]` — REPLACED BY STRUCTURE. One consumer left.

The call site was the `pending` row's build badge: `<Chip role="unranked" label="pending"
value="—" valueDim>` — a joined box whose second half held an em dash at reduced opacity.

The em dash said "no build". The word one pixel to its left said `pending`. **One fact, two
encodings, and the second one spelled as an absence of ink** — dim-instead-of-explain, the
pattern the human rejected on the revisions pages, where the replacement (print every name in
full and let the column's emptiness signal for free) turned out strictly better.

**Fixed the same way: by STRUCTURE.** A row with a build renders a JOINED box, two halves; a row
with none renders a LONE chip, one half. The number of halves is now the encoding, and it is
legible scanning down a fixed 132px track in a way a 60%-alpha em dash was not. Verified by
forcing the branch on `/envs/dev` in all four combinations: `HEAD 9a1f4c2` / `HEAD 3f1ed09` /
`PENDING` / `HEAD e936e6f` reads as three two-part boxes and one one-part box.
`main .chip-value--dim` count on every `/envs/*` page: **0**.

**THE PROP CANNOT BE DELETED YET AND THIS IS ITS RECORDED STATE.** `RolloutGrid.svelte:445`
(`valueDim={!c.version}`) is the last consumer, and it is `/` and `/rollouts` — protected under
*"without changing the rollout list and detail and home pages"*. `Chip`'s `valueDim` prop and
`app.css`'s `.chip-value--dim` therefore stay, with a comment on the prop saying so.
**When `/` or `/rollouts` is next opened, that is the last call site: delete the prop and the CSS
rule with it.**

### 3. THE "DUPLICATE COLOUR" IS REAL IN LIGHT, FALSE IN DARK, AND MUST NOT BE MERGED

Reported as *"`environment-theme.ts`'s prod ink `rgb(123,51,6)` and `Chip.svelte`'s alarm
`text-amber-800` are the same colour, ΔC 0.0006"*. Re-measured in-browser on `/envs/prod`,
every channel of both chips, both themes, converted through a canvas so `oklch()` and `rgb()`
land in one space:

| | light | dark |
|---|---|---|
| prod ink | `rgb(123, 51, 6)` → **`#7b3306`** | `rgb(254, 243, 198)` → `#fef3c6` (amber-100) |
| alarm ink | `oklch(0.414 0.112 45.904)` → **`#7b3306`** | `oklch(0.924 0.12 95.746)` → `#fee685` (amber-200) |
| prod border | `#fee685` (amber-200) | `#973c00` (amber-800) |
| alarm fill | `#ffb900` (amber-400) | **`#7b3306` (amber-900)** |
| alarm border | `#fe9a00` (amber-500) | `#bb4d00` |

**In light they are byte-identical — ΔE is 0, not 0.0006** (the published 0.0006 was the
reporting instrument's own oklch→sRGB rounding). The class is `text-amber-900`, not
`amber-800`. **In dark they are two different values, and the reason is in this file already:
`amber-200` is the alarm's dark ink and identity may not print in it.**

**⛔ DO NOT MERGE THEM. Three reasons, in order of weight:**

1. **There is no single token to merge onto, because the two objects SWAP which one owns
   amber-900 between themes.** `#7b3306` is prod's INK in light and the ALARM'S FILL in dark.
   Any shared constant would be right in one theme and wrong in the other. The same is true one
   step over: `amber-200` is prod's light BORDER and the alarm's dark INK.
2. **Both available mechanical merges are regressions.** Putting `oklch(...)` or
   `var(--color-amber-900)` into `PRESET_RAMPS` breaks `oklabChroma()`, which parses hex and
   **silently returns a fallback BLUE** for anything else — plus ~20 literal assertions in
   `utils.test.ts`. Putting `text-[#7b3306]` on `alarm` replaces a semantic Tailwind step with
   an arbitrary literal in the one file that IS the product's colour vocabulary.
3. **It buys nothing the budget measures.** Merging changes *spellings*, not *values*. On
   `/versions/<rev>` light it is 21 spellings → 20 and **20 values → 20 values**. The product's
   ceiling has always been counted in values, and it is already at the lower number.

### THE CENSUS FOR THE SAME DEFECT CLASS, EVERY PAGE, BOTH THEMES

One value reached by two spellings, `<main>`, 1440, 22 captures:

| page | light values / spellings | duplicate | dark |
|---|---|---|---|
| `/` | 41 / 43 | `#008236` ×219, `#7b3306` ×115 | 42 / 42 — none |
| `/rollouts` | 34 / 36 | `#008236` ×215, `#7b3306` ×115 | 37 / 37 — none |
| `/activity` | 32 / 33 | **`#008236` ×447** | 33 / 33 — none |
| `/apps` | 25 / 26 | `#7b3306` ×15 | 26 / 26 — none |
| `/apps/payments-core` | 23 / 24 | `#008236` ×28 | 26 / 26 — none |
| `/environments` | 23 / 24 | `#7b3306` ×100 | 24 / 24 — none |
| `/envs/prod` | 19 / 20 | `#7b3306` ×25 | 20 / 20 — none |
| `/envs/dev` | 15 / 16 | `#008236` ×82 | 17 / 17 — none |
| `/namespaces/<ns>` | 16 / 17 | `#7b3306` ×40 | 17 / 17 — none |
| `/versions/<rev>` | 20 / 21 | `#7b3306` ×10 | 22 / 22 — none |
| `/versions` | 10 / 10 | none | 11 / 11 — none |

**Exactly two families exist in the whole product, both light-only, both an identity ink meeting
a status ink**, which is the collision this file already names and resolves by SHAPE.

⚠️ **THE SECOND FAMILY WAS NOT REPORTED, IS FOUR TIMES LARGER, AND CORRECTS A CLAIM THIS FILE
MAKES.** This file says *"`dev #16a34a` is a green — the `Succeeded` family. dev is OKLCH hue
149.2; `green-700` is 149.0. **Same hue**, and it stays."* Measured, it is not the same hue —
**it is the same VALUE**: `PRESET_RAMPS.dev.textColor` is `#008236`, and `#008236` **is**
`green-700`, the exact token `BakeStatusIcon`, the status dot and the verdict ring print in.
On `/activity` the two spellings co-occur **447 times**; on `/` 219 times, on the same rows.
The guard in `utils.test.ts` asserts the dev chip's **FILL** is far from the disc's ink, which is
true and which is not this collision. **The ink separation between DEV identity and `Succeeded`
state is exactly zero, and SHAPE is carrying 100% of the load, not most of it.**

**Not changed, deliberately, and the arithmetic for whoever revisits:** the seeds are closed by
the human, `dev`'s ramp is `green-700 / green-300 / green-50`, and any move reaches `/` and
`/rollouts`, which are protected. The rule as written — *"one green for STATE; identity is a
separate axis, told apart by SHAPE"* — is still the right rule; the sentence under it should say
**same value**, not same hue.

⚠️ **A MEASUREMENT TRAP, RECORDED SO THE NEXT AUDITOR DOES NOT REPEAT IT.** The instinctive way
to canonicalise a colour is to paint it on a 1×1 canvas and read the pixel — necessary, because
`getComputedStyle` preserves `oklch()` and `color(srgb …)` verbatim and a naive string census
counts one value as two. But **`getImageData` returns UN-premultiplied RGBA**. Dividing by alpha
"to un-premultiply" turns every sub-1 alpha colour into `#ffffff` and manufactures phantom
duplicates: the first run of this census reported the four `--rollout-theme-surface` tints at
0.72 (`amber-50`, `violet-50`, `green-50`, `cyan-50`) as one four-way duplicate group. **They are
four different colours.** Read the pixel; do not divide.

### PROTECTED PAGES — the proof

`/` and `/rollouts` were censused element by element at 1440 and 390 in both themes, before and
after — tag, class, own text, box, `color`, `background-color`, all four border colours and
widths, both radii, font-size, weight, letter-spacing, all four paddings, `fill`, `stroke`,
`opacity`. **545 elements on `/`, 1,056 on `/rollouts`, 8 captures.**

- **The paint-only projection (colour, border, radius, type, padding — geometry and opacity
  dropped) is IDENTICAL on all 8 captures with NO normalisation at all: 0 differing rows.**
- On the full projection the only fields that differ anywhere are `opacity`, `x`, `y`, `w`, `h`,
  and every differing row is an `animate-*` element — a pulse/ping/spin FRAME
  (`opacity 0.763963 → 0.777746`, `w 9.62 → 9.57`). Two further rows on `/rollouts` light are one
  right-aligned `font-mono text-[10px]` age cell that grew 36.13 → 42.16px because its clock
  string gained a character between captures. **Not one colour, border, radius, type, padding,
  fill, stroke or text field differs on either page.**
- Independently: the alarm-ceiling instrument reproduces this file's published figures exactly
  after the pass — `stuck` **218.6 light / 162.3 dark**, `/rollouts` `prod-ap-northeast-1`
  **171.7** (1.27x), `/rollouts` dark `staging` **134.8** (1.20x), `/apps` `prod-eu-central`
  **138.8** (1.57x), `/apps` dark `staging` **129.9** (1.25x). Every ratio matches what this file
  already publishes, **including after the environment-label change widened the region chips**.
- The rollout detail page: proven statically and completely. Only two files changed —
  `src/routes/envs/[name]/+page.svelte`, which is a route page and is imported by nothing, and
  `src/lib/components/DeployHistoryStrip.svelte`, whose sole importer was that page and which is
  now deleted. `grep -rn DeployHistoryStrip src/` returns only prose. No other page can have
  moved. (`Chip.svelte` took a comment-only edit on the `valueDim` prop; no rendered byte.)
- On `/envs/prod` the alarm is **218.6 / 52.8 = 4.14x** the loudest identity in light and
  **162.3 / 54.7 = 2.97x** in dark. `scrollWidth === clientWidth` at 390 on every page captured,
  before and after.

Gates after the pass: **vitest 19 files / 303 tests, 0 failures**; `svelte-check` **4 errors / 4
warnings**; `paraglide/messages/en.js` **160 bytes**.

## COMPUTED → CHOSEN: the env ramp now spends Tailwind steps (2026-08-27)

> *"Just keep in mind we have dark theme too."* — the human.

**The seeds did not move and must not.** `dev #16a34a` · `staging #7c3aed` · `prod #d97706` ·
`test #0891b2` are still the four identities, still the human's own palette, still closed.

**What moved is everything that hung off them.** `environment-theme.ts` did not *pick* the other
twenty colours, it **computed** them:

```
textColor        = mixWith(seed, '#000000', 0.18)
borderColor      = mixWith(seed, '#ffffff', 0.64)
surfaceColor     = mixWith(seed, '#ffffff', 0.90)
darkSurfaceColor = mixWith(seed, '#000000', 0.70)
darkTextColor    = mixWith(seed, '#ffffff', 0.42)
```

Five derivations × four environments = **twenty colours that exist in no palette**, with no designed
relationship to one another — two arbitrary points on a line from the seed. That is the whole
mechanism behind the contrast defect this file has been carrying: `prod` ink **4.18:1** and `dev`
**4.33:1** over their own fills at 10px, both under the floor. Meanwhile **235 distinct Tailwind
colour classes elsewhere in `src` have never produced a single contrast failure**, because Tailwind
ships designed relationships between the steps of a ramp and this file was inventing its own.

**⛔ `mixWith` IS NO LONGER ON THE PRESET PATH. Do not put it back.** The four presets carry an
explicit six-value ramp of Tailwind v4 steps (`PRESET_RAMPS` in `environment-theme.ts`). `mixWith`
survives for exactly one caller — `computedRamp()`, the fallback for a hand-picked
`dashboard.rollout.kuberik.com/theme-color` hex, which has no ramp to choose from and therefore
renders **byte for byte as it did before**. `utils.test.ts` asserts both halves.

### The values

| env | ink | border | fill | dark fill (src) | dark border | dark ink |
|---|---|---|---|---|---|---|
| dev | `green-700` | `green-300` | `green-50` | `green-950` | `green-800` | `green-200` |
| staging | `violet-800` | `violet-300` | `violet-50` | `violet-950` | `violet-900` | `violet-200` |
| **prod** | `amber-900` | **`amber-200`** | `amber-50` | `amber-950` | **`amber-800`** | **`amber-100`** |
| test | `cyan-700` | `cyan-300` | `cyan-50` | `cyan-950` | `cyan-800` | `cyan-200` |

**18 of the 24 are tokens `src` already spends** (`bg-amber-900`, `text-green-700`, `ring-green-200`,
…). The 12 violet/cyan steps are new *as literals* but not as hues: violet and cyan belong to
identity only, so they were never expressible as classes and the values they replace were not in the
palette either. **Rendered value count: 28 before, 28 after** (4 seeds + 24 supporting). No hue
family added; several ramp STEPS added, which is what the brief asked for.

### The eight ink contrasts, measured in-browser over each chip's OWN rendered fill, at 10px

| env | light before → after | dark before → after |
|---|---|---|
| dev | 4.33 → **4.81** | 7.46 → **12.26** |
| staging | 6.86 → **8.58** | 5.90 → **10.95** |
| **prod** | **4.18** → **8.83** | 7.67 → **13.62** |
| test | 4.75 → **5.13** | 7.10 → **11.62** |

**Both floor failures are closed.** ✅ The open issue at "THE CHIP CONTRASTS THIS FILE PUBLISHES ARE
OPTIMISTIC" is resolved and marked so.

### Borders: WCAG went DOWN in light and that is not the whole measurement

| env | light border vs own fill | light border vs page |
|---|---|---|
| dev | 1.40 → 1.36, ΔL −0.116 → **−0.118**, dEok 0.128 → **0.179** | 1.51 → 1.40, dEok 0.159 → **0.198** |
| staging | 1.59 → **1.73**, ΔL −0.142 → **−0.168**, dEok 0.159 → **0.192** | 1.76 → **1.86**, dEok 0.198 → **0.217** |
| prod | 1.38 → 1.21, ΔL −0.102 → −0.066, dEok 0.116 → **0.124** | 1.49 → 1.24, dEok 0.145 → 0.142 |
| test | 1.43 → 1.40, ΔL −0.120 → **−0.123**, dEok 0.128 → **0.167** | 1.56 → 1.44, dEok 0.160 → **0.185** |

Three of four hold their lightness contrast and gain 25–40% of perceptual separation. **Prod is the
one that trades luminance for chroma**, and the calibration is the product's own: `amber-200` on
`amber-50` measures **1.21:1 at ΔL −0.066**, and the neutral chip border every `rank`, `newest` and
sha badge already ships — `gray-200` on white — measures **1.24:1 at ΔL −0.072**. Prod's edge is now
at the weight the product has shipped on every non-identity chip for months, at 3.5x the chroma.

Dark borders all hold: dev ΔL 0.187 → 0.174, prod **0.201 → 0.206**, test 0.184 → 0.169, staging
0.160 → **0.108** (the one real softening — still above the neutral chip border's 0.095 on the same
ground, at 5.5x its chroma).

### DARK IS NOT DERIVED FROM LIGHT, and the reason is measurable

`.dark .chip-env` fills at **28% alpha over `gray-800 #1e2939`**, and that ground is itself
chromatic — **OKLCH C 0.0335 at hue 257.7, i.e. BLUE**. A warm identity CANCELS in it. Measured, the
old prod dark fill was **C 0.0036 at hue 286** — prod had crossed neutral and come out *violet*.
Violet staging ADDS in the same mix and came out at C 0.0502, **14x** prod.

**The fix is NOT more chroma in the fill, and the arithmetic says why.** On `/rollouts` the widest
identity chip is `prod-ap-northeast-1` at **143.6 × 20**. At the alarm ceiling's own formula, giving
that chip an *opaque* `amber-950` fill costs `2884 × 0.077 = 222` ink units on its own — the whole
alarm is **162.3**. Every uniform alpha ≥ 0.35 puts `staging` over the alarm too. **So the dark fill
stays a 28% tint and identity moves to the BORDER, which is opaque and therefore hue-true.** Prod's
dark edge goes `#755634` (C 0.0612, hue 67, a mix that had itself been washed toward the blue
ground) → **`amber-800 #973c00` (C 0.1358, hue 45)** — 2.2x the chroma, and the first time prod reads
as warm in dark. The dark ink pays for it by stepping to the pale tint, which is also what takes
every dark ink over 10:1.

**`--rollout-theme-dark-border` is a new variable** and the two rules that used to compute that edge
(`.dark .chip-env`, `.dark .environment-theme-badge`, both `color-mix(accent 38%, gray-700)`) read it
now. `.dark .environment-theme-band` is untouched. No other consumer of the `--rollout-theme-*`
contract changed.

### THE ALARM IS STILL THE LOUDEST MARK. Measured in-browser, this file's own formula

| page / theme | alarm | loudest identity, before → after | ratio before → after |
|---|---|---|---|
| `/rollouts` light | 218.6 | `prod-ap-northeast-1` 167.9 → **171.7** | 1.30x → **1.27x** |
| `/rollouts` dark | 162.3 | `staging` 136.0 → **134.8** | 1.19x → **1.20x** |
| `/` light | 218.6 | `prod-ap-southeast-2` 167.9 → **171.7** | 1.30x → **1.27x** |
| `/` dark | 162.3 | `staging` 133.8 → **132.3** | 1.21x → **1.23x** |
| `/apps` light | 218.6 | `prod-eu-central` 136.5 → **138.8** | 1.60x → **1.57x** |
| `/apps` dark | 162.3 | `staging` 133.8 → **130.3** | 1.21x → **1.25x** |

The instrument reproduces this file's published `stuck` figures exactly (**218.6 / 162.3**) and its
`167.7` for the widest prod chip (measured 167.9), so the before/after column is like for like.

**`prod.textColor` IS `amber-900` — the same token `alarm` prints in — and that is deliberate.** It
buys the border its chroma back and holds the ceiling at 1.27x (`amber-700` would drop it to 1.16x),
and it costs zero new values. What separates the two chips has never been the ink: measured across
the `[PROD][STUCK]` seam on `/apps`, **fill dEok 0.214 → 0.225 and border dEok 0.145 → 0.178, both
improved**, and the fill chroma ratio is **10.6x**. This file's own sentence — *"`alarm` is the only
chip with a FILL"* — is the mechanism, and it is stronger after this pass than before it. **In dark
prod steps to `amber-100`, because `amber-200` is the alarm's own dark ink and identity may not print
in it.**

### COLOUR-BLIND SEPARATION — simulated (Brettel 1997), not assumed

dEok between identities under protanopia / deuteranopia, max over the ink, fill and border channels,
on the values as rendered:

| pair | light protan b→a | light deutan b→a | dark protan b→a | dark deutan b→a |
|---|---|---|---|---|
| dev/staging | 0.322 → **0.348** | 0.246 → **0.261** | 0.253 → **0.276** | 0.173 → **0.205** |
| **dev/prod** | **0.059 → 0.210** | 0.066 → **0.112** | **0.051 → 0.072** | 0.068 → 0.062 |
| dev/test | 0.145 → **0.155** | 0.134 → **0.145** | 0.101 → **0.119** | 0.092 → **0.113** |
| staging/prod | 0.321 → 0.293 | 0.306 → 0.274 | 0.264 → **0.267** | 0.239 → **0.261** |
| staging/test | 0.183 → **0.204** | 0.116 → **0.124** | 0.161 → **0.168** | 0.084 → **0.101** |
| prod/test | 0.161 → **0.221** | 0.194 → **0.195** | 0.130 → **0.145** | 0.158 → **0.164** |

**The worst pair in the product was `dev/prod` under protanopia at 0.059 — at the practical JND for a
10px glyph. It is 0.210 in light and 0.072 in dark now.** The one number that moves the wrong way is
`dev/prod` deutan in dark, 0.068 → 0.062 (−9%, still 2.3x the JND). **In light the carrying channel
is the INK; in dark it is the BORDER** — which is the same finding as the section above, arrived at
from a different direction.

### Tailwind's amber ramp is NOT iso-hue, and that is why prod's steps look off-seed

`amber-600` is hue 58.3. `amber-700` is 45.4, `amber-900` 45.9, `amber-950` 45.6 — the dark end is
orange-red. `amber-200` is 95.8, `amber-100` 95.9 — the light end is yellow. **There is no
desaturated tan step**, so prod's old `#f1cea5` border (hue 71.2, C 0.0668) is a colour the ramp
simply does not contain, and any real step moves prod's ink toward red or its border toward yellow.

That retires a test, and the replacement is in `utils.test.ts`: **`hueGap > 25` is the wrong
instrument** when two inks differ in lightness and chroma as well. Prod's ink vs `red-700` is
30.7° → 17.4° of angle but **dEok 0.1340 → 0.1421** — the new ink is *further* from red, because it
is darker and less chromatic. The seed's own 29.8° gap to `red-700` is unchanged and still asserted.

### Protected pages: the complete delta

`/`, `/rollouts` and `/rollouts/<cluster>/<ns>/<name>` were measured element by element, before and
after, at 1440 and 390 in both themes. **Nothing on them changed except the env chip.** `stuck`
218.6/162.3, `−N` `red-700`/`red-400`, `newest` `#426d64`/`#83b0a8`, the sha half `gray-700`/`gray-200`
and the neutral chip border `gray-200`/`gray-700` are byte-identical. On the detail page the only
other themed object is the 1440×4 navbar accent band, which paints `--rollout-theme-accent` — the
seed — and is **unchanged at presence 906.8**.

`scrollWidth === clientWidth` at 390 on every page checked.

## THE COLOUR PLACEMENT PASS — the loudest mark is now the thing that needs a person (2026-08-27)

> *"I think you need to do audit of colours. Without changing the rollout list and detail and home
> pages."* — the human.

A measured audit (`/tmp/claude/colour-audit.md`, 52 in-browser censuses) found that the product does
**not** have a colour *inventory* problem — it has a colour *PLACEMENT* problem. On **seven of twelve
pages the loudest coloured mark was not the thing that needs a person**: it was an environment's
NAME, a filter button, or a bar segment meaning "this build is old". This pass fixes placement on the
eight in-scope pages and changes **no protected page**.

**`/`, `/rollouts` and `/rollouts/<cluster>/<ns>/<name>` are byte-identical**, proven by a full
`<main>` element census — tag, class, text, box, `color`, `background-color`, `border-color`,
border-width, both radii, font-size, weight, letter-spacing, padding, `fill`, `stroke` — at
1440x900 and 390x844 in both themes, 12 captures, **472 / 935 / 208 elements each, all identical**
once `animate-*` frames and clock-drift strings are normalised. The paint-only projection (colour,
border, radius, type, padding, geometry dropped) is identical with no normalisation at all.

### The ink ladder, before → after (1440, this file's own presence formula)

| page | theme | loudest mark BEFORE | loudest mark AFTER |
|---|---|---|---|
| `/apps` | light / dark | **`stuck` 218.6 / 162.3** ✅ | unchanged ✅ |
| `/apps/payments-core` | light | `prod-eu-central` 136.5 ❌ | `prod-eu-central` 136.5 ❌ *(see below)* |
| `/apps/payments-core` | dark | `staging` 133.8 ❌ | `staging` 133.8 ❌ |
| `/apps/checkout-edge` | both | **`stuck`** 214.2 / 159.1 ✅ | unchanged ✅ |
| **`/environments`** | light | `ap-northeast-1` — a NAME — 128.6 ❌ | **`stuck` 218.6** ✅ (1.70x) |
| **`/environments`** | dark | `staging` — a NAME — 133.8 ❌ | **`stuck` 162.3** ✅ (1.21x) |
| `/envs/prod` | both | **`stuck`** ✅ | unchanged ✅ |
| `/envs/prod-eu-central` | light | a BUTTON 103.7 ⚠️ | `eu-central` 97.3, **`diverged` #2** |
| `/namespaces/<name>` | both | `prod-us-east-1` ×4 | unchanged — *nothing on that page is adverse* |
| `/versions` | both | `notYet` amber 202.9 | `notYet` amber 202.9 — **but on 13 segments, not 30** |
| `/versions/<rev>` | both | `notYet` 2920.3 | unchanged — *and it is right; see FIELD CEILING §2* |
| **`/activity`** | light | **a FILTER BUTTON, 207.8** ❌ | `prod-ap-southeast-2` 167.9 |
| **`/activity`** | dark | **a FILTER BUTTON, 207.8** ❌ | `staging` 136.0 |

### Per page, measured

| page | values | chromatic values | green elements | contrast failures |
|---|---|---|---|---|
| `/activity` light | 53 → **44** | 25 → **19** | 268 → **165** | 7 → **3** |
| `/activity` dark | 59 → **48** | 28 → **19** | 268 → **165** | 8 → **4** |
| `/environments` light | 27 → 29 | 14 → 16 | **48 → 2** | 5 → **2** |
| `/environments` dark | 27 → 29 | 14 → 16 | **48 → 2** | 4 → **0** |
| `/namespaces/<name>` light | 15 → **13** | 5 → 4 | 10 → **6** | 5 → **2** |
| `/namespaces/<name>` dark | 16 → **14** | 5 → 4 | 10 → **6** | 5 → **1** |
| `/versions` light | 11 → 11 | 4 → 5 | 0 | 3 → **0** |
| `/versions` dark | 11 → 11 | 3 → 3 | 0 | 4 → **0** |
| `/versions/<rev>` light | 24 → **23** | 13 → 13 | 2 | 5 → **2** |
| `/versions/<rev>` dark | 24 → **23** | 11 → 11 | 2 | 4 → **0** |
| `/apps` light / dark | 33 → **32** | 18 → 18 | 16 | 4 → **1** / 7 → **4** |
| `/apps/<name>` light | 32 → 32 | 12 → 12 | 28 | 7 → **5** |
| `/envs/<name>` | 26 → 27 | 13 → 13 | 16 → 15 | 4 → 4 |

`/environments` and `/envs/*` gain two values: the `stuck`/`failing` chips those pages did not have.
That is the point of the pass, not a regression.

### COLOUR VALUES ADDED AND REMOVED — the whole list

**REMOVED (10):**

| value | where it was | why |
|---|---|---|
| `#155dfc` blue-600 | `/activity`'s selected time-range pill | presence **207.8** — the loudest mark measured anywhere in the product, louder than the alarm chip, and `dEok` **0.0591** from `Deploying` `blue-700`, below the JND. A *status* hue meaning "you clicked this". |
| `#f59e0b` | `DeploymentTimeline`'s `InProgress` dot + legend | the pre-OKLCH hex for `amber-500` — a **duplicate** at `dEok` 0.0165, and amber is reserved for `stuck`. Now `yellow-700`, which is what baking means. |
| `#ef4444` | timeline `Failed` dot + legend | off-token red-500 → `red-700` / `red-400`. |
| `#3b82f6` | timeline `Deploying` dot + legend | off-token blue-500 → `blue-700` / `blue-400`. |
| `#6b7280` | timeline `Other` dot + legend | off-token gray-500 → the token pair. |
| `#9ca3af` | timeline `Cancelled` dot | off-token gray-400 → folded into the neutral. |
| `#50a2ff` blue-400 | the timeline's `now` marker and its axis label | decoration inside the `Deploying` hue family → gray. |
| `rgba(34,197,94,.3)` + 3 more | the timeline's hover glow | four status-tinted rgba literals, one of them **`green-500` — a banned token**. The dot already grows on hover; the halo is neutral. |
| `green-700` / `green-400` **as `EnvHealthStrip`'s `healthy` tick** | `/environments`, `/envs/<name>` | see the corrected corollary below. |
| `#e7000b` red-600 | `/namespaces/<name>`'s FAILING numeral and its failure sentence | a second red. `red-700` / `red-400` is the one. |
| `bg-red-50/80` + `dark:bg-red-950/25` | `/apps/<name>`'s `tk--broken` field | see §10 below. |

**ADDED: none.** Every replacement is a token the product already spends. The `/versions` LIVE
numerator takes the quiet mint `#426d64` / `#83b0a8` — the budget's existing "on the build in
question" owner, already shared by `Chip role="newest"`, `CoverageBar`'s `live` and `ExposureBar`.

**Six status hues + four identity hues: unchanged. Baking YELLOW and deploying BLUE still share no
value** — and one violation of that was removed (`InProgress` was drawing in amber).

### What changed, page by page

**`/activity` — the loudest object in the product was a filter button.**
The `7d` pill's selected state was `bg-blue-600` at `rounded-md px-2.5 py-1` with a 12px type size:
one banned radius, two off-scale spacings, a type role that does not exist, and a status hue on a UI
state. It now uses the near-neutral `gray-900` fill the `ALL / DEPLOYS / IN PROGRESS / FAILURES` row
30px below already had, at the legal 4px radius on the 4/8/12 scale — **the two filter rows are one
control language instead of two.** The zoom-reset box and the app-filter chip lost their blue for the
same reason. **The LEGEND IS DELETED**: five dummy swatches under a chart the tooltip already names,
which is the object the human had deleted from `/apps` on 2026-08-26. And **`Succeeded` is neutral on
the scatter** — a timeline's x-axis IS position, so this file's own corollary applies in full; before
it, `/activity` drew **216 green glyphs against 2 red and 2 amber, marking the norm 108:1.**

**`/environments` — the page's headline fact had no mark, and 20 red chips marked the norm.**
Two changes, both below: the row's worst state now prints as a chip on the subject line, and a `−N`
recedes to the `count` gray when its own bracket header already says every member is behind.
Measured: **`red-700` elements 22 → 6; adverse chips 21 → 5.** The five that remain are `diverged`,
`failing`, the two stage-panel lags (where DEV and TEST are on head, so lag IS the deviation) and the
fleet rollup's one summary `−4`. `DIVERGED` is now the only red chip in an 18-row column.

**`/namespaces/<name>` — the most undercoloured page, and both of its coloured things were wrong.**
`HEALTHY N` was a 24px green numeral marking the norm (neutral now); `FAILING 0` was `gray-300` at
**1.47:1 light / 1.94:1 dark** — a number that could not be read (now `gray-500` / `gray-400`,
4.84:1 / 5.64:1, and still `red-700` when it is not zero, because that IS the deviation); and
`Succeeded` printed three times as **green PROSE** in the activity rail, the only page in the product
breaking *"colour goes on MARKS, never on PROSE"*. The failure-category sentence lost its red too.

**`/versions` — three chromatic values in two hue families, and the only colour marked dead builds.**
The LIVE numerator takes the mint (see above). And `notYet` is amber **only while the build can still
arrive** — see `coverageFill` in `revision-coverage.ts`. Measured on the list: amber segments
**30 → 13**, gray `ahead` 42 → 59. The page's own rank order is unchanged, because the largest amber
segments belong to revisions that DO still have a live place, which is exactly where amber is true.

**`/apps/<name>` — a COUNT in the adverse red, and a red field that turned violet in dark.**
`role={fleetVerdict.agree ? 'count' : 'rank'}` printed `N BUILDS` in `rank`'s red whenever production
spanned more than one build: red's owners are `Failed`, `diverged`, `rank` and `failing`, a count is
none of them, and *"drift is not a valid status"* is enforced. It is always `count` now. The
`tk--broken` field is covered in the corrected rule list below.

**The muted-ink token, on every in-scope page.** `text-gray-400` measured **2.60:1** on white and
`dark:text-gray-500` **3.03:1** on the card — both under 4.5 — carried by `.t-micro`, `.t-code-sm`,
12.5px `.t-dense` state sentences and, worst, **`.t-label`, which is the TABLE COLUMN HEADERS**. The
pair moves one step to `gray-500` / `gray-400` (**4.84:1 / 5.64:1**), which are already in the
palette. **48 call sites** across the eight in-scope pages plus `EnvHealthStrip`. `gray-300` /
`gray-600` is now reserved for pure separators (`·`, `/`) and **may never carry a number** — that was
the `FAILING 0` defect. `/activity`'s `text-gray-400/70` at **1.89:1**, a fifth gray produced by
alpha with a strikethrough on top of it, is gone with them.

⚠️ **The type classes do not own this colour — the call sites do**, which is why the fix is per page
and why `/` and `/rollouts` still carry the defect. See the open issue at the bottom.

## ⛔ THE DOT IS NOT A MARK ON THIS ROW. A BADGE IS TWO SECTIONS. (2026-08-27)

Four sentences from the human, in the order they arrived, and they resolve to one rule:

> *"I don't like that status dot is in a separate subbadge. I also don't like that we split
> the badge in up to 4 sections."*
> *"Environment list is not nicely aligned because of badge positioning."*
> *"I think green on newest badge is too faint."*
> *"I also don't like dots outside of badge, especially when we have stuck which has its own
> dot which is also useless."*

**THE PER-ENVIRONMENT STATUS DOT IS DELETED. `Chip role="status"` is gone, `StatusDot` — the
loose form it was moved to for about twenty minutes — is gone, and `.chip-dot` /
`.chip-dot--solo` are gone with them.** Two placements were rejected in one session. That is
not a request for a third placement; it is a request for the mark. **Do not reintroduce it
inside the badge, beside the badge, above the badge, or as a border.**

**`alarm` NO LONGER HAS A GLYPH.** The amber dot sat 4px from the word `STUCK` and said the
same thing. The long-standing rule *"`alarm` is the only chip with a fill AND a glyph"* is
retired and replaced by **`alarm` is the only chip with a FILL**, which is the half of it that
was doing the work. Everywhere this file says "fill AND a glyph", read "fill".

### The badge is `[identity][state]`. Two sections. Never three.

`/apps` had grown to three (`[●][PROD][STUCK]`) and `/versions/<rev>` to four
(`[●][PROD][−19][STUCK]`). The cap is now enforced three ways, deliberately redundantly,
because a convention is what let it reach four:

1. `Chip` renders at most two halves itself;
2. `app.css`'s seam rules join a **first** and a **last** half only
   (`:first-child:not(:last-child)` / `:last-child:not(:first-child)`), so a third half keeps
   its own 4px corners and its own right border and renders as a visibly separate box;
3. `Chip` asserts it in DEV — any `.chip-joined` holding more than two `.chip` / `.chip-value`
   children logs a `console.error` naming the box, including one hand-rolled at a call site.

**Measured after, at 1440 / 1280 / 390, light and dark: max sections per box is 2 on every
page in the product.** `/`, `/rollouts`, `/apps`, `/apps/<name>`, `/envs/<name>`,
`/versions/<rev>` = 2; `/environments`, `/versions`, `/activity`, rollout detail = 0 joined
boxes at all. `scrollWidth === clientWidth` at 390 everywhere.

### What a reader can and cannot tell per environment now

**Can:** which environment (the identity half, `wide`, so `PROD-EU-CENTRAL` prints whole), and
whether it is `stuck`, `failing` or `diverged` — each as a WORD in the second half. On
`/versions/<rev>`, also how far behind (`[ENV][−N]`), with `STUCK` loose beside it in the same
`.chip-mark` group.

**Cannot:** whether that same environment's last deploy succeeded, failed, or is in flight
*independently of* the adverse word. A stuck environment that is also mid-deploy used to be an
amber box with a blue dot. That fact now reads at ROW scope (the status circle, which stays —
`HANDOFF.md` specifies it as the row atom on four pages and the human has never objected to
it) and at environment scope on `/apps/<name>`. It is also still in the badge's `title`.

**This does NOT reintroduce the `unranked` trap.** That rule — never render an unresolvable
comparison as a definite claim — is about the RANK slot, and the rank slot is untouched:
`held` / `pending` / `unknown` still print `unranked` rather than nothing. What changed is the
STATE slot, and on `/apps` every box in the list is an adverse environment by construction, so
an absent state word never appears at all rather than silently meaning "healthy".

### `.chip-mark` — the one grouping idiom left, and what it is for

A badge that already holds its two sections, plus an `alarm` that cannot fit in either. 4px
inside the group, 16px between groups. It exists for `/versions/<rev>`, where a region is both
nineteen builds behind AND stuck. It is **not** a place to put a status dot.

`/apps`'s mark row is `gap-x-4 sm:gap-x-6` (16px / 24px). With the dot gone the within-unit
gap is a shared 1px border and the between-unit gap is 16–24px of whitespace, so the grouping
is unambiguous; 16px rather than 24px below `sm` because 24px pushes `checkout-edge` — the row
that is actually stuck — from one line to two at 390.

### THE ALARM CEILING, RE-MEASURED, AND THE FILL PAID FOR THE GLYPH

Removing the glyph cost 9px of width and its own ink. Measured on `/apps` at 1440 with this
file's own formula (`area×fillC + area×0.28×inkC + perimeter×borderC + dot`), instrumented
in-browser through each colour's real ancestor stack:

| `stuck` | box | light | dark |
|---|---|---|---|
| with glyph, `amber-200` / `amber-950` | 57.1 × 20 | 204.2 | 155.5 |
| no glyph, same fills | 48.1 × 20 | **169.4** | **128.4** |
| no glyph, `amber-400` / `amber-900` | 48.1 × 20 | **218.6** | **162.3** |

**The middle row was not survivable and that is why the fill moved.** 169.4 against
`prod-ap-northeast-1`'s 167.7 on `/rollouts` is 1.01x, and 128.4 against `staging`'s 134.9 in
dark is **0.95x** — the alarm would have stopped being the loudest mark on the page. The
clipping pass had already spent the headroom, so there was nothing left to absorb it.

**Bought back on the FILL, with ZERO new colour values** — `amber-400`, `amber-500` and
`amber-900` are all already spent in `Chip`, `CoverageBar` and `EnvHealthStrip`:

| | before | after |
|---|---|---|
| light | `border-amber-400 bg-amber-200 text-amber-900` | `border-amber-500 bg-amber-400 text-amber-900` |
| dark | `border-amber-700 bg-amber-950 text-amber-200` | `border-amber-700 bg-amber-900 text-amber-200` |

Ratios after, alarm ÷ loudest identity mark on the same page:

| page | before this pass | after |
|---|---|---|
| `/apps` light | 1.51x | **1.62x** (218.6 / 135.2) |
| `/apps` dark | 1.17x | **1.22x** (162.3 / 132.8) |
| `/` and `/rollouts` light | 1.22x | **1.30x** (218.6 / 167.7) |
| `/` and `/rollouts` dark | 1.15x | **1.20x** (162.3 / 134.9) |

Contrast holds: `amber-900` on `amber-400` is 5.26:1, `amber-200` on `amber-900` is 7.28:1.
The border stays visible against its own fill (ΔL 0.057 light, 0.142 dark), so the chip is
still a bordered box and not a slab. **If this ever needs buying back again, buy it with the
fill. Do not restore the glyph.**

**TWO AMBERS NOW SIT ON ONE `/apps` ROW, AND THAT IS FINE — recorded so it is not
"discovered" later and re-solved.** `FleetStrip`'s `stuck` mark is `amber-500 / amber-400` and
the alarm's fill is `amber-400 / amber-900`, ~700px apart on the same row. Both values were
already in the palette before this pass (`amber-400` was the alarm's own border, `amber-500`
its glyph), both mean the same thing — `stuck` — so this is one hue family saying one word,
which is the rule rather than a violation of it. They are dOKLab 0.0735 apart and cannot be
confused as OBJECTS: a 10×10px square against a filled bordered box with a word in it.
Measured, the strip's mark costs `100px² × C 0.1728 = 17.3` ink units against the alarm's
218.6 — **12.7x in the alarm's favour**, so the ceiling is nowhere in play. **Do not
"unify" them by moving either value.** The strip's light mark and the alarm's light border
are already the same value, which is the alignment worth having.

## `newest` IS LOUDER, AND THE HUE DID NOT MOVE (2026-08-27)

> *"I think green on newest badge is too faint."*

**"Too faint" had a number, and it was not only chroma.** `#56766f` measured C 0.0384 at
L 0.539 — only **1.12x the chroma of the neutral `.chip-value` gray one pixel to its right**,
and *lighter* than it. A word that is barely more chromatic and visibly weaker than the
identifier it labels reads as faded, not as coloured.

**The shipped value is `#426d64` / `#83b0a8`**, solved on three axes:

| axis | before | after | why |
|---|---|---|---|
| hue | 179.8 / 182.2 | **179.4 / 182.7 — HELD** | see below |
| L | 0.539 | **0.500** | `red-700`'s own lightness, so `newest` and `−N` are PEERS in weight |
| C | 0.0384 / 0.0351 | **0.0503 / 0.0495** | +31% / +41% |

⚠️ **THE HUE IS THE AXIS THAT GOES WRONG, AND IT WENT WRONG ONCE IN THIS PASS.** The first
attempt raised chroma by moving along the `gray-500 → green-700` MIX LINE (75% gray → 64%),
which pulls the hue greenward: `#53796a` at **168.0°** — 4.8° from the `emerald-600` this file
already rejects as "a third green", and 18.5° from DEV's identity ink. On `/rollouts` a `[DEV]`
chip and a `[newest 9a1f4c2]` badge sit on the SAME ROW. **Mix amount is the wrong control.
Solve the three channels directly and hold the hue at ≥ 25° from the green family in BOTH
themes.**

Measured after: ink ratio `−N : newest` (characters × chroma, both text-only in one face)
**1.81x → 1.38x light, 1.80x → 1.27x dark — the deviation is still dominant.** dOKLab from the
gray it replaces 0.046 → 0.075 light (it was AT the detection threshold), 0.041 → 0.053 dark.
Hue separation from DEV's ink and `green-400` unchanged at 29.9° / 31.1°. Contrast 4.98 → 5.83
on white, 6.07 → 6.11 on `gray-800`.

**One value, three call sites, still.** `Chip`'s `newest`, `CoverageBar`'s `live`,
`ExposureBar`'s newest segment. FIELD CEILING §1 re-checked: `live` 0.0503 against `notYet`
0.1728 (**3.4x**) and `failing` 0.2086 (**4.1x**) light; 0.0495 against 0.1712 (3.5x) and
0.2373 (4.8x) dark. The loudest pixel of a nine-tenths-live bar is still in the adverse
segment.

⚠️ **A number this file published is wrong and is corrected here:** the `−N : newest` headroom
was recorded as 1.66x / 1.58x. Re-measured on the rendered sRGB it was **1.81x / 1.80x**. The
file understated the room available.

## `/environments` — TWO BASELINES, EVERY COLUMN, EVERY ROW (2026-08-27)

> *"Environment list is not nicely aligned because of badge positioning."*

Two defects, both confirmed by measurement at 1440.

**1. The badge track was headerless and detached.** `ENVIRONMENT` sat over the NAME at x=357
while `DEV` / `STAGING` / `PROD` sat in an unlabelled track at x=222, left-aligned — so a 34px
`DEV` chip ended **106px** from the name it labels while a 110px `AP-NORTHEAST-1` ended 12px
from it. The pair read as one object on some rows and as two on others.

Fixed on both halves: `Environment` now **spans grid columns 1–2**, because that is what it
names — one subject, two marks — and the badges are **right-aligned in their track**, so the
gap to the name is 12px on every row and the column still has a hard edge to scan.

**2. The `BEHIND` column mixed a chip with plain text, and the whole row had five rhythms.**
Measured before: badge centred (y 255), name + sub two lines from the top (245 / 265), health
6px ticks + caption (247 / 260), apps one centred line (255), deployed one centred line (255),
and `BEHIND` **chip + caption on a lagging row (370 / 391) against a lone centred `all on
head` on a settled one** — the same column's caption moving with the DATA.

The row is now `align-items: start` at `lg`, and every cell is a **`.env-line` MARK LINE of
exactly 20px** — the chip's own height, not a new number — followed by an optional 11px
caption 4px under it. `EnvHealthStrip`'s tick row took the same 20px min-height, because a 6px
object top-aligned against a 20px chip puts its caption 14px above every other caption on the
row.

**The empty mark line is the point.** An environment on head prints no rank chip (mark the
deviation, never the norm) and the cell keeps its 20px anyway, so `all on head` lands on the
same baseline as `4 of 4 behind`.

Measured, per row, before → after: **mark-centre spread 9.7–10.2px → 0.0px; caption-baseline
spread 7.0–10.8px → 0.0px.** Every column, every row, with data and without.

## ⛔ THE ENV PALETTE IS CLOSED. IT IS THE ORIGINAL. (2026-08-25)

From the human, after four consecutive rejected palettes (amber-600 → slate → rust
`#7c2d12` → `#8f3b00` → magenta `#b50e91`):

> *"they need to fit in with the rest of the colors of the pages. i don't know why you
> changed them in the first place. the one we had originally before you started doing
> changes were completely fine."*

**`dev #16a34a` · `staging #7c3aed` · `prod #d97706` · `test #0891b2`.** Restored, along
with the derivation that went with them: `borderColor` = a fixed 64% white mix,
`surfaceColor` = a fixed 90% white mix.

⚠️ **THE SEEDS ARE STILL CLOSED. THE FIXED MIXES ARE GONE (2026-08-27).** They were replaced
by chosen Tailwind steps from each seed's own ramp — same four hue families, real designed
contrast, in both themes. The seeds themselves are byte-identical and this section still
binds on them. See "COMPUTED → CHOSEN" at the top of this file.

Deleted with them: `ENV_SURFACE_CHROMA`, `ENV_SURFACE_CHROMA_PROD`, `ENV_BORDER_CHROMA`,
`surfaceMixAmount()`, `borderMixAmount()`, `isProductionTheme()`, and `bandColor` /
`--rollout-theme-band` (which existed only to hold the old 90% mix once the surface was
solved to something stronger — with the 90% mix back on `surfaceColor` it was the same
value under a second name, and no CSS ever read it).

**DO NOT SOLVE THIS AGAIN.** The four rounds above are the evidence that the premise, not
the values, was wrong. Every one of them was a locally correct fix to a measured problem,
and the aggregate was a palette the human liked less than the one we started with.

### The two rule collisions this creates, and where each is resolved

Two of the four seeds share a hue family with a status colour. That is real, and it is why
the redesign moved them. **It is not a reason to move them again: identity is now FIXED, so
each collision is a constraint on the STATUS mark, and is resolved there.**

**1. `prod #d97706` is amber — the `stuck` alarm's family. Resolved by moving `rank` off
amber.** Production's chip ink is `#b26205`, OKLCH hue 58.3 / chroma 0.135. `amber-700`,
the ink `rank` (`−N`) printed in, is hue 45.4 / chroma 0.158. On an `/apps` row those two
render as **adjacent halves of one box** — `PROD` on a cream fill, then `−4` on white, 1px
apart, 12.9° of hue between them. At 11px that is one colour saying two things, one an
identity and one a state.

`rank` is now **`red-700` / `red-400`** — 29.8° from prod's ink at 1.5x its chroma, and a
hue the budget already owns. **Zero new colour values.** What it costs: `diverged` prints
in the same red, so hue no longer separates "N behind" from "off the release line". That is
accepted — the two words share nothing lexically, and the hue was carrying "adverse" for
both. One hue for the whole adverse half of the rank vocabulary is FEWER colours.

⚠️ **THAT ARGUMENT MEASURED ONLY THE INK CHANNEL, AND SINCE THE CONVERGENCE-BAR CHANGE THE TWO
CHIPS SHARE A 1px SEAM.** `[PROD][STUCK]` is one joined box on `/apps`. Re-measured 2026-08-27,
composited through the real ancestor stack, with the CURRENT `border-amber-500 bg-amber-400` alarm:

| channel | `prod` identity | `alarm` | ΔH | contrast across the seam |
|---|---|---|---|---|
| light border | `#f1cea5` C 0.0668 H 71.2 | `#fe9a00` C **0.1728** H 65.4 | **5.8°** | **1.43:1** |
| light fill | `#fcf5ed` C 0.0131 | `#ffb900` C **0.1712** | — | 1.59:1 — **13.1x the chroma** |
| dark border | `#755634` C 0.0639 H 67.9 | `#bb4d00` C **0.1583** H 45.4 | **22.5°** | 1.33:1 |
| dark fill | `#28282a` C 0.0048 | `#7b3306` C **0.1126** | — | 1.62:1 — **23.5x the chroma** |

**The colour audit reported this seam at ΔH 9.8° / 1.16:1 and recommended moving the alarm out of
the joined box. Both halves of that are now stale.** It was measured against the pre-badge-pass
`border-amber-400`; the border contrast is **1.43:1, +23%**, and what separates the two halves is
CHROMA — 2.6x on the border and **13.1x / 23.5x on the fill** — which is precisely the mechanism
this file names as the reason `alarm` is the only chip with a FILL. And the geometry move is
refused: `[identity][state]`, two sections, is the human's own instruction of 2026-08-27, and
splitting `stuck` out would give one slot two geometries — `[STAGING][FAILING]` joined beside
`[PROD] [STUCK]` loose. **Do not move it. If the seam ever needs more, spend it on the fill.**

The alarm ceiling holds, and by a wider margin than the magenta palette managed. Measured
on `/apps` at 1440, presence = `area×fillC + area×0.28×inkC + perimeter×borderC`:

| chip | fill C | ink C | border C | dot C | presence | light | dark |
|---|---|---|---|---|---|---|---|
| `stuck` (alarm) | 0.1200 | 0.1120 | 0.1890 | 0.1880 | **206.7** | — | 156.2 |
| staging | 0.0180 | 0.2099 | 0.0931 | — | 110.1 | — | 105.5 |
| prod | 0.0131 | 0.1348 | 0.0668 | — | 49.0 | — | 46.8 |
| dev | 0.0137 | 0.1456 | 0.0689 | — | 45.0 | — | 42.3 |
| `−4` (`rank`, red) | 0 | 0.2130 | 0.0060 | — | 32.4 | — | 31.7 |

The alarm is **1.88x** the loudest identity in light and **1.48x** in dark (the magenta
palette managed 1.32x / 1.48x). `−4` is 6.4x quieter than the alarm, so a merely-trailing
environment cannot out-shout a stuck one. **That ratio is still the ceiling: if a future
change pushes any identity mark past the alarm, back it off.**

Staging is the loudest identity and prod sits mid-pack. Three rounds were spent trying to
invert that. It is the human's own palette and it is not a defect.

**2. `dev #16a34a` is a green — the `Succeeded` family.** dev is OKLCH hue 149.2;
`green-700` is 149.0. Same hue, and it stays.

⚠️ **CORRECTED 2026-08-28: it is not the same hue, it is the SAME VALUE.** The seed is
`#16a34a`, but the seed is not what the chip prints — `PRESET_RAMPS.dev.textColor` is
`#008236`, and `#008236` **is** `green-700`, byte for byte the token the status glyph, the
status dot and the verdict ring print in. Measured in-browser they co-occur 447 times on
`/activity` and 219 times on `/`. The `utils.test.ts` guard below covers the chip's FILL,
which is a different channel. **SHAPE carries 100% of this separation, not most of it.** Not
changed — the seeds are closed and any move reaches `/` and `/rollouts`. Full census under
"THE FOURTH NORM-DRAWING OBJECT IS CUT" at the top of this file.

**The rule moved: "there is exactly ONE green" is now "there is exactly one green FOR
STATE; identity is a separate axis, told apart by SHAPE."** They are never the same mark —
the success green is a filled disc or a check ring, with no border and no text; an env chip
is a bordered rectangle that always prints its own name. Guarded by a test asserting the
dev chip's FILL is nowhere near the disc's ink (`utils.test.ts`).

**✅ CLOSED 2026-08-25 — the residual this section used to name is fixed.** A healthy
`/apps` status dot was `green-700`, so inside a joined box `[● DEV]` read as one green object
while `[● STAGING]` and `[● PROD]` read as two-part ones. `STATUS_DOT_CLASS` now splits the
settled states on LIGHTNESS instead of hue: `gray-500 / gray-400` is a deploy that succeeded,
`gray-200 / gray-700` is an empty slot. Green is spent on state only where state is the
deviation. `FleetStrip` reuses that map character for character, which is why the strip cost
zero colour values.

## The closed budget — read this before adding any colour, shape or type role

Established 2026-08-22 with the Deploy Board rebuild of `/apps/[name]`. Before that
rebuild the app page measured **37 distinct colour values across 8 hue families, of which
2 carried meaning; 12 distinct greens; the env badge in 8 different geometries; 5 radii;
13 padding values; 7 gaps; 20 type combinations; 4 letter-spacings.** None of that was
anyone's decision. It is what a page looks like after enough correct changes.

### Colour — closed

| System | Owner | Where it may appear |
|---|---|---|
| green | `Succeeded` / healthy — **for STATE** | status glyph, status dot, verdict ring |
| blue | `Deploying` | status glyph |
| yellow | `InProgress` / baking — **baking only** | status glyph |
| red | `Failed`, **`diverged` AND `rank` (`−N`)** | status glyph; the `rank` and `diverged` chips |
| amber | `stuck` — **and nothing else, for STATE** | the `alarm` chip |
| gray | everything passive — **and `head`, `count`, `unranked`** | text, borders, surfaces, every non-adverse chip |
| quiet mint | **"on the build in question"** — `#426d64` / `#83b0a8` | the `newest` chip's text; the `live` segment of `CoverageBar`; the newest segment of `ExposureBar`. Nowhere else. |
| green / violet / amber / cyan | env IDENTITY | `<Chip role="env">` only, via the `--rollout-theme-*` vars |

**Two of the identity hues are also status hues, deliberately, and are separated by SHAPE
rather than by hue** — see "THE ENV PALETTE IS CLOSED" at the top of this file. `rank` is
red, not amber (top of file).

**There is exactly ONE green FOR STATE:** `green-700` light / `green-400` dark. Not
`green-500`, not `green-600`, no `emerald-*`. `BakeStatusIcon`, the status dot and the
verdict ring use the same value on purpose. The env identity ramp's `dev`
seed `#16a34a` is the same HUE as this green and is a separate axis: a state green is a
filled disc or a ring, an identity green is a bordered rectangle printing its own name.

**`newest` IS COLOURED AGAIN, AND IT IS NOT THAT GREEN (2026-08-26).** ⚠️ **The VALUES below
are superseded — see "`newest` IS LOUDER, AND THE HUE DID NOT MOVE" at the top of this file.
It is `#426d64` / `#83b0a8` now. The two arguments below still hold; only the mix amount and
the published ink ratio changed.** From the human:
*"I changed my mind on newest chip. We probably want to mark it with some color just not to
be so prominent"*. It was gray. It is now `#56766f` / `#8eada7` — `green-700`/`green-400`
mixed 75% / 83% into the grays it used to be, so it is derived from two values the product
already owns. Full-chroma mint (`emerald-600`) was tried first, because `HANDOFF.md`'s own
word for this chip is "mint", and it failed two measurements:

- **It inverts the hierarchy.** Both halves of the rank vocabulary are text-only in one
  face, size and weight, so ink is `characters x chroma` and the glyph-coverage constant
  cancels. `NEWEST` is 6 characters, `−4` is 2. Mint's `6 x 0.1274 = 0.764` against
  `red-700`'s `2 x 0.1905 = 0.381` makes the NORM twice the ink of the DEVIATION.
- **It is a third green in one row.** `emerald-600` is at OKLCH hue 163.2; DEV's identity
  ink is 149.5 and the `Succeeded` glyph is 150.1, at comparable chroma.

The shipped value measures C 0.0384 / 0.0351, so the ink ratio `−N : newest` is **1.66x
light / 1.58x dark** — the deviation stays dominant. It sits dOKLab 0.045 / 0.038 from the
plain gray it replaces (~2x the JND, so it reads as coloured) and dOKLab 0.114 from DEV's
chip ink at 30 degrees of hue and a 3.8x chroma gap. `alarm` is still ~66x louder than it
and is still the only chip with a FILL (the glyph was deleted 2026-08-27).

> **⚠️ SUPERSEDED 2026-08-25 — see "THE ENV PALETTE IS CLOSED" at the top of this file.**
> Everything from here to the end of the "Identity presence" discussion describes the
> chroma-solved derivation and the rust/magenta seeds, ALL OF WHICH ARE REVERTED. It is
> kept because it is the record of four rounds that were each locally correct and
> collectively wrong, and that is the thing a future agent needs in order not to repeat
> them. **None of the constants, seeds or formulas named below exist in the code any more.**

**Identity presence: the three peers are equal, production is above them (2026-08-25).**

This took two passes and the first one was half a fix. Recording both, because the failure
mode is subtle and will otherwise be repeated.

**Pass 1 (2026-08-24) — surfaces solved to constant chroma.** The four env surfaces were a
fixed 90% white mix of the seed, which equalises the RECIPE and therefore not the RESULT:
the seeds differ in chroma by 2.4x, so surfaces came out spanning 0.0029 (prod) to 0.0251
(staging), an 8.6x spread. Solved to a constant **0.030 OKLCH chroma**
(`ENV_SURFACE_CHROMA`), measured after at 1.02x spread.

**Why that was not enough.** A chip paints with THREE colour channels, and only one had been
equalised. Ink and border still derived their chroma from the seed, so prod — a dark,
low-chroma rust against a bright, high-chroma violet — stayed the faintest chip in the set
on both remaining axes: ink 47% of staging's, border 39%. The human's verdict was
*"I don't like the new color for prod. It's too faint."* **Equalising one channel of three
makes a thing look solved while leaving it quiet everywhere it actually reads.**

**Pass 2 — the measurements that decided the shape of the fix.**

1. **The ink axis cannot be equalised upward.** `mixWith` toward white or black is a
   CONTRACTION in chroma: the most chromatic value any seed can produce is the seed itself.
   So a constant ink chroma is reachable only DOWNWARD, bounded by the least chromatic seed
   (dev teal, 0.1038) — i.e. by halving staging to fix prod, spending the page the human
   likes on a problem it does not have.
2. **Prod's ink is independently capped by the `Failed` red adjacency.** A gamut search over
   hue 33–58° found nothing that raises prod's ink past ~0.116 while holding 16 dE00 from
   red-700. Ink is not a channel prod can grow in.
3. **Constant presence across all four is INFEASIBLE.** Solving the surface so every chip
   hits the same presence makes dev and test fail the 4.5:1 small-text floor at every target
   ≥ 70, because their inks are light (L ~0.52). Measured, not assumed.

So the system is **not** "all four equal". It is **the three peers equal, and production
deliberately above them** — which is the right answer anyway: environments are not peers,
prod is where a mistake costs money, the human has asked twice for it to read as danger, and
the product's own rule is to mark the deviation rather than the norm. Among environments,
**prod IS the deviation.**

**What changed, and where each channel's presence comes from.**

| axis | before | after | note |
|---|---|---|---|
| seed | `#7c2d12` | **`#8f3b00`** | hotter (C 0.117 → 0.128) AND 19.0° from red-700 instead of 10.7° |
| border | fixed 64% white | **solved to `ENV_BORDER_CHROMA` 0.093** | all four; the one axis that IS equalisable |
| surface, peers | solved 0.030 | solved 0.030 | unchanged |
| surface, prod | solved 0.030 | **solved `ENV_SURFACE_CHROMA_PROD` 0.075** | the fill is prod's only available channel |
| ink / darkText / darkSurface | fixed mixes | unchanged | |

The FILL is where prod's presence had to come from: it is 100% of the mark's area rather
than 28%, it has **no red adjacency at all** (red is never a fill in this product —
`diverged` is text-only, `Failed` is a glyph), and prod's dark ink had 7.7:1 of contrast
headroom to spend where dev and test have 4.4:1.

Measured on `/apps` at 1440 light, presence = `area×fillC + area×0.28×inkC + perimeter×borderC`:

| | fill C | ink C | border C | contrast | presence | vs alarm |
|---|---|---|---|---|---|---|
| dev | 0.0222 | 0.0889 | 0.0501 → **0.0928** | 4.41 | 42.6 | 4.79x |
| test | 0.0217 | 0.0955 | 0.0534 → **0.0927** | 4.36 | 51.4 | 3.97x |
| staging | 0.0227 | 0.2099 | 0.0931 → 0.0915 | 6.66 | 113.8 | 1.79x |
| **prod** | 0.0213 → **0.0528** | 0.0994 → **0.1101** | 0.0360 → **0.0932** | 4.69 | **137.9** | **1.48x** |

Border spread 2.59x → **1.02x**. Prod went from **0.57x staging to 1.21x** — the loudest
identity mark — and the `stuck` alarm is still **1.48x louder than prod**, so it remains the
loudest mark on any screen. That ratio is the ceiling: **if a future change pushes any
identity mark past the alarm, back it off.**

✅ **CLOSED 2026-08-27 — see "COMPUTED → CHOSEN" at the top of this file.** The two failures below
are fixed, and not by lightening the surface a few points: the whole computed derivation was replaced
with chosen Tailwind steps, `prod` is **8.83:1** and `dev` **4.81:1** now, and `mixWith` is off the
preset path. The table is kept as the record of the defect.

⚠️ **THE CHIP CONTRASTS THIS FILE PUBLISHES ARE OPTIMISTIC, AND TWO IDENTITIES WERE UNDER THE
FLOOR. Measured 2026-08-27 over each chip's OWN FILL** (the file's numbers were computed against a
different ground), at the shipped 10px:

| chip | ink on its own fill | this file records | verdict |
|---|---|---|---|
| **`prod`** | `#b26205` on `#fcf5ed` = **4.18:1** | 4.69 | **FAILS** 4.5 for 10px |
| **`dev`** | `#12863d` on `#eef9f2` = **4.33:1** | 4.41 | **FAILS** 4.5 for 10px |
| `test` | `#077792` on `#edf7f9` = 4.75:1 | 4.36 | passes |
| `staging` | `#6630c2` on `#f6f1fe` = 6.86:1 | 6.66 | passes |
| `alarm` | `#7b3306` on `#ffb900` = 5.26:1 | 5.26 | passes |

⛔ **THE PRESCRIPTION IN THIS PARAGRAPH WAS WRONG AND WAS NOT FOLLOWED.** It read: *"the fix is not
the seed — it is the SURFACE, a fixed 90% white mix … lightening the two surfaces by a few points
raises both over 4.5 … whoever next has the mandate to edit that file should do exactly that and
nothing else."* Lightening the mix would have moved two more numbers that nobody chose. The mandate
that arrived instead was to stop mixing: **the fix is that `borderColor`, `surfaceColor`, `textColor`,
`darkSurfaceColor` and `darkTextColor` are CHOSEN Tailwind steps now, in both themes.** The seeds are
untouched. See the top of this file.

**Two things that must not be "fixed" later.**

- **Prod's surface is darker than its peers** (L 0.640 against 0.91–0.94) and that is wanted
  — it is where the presence lives. Lightening prod back toward the others takes its chroma
  down with it and re-opens this exact defect, twice over.
- **Raising prod's chroma is only safe because `#8f3b00` moved AWAY from red at the same
  time.** Presence and hue separation moved together, deliberately. Verified by eye at 1440
  and 390 in both themes on `/apps` and `/environments`, where a `diverged` chip renders 4px
  from a prod chip: prod is a filled terracotta box, `diverged` is bright red text on white.
  Fill-vs-no-fill does more work than hue here. **If `diverged` ever gets a fill, or if prod's
  hue drifts back toward 38°, this adjacency stops being safe.**

**DARK MODE IS STRUCTURALLY DIFFERENT, and prod cannot be fixed there from this file.**
Measured: the dark chip fill is `color-mix(--rollout-theme-dark-surface 28%, transparent)`
over the card ground `#1e2939`, and **that ground is itself chromatic — C 0.0335 at hue
257.7°, i.e. blue.** A warm identity at 28% alpha CANCELS against it (prod's rendered fill
tops out at 0.0207, and its hue swings through 358°/334°/303° — it is crossing neutral),
while violet staging ADDS to it (0.0502). No choice of `darkSurfaceColor` fixes this; the
sweep is in the commit. So in dark, prod gained only what the hotter seed gave it —
label chroma 0.0612 → **0.0762**, dE00 vs `gray-400` 22.3 → **24.3** — and sits at 56.2
presence against staging's 131.7. **The fix, if wanted, is one line in `app.css`**
(`.dark .chip-env` needs a higher alpha or an opaque fill so a warm identity survives the
blue ground); it is out of reach of `environment-theme.ts` and was not attempted here.

Everything is solved, not tabulated, so a customer-named env with a `theme-color` annotation
gets the same treatment — including the production targets, because `isProductionTheme()`
matches on the NAME and "is this production" is a fact about the name.

⛔ **STALE — `bandColor` / `--rollout-theme-band` DO NOT EXIST.** They were deleted with the
chroma-solved derivation on 2026-08-25: once `surfaceColor` went back to the fixed 90% white
mix, `bandColor` was the same value under a second name and no CSS ever read it.
`app.css`'s `.environment-theme-band` reads `var(--rollout-theme-surface)` and that is now
correct rather than a bug to fix. The paragraph below is kept only for the AREA argument,
which still holds. **Do not "restore" the variable.**

**`.environment-theme-band` keeps the OLD 90% mix**, via a separate `bandColor` /
`--rollout-theme-band`. The band paints a full-width header at 90% of the surface, and the
area rule says loudness is area x chroma: a stronger surface is right for a 20px MARK and
wrong for a FIELD in the thousands of px². As of 2026-08-24 the band renders on none of
`/`, `/rollouts`, `/apps`, `/apps/[name]`, `/environments`, `/envs/*` — its only call site
is `PromotionNode.svelte` — so the variable is exported and ready but `app.css:94` still
reads `var(--rollout-theme-surface)`. **If the band comes back, change that one line to
`var(--rollout-theme-band)`** or it will render a large warm field on `/envs/prod`.

**Fuchsia is FREE (2026-08-24).** It belonged to the Ember version ramp, which was deleted
along with the Gantt — see the tombstone below. For the first time since this budget closed
there is one unowned hue family. Spend it deliberately: the reason prod spent months as an
invisible slate was that no warm family was available, and several designs were bent around
"there is no spare hue". If you take fuchsia, record here what it now means.
(Prod itself no longer needs it — it took orange #8f3b00, see "Env identity ramp
(global)" below. Fuchsia is still free.)

**Trade recorded 2026-08-23 — `diverged` takes red from `Failed`.** The drift vocabulary is
`up to date / N behind / diverged`, and the third had no rendering at all: an environment
running a build that is on no environment's release line printed `−7` and read exactly like
one that is seven promotions behind. Those are different problems — seven more promotions
reach the second and never reach the first — so the rank chip needed a third form.

There was no spare hue, so it took an existing owner's. Red, because `Failed` and `diverged`
mean the same thing at the volume a chip speaks at: *adverse, and it will not clear on its
own*. The same product red, `red-700` light / `red-400` dark — no new value.

Two constraints held it under `stuck`:
- the chip is **text-only**, the `rank` geometry exactly. `alarm` remains the only chip with
  a FILL, which is what the spec names as the mechanism that makes it loudest. (It had a
  glyph too until 2026-08-27; see the top of this file.)
  Fill area: `alarm` ~1,000px² of amber-200, `diverged` 0.
- it never claims a row's ONE filled primary. `promotionBlock` returns empty for a diverged
  environment (its build is not in `availableReleases`, so the lag is unknowable), which
  means no `Promote` is offered on it either — a diverged environment cannot be promoted
  forward and the page does not pretend otherwise.

**FALSE POSITIVES ARE THE WHOLE RISK, and `compareRollouts(...).kind === 'divergent'` is
NOT the predicate.** That one compares two `status.history` arrays whose limit is 5, so it
returns `divergent` for any pair whose windows merely fail to overlap — `rollout-cards.ts`
already carries the post-mortem ("the further behind a rollout falls, the more certain it is
to age out of its peers' history, return 'divergent'"). Measured on the live cluster it calls
`hello-world-app`'s prod diverged, which is 4 builds behind and perfectly on the line. The
page uses `divergedFromLine` instead: off every environment's `availableReleases` **and**
deployed at or after the oldest release that line still remembers. A build older than that
window merely aged out, which is "unknowable" and already renders as no chip at all.

### ONE STATUS MARK, ONE BUILD BADGE, ACROSS EVERY PAGE (2026-08-25)

> *"version redesign is half broken and not at all premium looking and consistent with the
> rest of the pages that are properly implemented."*

Several agents each polished one page and **nobody owned the vocabulary ACROSS pages.**
The same object had five shapes. `/apps` is the reference — it went through the most rounds
and the human stopped objecting to its structure — and the other pages are now converged
onto it.

**The status mark, before → after** (measured at 1440, light). ⛔ **The `/apps` and `/versions`
rows of this table are SUPERSEDED 2026-08-27: neither page has a per-environment status dot at
all any more, and `/versions`'s Revision cell is the sha's box on its own. The rows that
describe LOOSE dots elsewhere — `/rollouts` filter pills, `/`'s section headings,
`/envs/[name]`, `/environments` — are untouched and still binding: those dots are not
per-environment marks beside a badge, they are a section/filter/row glyph, and the human's
objection was to the badge-adjacent one.**

| page | before | after |
|---|---|---|
| `/apps` | `5x5 r=4px`, a HALF of the joined box | unchanged — this is the reference |
| `/versions` | `2px` square, loose, in a 12px gutter track | `5x5 r=4px`, a HALF of the joined box |
| `/envs/[name]` | `5x5 r=4px` loose | unchanged (loose is argued, below) |
| `/environments` | `5x5 r=4px` loose | unchanged (loose is argued, below) |
| `/rollouts` | `6x6 rounded-full` in the filter pills | `5x5 r=4px` |
| `/` | `8x8 rounded-full` on section headings | `5x5 r=4px` |

**Loose vs joined is the ONE difference that is allowed, and only on the pages that earn
it.** ⛔ **SUPERSEDED 2026-08-27 — `Chip role="status"` DOES NOT EXIST and there is no
per-environment status dot on any page. See the top of this file.** It used to be a half of a
box on `/apps` because a row there carries 3–13 environments and the dot had to say WHICH. An `/envs/[name]` or `/environments` row is one
subject, so the dot has one possible referent and needs no common region. **That argument
licenses the GEOMETRY and nothing else — size, radius and palette are `5x5` / `4px` /
`green-700` on every page without exception, and a future change may not vary them.**

**The build badge.** Four pages drew "a rank and the build it describes" without the shared
`Chip`, and three of them put the anchor row in a *different geometry from the row below
it*:

| page | before | after |
|---|---|---|
| `/rollouts` | hand-rolled `rounded-md` box, 10px bold label half with a `green-100`/`amber-100` FILL | `Chip` — 4px, text-only |
| `/versions` list | bare mono sha, no box | `Chip role="status"` + value |
| `/envs/[name]` | joined badge on the trailing row, **bare mono sha on the rest**, plus a caption explaining the absence | `head` / `rank` / `unranked` — one box, the WORD varies |
| `/environments` drift | same split, same caption | same fix |
| `/versions/[slug]` | `VERSION LABEL` and `RANK` in two adjacent tracks, both bare text | one joined badge; the denominator (`of 37`) follows as dim prose |

**A page that needs a legend to explain a missing element is a page whose encoding is not
carrying.** Both "no rank chip means…" captions are deleted. This does NOT re-mark the
norm: `head` is the same gray as `count` and `unranked`, so the only coloured token in any
of those columns is still the deviation.

**Measured after, all six pages:** exactly ONE chip geometry product-wide —
`h20 · r4px · p0/6px · fs10px · fw600 · ls0.8px` — and exactly TWO radii, `4px` and `12px`,
plus `rounded-full`. `/rollouts` lost a stray 6px; `/` lost nine 8px.

### The joined build badge — one chip, one build, one box (2026-08-23, from the human)

> *"On both app list and detail, newest badge should look like on rollout list. There's also
> redundant version usually there so you need to make sure to remove it and place the newest
> badge appropriately."* … *"Homepage has to also use the same badge. We currently display that
> data but not the same way."*

A rank chip and the build it describes are ONE fact. `/rollouts` has always drawn them that way —
`newest` and `9a1f4c2` as adjacent siblings inside a single bordered box, measured 123x23 — and it
is the page the human keeps naming as the one that is right. Three pages had the same two facts in
two places:

| Page | Before | After |
|---|---|---|
| `/apps/[name]` ledger | `newest` chip in a 76px RANK column, sha in a 96px BUILD column, 12px and a column boundary apart | one 152px BUILD column, `Chip` with `value` |
| `/apps/[name]` Builds table | `−N` chip in an 84px RANK column, sha in a 104px SHA column | same 152px column, same component |
| `/apps` row | no badge at all; `newest` as prose twice per row plus the sha printed a third time | one joined badge per row |
| `/` Steady + Trailing cards | 10px mono sha, then a bare 9px uppercase word (`newest` green, `pending`/`behind` gray) in a type role that is not in the scale | same joined badge |

**It is `Chip`, not a second badge.** `Chip` grew a `value` prop; the geometry still lives once in
`.chip` / `.chip-joined` / `.chip-value` in `app.css`. The chip half drops its right border and its
right corners so the seam between the halves is 1px and the outer corners are the chip's 4px —
that is what makes a pair read as one object instead of two things that touch.

**What is deliberately NOT copied from `/rollouts`:** its colour and its radius. That badge fills
`green-100` inside a `green-200` border at `rounded-md` — three greens against this budget's ONE and
a sixth radius against the legal two. The STRUCTURE is what the human was pointing at. Ours keeps
the role colour on the chip half (`green-700` / `red-700` / `gray-500`, text-only) and neutral ink on
the value half. Measured: unit 116-123x20 against the reference's 123x23, chip 54x20 against 62x21,
value 11.5px mono against 11px, `parentText: "newest 9a1f4c2"`, `siblings: ["newest", "9a1f4c2"]` —
the same two-sibling structure the reference has.

**It is N halves, not two (2026-08-25).** `.chip-joined > .chip:not(:last-child)` drops the
right edge; `.chip-joined > .chip + .chip` drops the left corners. Two halves or four, the seam
rule is stated once. This was forced by the `/apps` convergence bar (below) and is the reason
that row did not get a second grouping mechanism of its own. `chip + .chip-value` is unchanged
and measured identical after: `newest 9f10e49` 116.4x20, seam 0px, radii `4px 0 0 4px` /
`0 4px 4px 0` on `/`, `/environments`, `/envs/*` and `/apps/[name]`.

### The `/apps` convergence bar — one BOX per environment (2026-08-25, from the human)

> *"I don't like on the app list page that dots are separated from the env badges and then we
> also have an extra badge for how much behind something is. It's not immediately obvious what
> is connected to which environment."*

Measured, and the complaint is a proximity measurement. The row drew `● DEV ● STAGING ● PROD −4
● STUCK` as equal siblings. Ink to ink at 1440: dot → its own env chip **11px**, env chip → the
NEXT env's dot **15px** — 1.36x, where Gestalt proximity needs ~2-3x before the eye groups at
all. Worse, the env chip → its own rank chip gap was **18px**, WIDER than the 15px to the next
environment. `−4` was literally closer to the environment it was not about. Ratio against the
worst within-group gap: **0.83 — inverted.**

The fix is common region, not more whitespace: the env chip, its rank half and its alarm half
are now ONE `.chip-joined` box, so there is no whitespace inside a unit to compare against the
whitespace between units. The status dot stays OUTSIDE the box, immediately left, the way
`/rollouts` places its status disc — it does NOT move inside the env chip, because an env chip's
rendering is a function of the environment's NAME alone and `alarm` is the only chip allowed a
fill AND a glyph. Both invariants would have had to fall to save 4px.

⛔ **SUPERSEDED 2026-08-27. The dot is DELETED — not moved into the box, not moved beside it.
The badge's second section carries the state as a WORD (`[PROD][STUCK]`). Everything above is
kept because the PROXIMITY MEASUREMENT is still the reason the mark row is `gap-x-4
sm:gap-x-6` rather than `gap-x-2`.**

| | dot → chip | env → rank | between envs | ratio |
|---|---|---|---|---|
| before | 11px | 18px (gap) | 15px | 1.36x / **0.83x** |
| after, >= sm | 11px | 13px (**shared border, 0px gap**) | 31px | **2.82x** / 2.38x |
| after, < sm | 11px | 13px (shared border) | 23px | **2.09x** / 1.77x |

**Between units is 24px, and 16px below `sm`.** 24px is free on desktop: the widest fixture row,
`edge-mesh` with 13 regions, wraps to the same 3 lines at 24px, 16px and 12px, because what wraps
it is chip WIDTH. At 390 it is not free — 24px pushes `checkout-edge`, the row that is actually
stuck, from one line to two, while the 9- and 13-env rows wrap identically either way. Spending a
line on the one row that needs a person is the wrong trade.

**Nothing about "mark the deviation, never the norm" changed.** A converged environment renders a
one-half box, character for character the chip it rendered before. Measured after: one green
value on the page (`rgb(0,130,54)`, 40 elements), radii 12px / 4px / `rounded-full` only.

### `newest` is a RANK WORD. It never names a build. (2026-08-25, from the human)

> *"On app list, it doesn't really make sense that we put newest on the right hand side when prod
> is clearly not on the newest."*

**The one meaning, product-wide: `newest` is a verdict that the SUBJECT OF THE ROW OR CARD — an
environment, or a build — is at rank 0 on its app's ladder.** It is never a caption naming a build.

The joined badge is a RANK plus the build it ranks, and every page held that except one. `/` prints
`newest` / `−N` / `behind` / `pending` for that card's environment; `/rollouts`, `/versions` and
`/apps/[name]` likewise. `/apps` used the identical geometry for a CAPTION — `newest` was not the
rank of anything the row is about, it just named the value beside it. So a reader who had learned
the badge anywhere else read the row as "on newest" while its own bar said `PROD −4 STUCK` and the
line directly beneath it said `PROD is stuck`. The page's good-news word, in its ONE green, over
the row's own headline.

`/apps` now says **`head`**, in the same gray as `rank` and `count`. A noun for the anchor cannot
be read as a verdict on an environment, and the anchor was never a health fact, so it should never
have been carrying the green. New `Chip` role `head`; **zero new colour values** — it reuses the
`rank` gray exactly. Measured after, at 1440: the word `newest` appears **0 times** in `/apps`
rendered text, greens 40 → 28 elements at the same single value.

**Why this is not an inconsistency with `/rollouts`.** Same argument that put ONE badge on the row
instead of N: a `/rollouts` card is one rollout in ONE environment, so `newest` there is a true
statement about that card's subject. An `/apps` row is N environments and has no single rank to
report. `newest` did not become wrong — it became *inapplicable at this scope*.

**A latent bug went with it.** `newestVersion` was "the first environment, in tier order, that has
a version" — DEV's build, called the newest. An app whose dev was pinned, diverged or simply behind
printed a badge naming a build that was not the head, beside `−N` chips measured against one that
was: two denominators on one row, the exact defect the `−17` vs `−19` round closed. It is now
`buildLadder(...).builds[0]`, which is the same array `rankOf` indexes into, so the badge and every
`−N` in the bar share one anchor by construction.

**Audited, not fixed:** `/envs/[name]` uses `newest` in PROSE for the anchor sense ("all N rollouts
here are on their newest build", stat label "Behind newest"). It is defensible there — each row is
one app in one environment, so each has its own rank-0 build — but it is the anchor sense, not the
verdict sense, and if that page is next to be touched it should say `head` too.

**The reconciliation with "mark the deviation, never the norm".** That rule deleted twelve green
per-environment `newest` chips from `/apps` last round, and it still holds. A `/rollouts` card IS one
rollout in ONE environment, so its badge is a per-environment fact; an `/apps` row is N
environments, which is exactly what multiplied the mark. So `/apps` gets **one badge per ROW**,
describing the app's newest BUILD — a single fact about the row, so a single mark. Per-env rank
chips stay deviation-only. Measured on `/apps` at 1440: green elements 37 → 43 (+1 per row, all one
value, `green-700`); the word `newest` per row 2-3 → 1; the current sha printed per row 1 → 1.

**The prose that the badge made redundant is gone.** `every env on newest` (the converged lead) now
prints nothing at all — a quiet row is what convergence looks like. `N of M on newest · N envs`
became `N envs`, the one thing neither the badge nor the bar states in words. `TRAILS NEWEST BY N`
became `is N builds behind`, because the badge already owns the word and it was naming a different
environment.

**Cost, measured and accepted.** A bordered unit costs 24px of internal padding that a loose
sha-plus-word pair did not. On `/` at 1440 that pushes 5 more of 29 card names into ellipsis (9 → 14);
at 1280 all 29 were already truncated before the change (4-column grid, 258px cards) and at 390 none
are. The ledger and Builds table absorbed it inside tracks that were already carrying dead width:
BUILD + RANK were 96 + 12 + 76 = 184px and the merged column is 152px, so the state cell — the only
track on the row that holds a sentence — gained 32px.

### Colour goes on MARKS, never on PROSE (2026-08-23, from the human)

> *"Apps list has too many colors. I generally don't like colored text unless it's important.
> Green in particular is sometimes too much in our designs. Rollout list is nicely done."*

The refinement to "colour only where something needs a person": **a coloured sentence is the
loudest thing a page can do, and almost nothing earns it.** Colour belongs on chips, discs,
glyphs and rings — objects small enough that their loudness is bounded by their size. Prose
stays neutral ink at every state.

`/rollouts` was already built this way and is the reference: every sentence on it (rollout
name, sha, `24d ago`, `updated`) is neutral, and all of its colour is in marks. `/apps` was
not: it painted three summary SENTENCES per screen — `1 needs attention` (red-600, chroma
0.245), `PROD is stuck` (amber, 0.179) and `✓ every env on newest` (green, 0.154) — the last
of which spent the page's loudest treatment on the single least important fact on it.

Measured on `/apps` at 1440, live fixture, before → after: coloured text nodes (oklch chroma
≥ 0.05) **24 → 9, and all 9 that remain are chip labels — zero coloured prose**, against 27
on `/rollouts` which are likewise all chip labels. Green elements **29 → 16**; green text
nodes **14 → 0**; green ink (area x chroma) **~601 → 313 px²**, versus 3,030 px² on
`/rollouts`.

Two structural rules came out of it, and both must stay:

- **Mark the deviation, not the norm.** `/apps` printed a green `newest` chip per
  environment per app — 3 envs x 4 apps is twelve green chips saying "fine". A converged
  environment now renders its identity chip and NOTHING else; only `−N`, `held` and
  `pending` print a rank chip. `/rollouts` gets away with far less green because one card is
  one environment; a list whose row is N environments must not multiply the same mark by N.
  An env with no rank chip is on the newest build. **The legend that used to say so is
  DELETED** (2026-08-26, from the human — see "THE RULER TEACHES ITSELF"); the encoding is now
  carried by the column header, the head chip and the row caption, which are all real objects
  on the row rather than a dummy graphic under it.
- **When a state is genuinely urgent, spend a MARK on it, not a sentence.** `stuck` moved
  out of amber prose and into the shared `alarm` chip, rendered in the same cluster as the
  env chip it is about. The `bg-amber-100` disc behind the row glyph went with it: a
  ~1,018px² amber field cannot sit on a page whose loudest object is supposed to be a
  1,142px² chip at higher chroma. A stuck row now shows its true bake glyph and carries the
  alarm in the chip, exactly as `/apps/[name]` does.

A count in a PAGE header is a summary of marks that are already on screen, so it is neutral:
`N needs attention` no longer prints red on `/apps`. `/rollouts` colours the same phrase in
its NAMESPACE headers, where it labels the group of cards directly beneath it — that is a
local label, not a page-level restatement.

`--color-primary-*` and `--color-secondary-*` (coral `#fe795d`/`#ef562f` and sky) get **no
role inside `<main>`, on any page**. They are the flame family the human rejected, and
coral sits between `Failed` red and `stuck` amber where it can only cause a misread.
Confine them to the logo and nav chrome.

### Ember, and the Gantt — REMOVED 2026-08-24. Do not rebuild either.

Both are gone. `lib/ember.ts`, `lib/components/VersionGantt.svelte` and
`lib/view-models/gantt.ts` were deleted; version rank became **row position** in the
Promotion ladder — and then the LADDER was rejected too (*"i don't like version ladder"*), so
`PromotionLadder.svelte` and `view-models/promotion-ladder.ts` are deleted as well
(2026-08-26). Three objects, one idea, all rejected on sight: **do not draw an app's whole
build list.** **The substitution outlived all of them and is the part that matters:
rank is POSITION, never hue.** `FleetStrip` is where it lives now — as run ORDER rather than
as a coordinate, since the 12-slot ruler that first carried it is itself deleted (2026-08-27). This section is a tombstone,
kept because the failure took four iterations and the evidence is the only thing that stops
a fifth.

**Version identity spent four attempts on colour and colour was the wrong channel.**

1. Categorical `VERSION_PALETTE` — 8 arbitrary hues. Killed: the single biggest contributor
   to "too many colors", and its crayons collided with the status hues.
2. Ember ordinal ramp filling the lane. Killed: measured **47,166px² of saturated magenta
   against the `stuck` chip's 1,142px² — a 41:1 inversion** of the rule that nothing may
   out-shout the alarm.
3. Ember on a 3px rank rail. Killed: the rails computed to **0.1–0.6px** on busy lanes. The
   encoding was invisible; three identical gray bars.
4. Ember back in the fill at 28% chroma. Killed by measurement: adjacent ranks are
   **dE00 1.92 / 1.70 / 1.81 — below the ~2.3 JND for large fields — drawn on bars
   3.00–5.63px wide.**

**Why no fifth attempt can work.** An ordinal ramp cannot carry N distinct identities: human
discrimination gives ~5–7 steps of a single hue under ideal conditions, and a real app here
has 37 builds. Worse, the Gantt allocated ink by DURATION while attention is allocated by
EVENTS — on one measured lane, 2 of 18 deploys owned **91.6%** of the width — and a
maximally-stale lane rendered as one flat ash bar only **6.92 dE00 from an empty track**, so
the chart could not distinguish "very stale" from "no data".

**What replaced it.** Rank is row position, which is the most accurate perceptual channel
there is; hue is near the bottom. Each environment's chip is printed once, on the row of the
build it runs; the rule spanning first mark to last IS the lag, and it collapses to nothing
when everything is converged. "What changed" is the rows in between — answered by
construction, not by decoration. **Version identity now costs zero colour.**

See `DEPLOY-BOARD-SPEC.md` → "The promotion ladder" for the normative spec.

### ⚖️ THE FIELD CEILING — the alarm rule is about MARKS, and it does not govern a page's subject (2026-08-26)

> *"I generally think we're undercoloring now a bit."* — the human, standing steer.

**What went wrong, so it is not repeated.** `CoverageBar` shipped with its `live` segment at
`gray-500` / `oklch(0.551 0.027 264)`, a neutral gray, on the reasoning that a ~25,000px² bar under
10x the `alarm` chip's ~159 ink units caps the fill at OKLCH chroma 0.078, which is below
`green-200`, therefore *"there is no green that is both readable at 8px and inside the ceiling."*
The arithmetic was right and it answered the wrong question twice over:

1. **It only searched the light tints.** The legibility test was `green-100` against `gray-200` at
   8px, and at that size what separates two fills is LIGHTNESS, not chroma — which is the same
   argument that module already makes for its two grays. A **dark, low-chroma** green is legible at
   8px at a chroma the ceiling never threatens. The quiet mint the product already owns measures
   **L 0.539 / C 0.0384 / H 179.8** against `gray-500`'s **L 0.551 / C 0.0267 / H 264.3** — ΔL
   0.012, a DROP-IN in the lightness hierarchy, 84° of hue away.
2. **The ceiling it invoked was satisfied anyway.** Measured on the shipped bar at 1440: `976 × 26 =
   25,376px²`; `live` at 14 of 15 places is `23,660px²`; `23,660 × 0.0384 = 908 ink units`, i.e.
   **5.7x** the `alarm` chip's 159, or **4.8x** its fully-measured presence of ~191. Inside the same
   10x bound the gray decision was justified by.

**And the substitution was on the wrong AXIS.** The gray came from `/apps`'s `STATUS_DOT_CLASS`,
where it means `onNewest` — a RANK verdict. `Live here` is not a rank verdict; it is `Succeeded`,
and its own sibling bucket `Failing on it` is `Failed`. Painting `Failed` red and `Succeeded` gray
in one object is half an encoding. `/environments` already refuses to: `EnvHealthStrip` draws a
healthy app as a **`green-700` dash at SIX pixels tall**, shipped, on the page next door.

---

**THE RULE. `area × chroma` compared against the alarm chip is a rule about MARKS COMPETING ON A
ROW. It is not repealed — it is SCOPED.** Three things must be true for the total-ink comparison to
be the right test, and all three were true of the Ember ramp it was derived from:

1. both marks are on screen together;
2. they compete for the same fixation — the reader's next action depends on noticing the quieter one;
3. the louder one is not itself the answer to the page's question.

On `/versions/<rev>` none of the three holds. There is no `stuck` chip beside the bar; the only one
on the page sits ~90px BELOW it, inside the `Not yet` card the bar's amber segment points at — so
noticing the bar ROUTES you to the chip, which is cooperation, not competition. And the bar is the
page's whole first criterion (*"how far has this build reached across the fleet"*). An invariant
derived in one context does not automatically bind in another.

**So for a FIELD — an area mark over ~5,000px² that is itself the answer to its page's first
criterion — the quantity that must be ranked is CHROMA PER UNIT AREA, not total ink:**

- **§1 — Inside the object, adversity is always the higher chroma.** Every adverse segment must
  out-chroma every non-adverse one, by a clear margin at the rendered height. Attention inside a
  field is allocated by density; extent is already carrying the quantity. Measured on the shipped
  bar: `live` 0.0384 against `notYet` 0.1728 (**4.5x**) and `failing` 0.2086 (**5.4x**); dark,
  0.0351 against 0.1712 (4.9x) and 0.2373 (6.8x). A bar that is nine-tenths live still has its
  loudest PIXEL in the segment that wants a person.
- **§2 — Against the page, the field may not HIDE the alarm.** A field may exceed the alarm in total
  ink; it may **not** exceed it in chroma. The alarm stays the highest-chroma mark on any page it
  is on, and the only one with a FILL.

  ⚠️ **§2 WAS SATISFIED BY A TIE, AND A RULE WITH A 0% MARGIN IS NOT A CONSTRAINT. Amended
  2026-08-27.** Measured on `/versions/<rev>`: the `notYet` field is `amber-500` C **0.1728** at
  **2,920 ink units — 14.3x the `stuck` chip on the same page** — and the alarm's own peak channel
  is its `border-amber-500`, C **0.1728**. Exactly equal. The amended rule:

  > **A field's chroma must be ≤ the alarm's peak channel. Where it is EQUAL it must be the SAME
  > TOKEN; a different hue at the alarm's chroma needs a 0.8x margin.**

  The tie is permitted because it is `amber-500` twice — a field cannot make the alarm harder to
  find by being the same colour as one of its edges, when the alarm additionally has a FILL, a
  border and a WORD inside a 20px box and the field has none of those. What the margin forbids is a
  field arriving at the alarm's chroma in a *different* hue, which is a second thing shouting.

  **The 14.3x itself is not a defect and was left alone.** That fixture revision is live in 1 of 3
  places, so a mostly-amber bar is a true statement of the page's first criterion, and FIELD
  CEILING §1 still holds inside it. What WAS a defect is amber on a revision that can never arrive
  anywhere — see `coverageFill` in `revision-coverage.ts`, which took `/versions` from 30 amber
  segments to 13.
- **§3 — The total-ink cap returns the moment the field shares a ROW with a chip.** Below ~5,000px²
  a field is a mark and is bound by the chip rule. The `/versions` list miniature is `160 × 8 =
  1,280px²`, so it is a mark, and its `live` segment costs at most `1,280 × 0.0384 = 49` ink
  units — 0.3x the alarm. Both scales pass, by different tests, which is why the bar can stay one
  component at two sizes.

**A field is not a licence to saturate.** `green-700` was rendered at full size and rejected by eye:
23,600px² at C 0.1495 is 3,530 ink units, a Kelly-green slab that reads as a marketing progress bar
and puts §2 in play. **The shipped answer spends ZERO new colour values** — it is the quiet mint
`#426d64` / `#83b0a8` the `newest` chip already owns, which `ExposureBar` was already painting its
newest-build segment with. See "ONE PROPORTIONAL BAR" below.

**The sentence the bar's five values now obey, and it reads straight off the object:**

> **Chromatic means the segment is about THIS build. Achromatic means it is not.**
> `live` mint · `failing` red · `ahead` and `unplaceable` gray · and `notYet` amber is the one
> crossing, where the build is absent AND someone may need to act, so adversity wins.

**Corollary — when position carries meaning, colour marks only the deviation; when it does not,
colour is the whole encoding and every category must be coloured.** A coverage segment is the second
kind: its position in the bar is a fixed bucket order, its extent is the quantity, so hue is a
primary channel and a gray bucket is a hole in the encoding. **This is the third independent reason
`live` may not be gray, and it is the one to check first next time.**

> ⛔ **THIS COROLLARY USED TO LICENSE `EnvHealthStrip` TO PAINT `healthy` GREEN, AND THAT HALF OF IT
> WAS WRONG. CORRECTED 2026-08-27 — do not restore it.** The sentence was: *"This is what licenses
> `FleetStrip` (settled = GRAY) and `EnvHealthStrip` (healthy = GREEN) to disagree, on adjacent
> pages, without either being wrong … the strip's ticks have no positional meaning at all; drop the
> colour and the object has no encoding left."*
>
> **Its premise is false, twice.**
>
> 1. **The ticks ARE sorted — worst-first.** That is stated in the component and it is what makes
>    its `max` cap safe. So position carries meaning: the adverse ticks are always the leftmost
>    ones. Drop the colour from `healthy` and what survives is *"how many marks are coloured, and
>    they are at the front"*, which is the entire question the column answers.
> 2. **In the UNIFORM case the colour carried nothing at all.** `/environments`'s `All regions`
>    rollup drew **18 identical green ticks** directly above the words `18 healthy` — the same
>    number, twice, in a group header. *"No long composition / 'succeeded vs failed' progress
>    bars … removed from `/environments` env column headers"* is a standing hard NO in this file,
>    and a row of N identical ticks under its own count is that object's shape.
>
> Measured on `/environments` at 1440 light before the correction: `green-700` was the largest
> chromatic element count on the page (**48 elements**), while the page's own headline fact — one
> failing environment — was a single 26x6px red dash at ~32.5 ink units, i.e. **the same as ONE `-1`
> chip.** After: **2 green elements**, and the alarm chip is the loudest mark on the page.
>
> `healthy` now takes `bg-gray-500 dark:bg-gray-400` and `pending` takes `bg-gray-200
> dark:bg-gray-700` — character for character `FleetStrip`'s `MARK` map, which took them from the
> deleted `STATUS_DOT_CLASS`. Settled and absent are separated on LIGHTNESS, not hue. **Two values
> removed, none added, and the two strips on adjacent pages now agree instead of being licensed to
> disagree.** What is left coloured is exactly the deviations: `failing` RED, `stuck` AMBER,
> `deploying` BLUE, `baking` YELLOW.

### ONE PROPORTIONAL BAR — `.prop-bar`, shared by `CoverageBar` and `ExposureBar` (2026-08-26)

Two objects in this product segment a whole by *"which build is this part on"*: `CoverageBar` (a
revision's (service, environment) places, `/versions` and `/versions/<rev>`) and `ExposureBar` (an
app's ready pods, `/apps/<name>`). Same idea, two denominators. They shipped from two agents as two
components with two geometries and two answers to their one shared segment:

| | before | after |
|---|---|---|
| radius | `CoverageBar` 4px · `ExposureBar` 0px | **4px**, one of the two legal radii |
| gutter | 1px · 1px | 1px (the declared sub-scale hairline) |
| height | 26 / 8px · 8px | unchanged — the miniature and the exposure bar are both 8px |
| segment floor | 6 / 4px · none | 6px full, 4px compact, both |
| the "on this build" segment | **`gray-500`** · **mint** | **mint**, both |
| legend swatch | 12px square r4 · 8px `rounded` | **`.cov-swatch`**, 12px square r4, one atom, three call sites |

Geometry now lives once, in `app.css` `@layer components`; each component supplies only its own
HEIGHT. `.cov-swatch` moved there too — it had been declared identically in two `<style>` blocks.
**Different shapes for the same kind of information is the fastest way a UI reads as assembled
rather than designed**, and one idea rendered two ways on two pages is the cross-page version of
that, which is worse.

**What is deliberately NOT unified, and the argument.** `FleetStrip` (one mark per environment,
grouped by build) and `EnvHealthStrip` (one equal tick per app) are **not** proportional bars and
must not be made to look like them. The fleet strip's marks are a COUNT of discrete things and its
length is the fleet's size; the health strip's ticks
are equal by construction *because* proportion is the wrong quantity there (`39 ok / 1 failing` and
`38 ok / 2 failing` are the same bar and a different day). Their gutters also differ on purpose —
the fleet strip takes `DeployVolumeSparkline`'s 1px because it sits in the adjacent column of the same
`/apps` row; the strip takes `DeployHistoryStrip`'s 4px because that is the object on every row of
`/environments`. They never co-occur on one page. **Four objects, two vocabularies, and the split is
"is the quantity a proportion of one whole, or a count of discrete things".**

### Radius — exactly 2 values

- `rounded-xl` (12px) — **panels. Nothing else.**
- `rounded` (4px) — chips, tiles, buttons, inputs.
- **Banned:** `rounded-lg`, `rounded-md`, `rounded-sm`.
- `rounded-full` survives **only** on activity-rail status dots and avatars.

### Spacing — exactly 5 values, 4px base

`4` inside an atom · `8` between atoms in a cluster · `12` row padding-y and in-row grid gap
· `16` panel padding-x · `24` between panels. Nothing else is legal. No `p-2.5`, no
`gap-1.5`, no `py-0.5`, no `px-5`.

**Two declared exceptions, and only these two.** Each is a sub-scale hairline where a scale
value would destroy the thing it is spacing. (There were three; the `2px` Gantt-lane gap went
with the Gantt on 2026-08-24.)

- **`6px`** — the chip's internal padding. Defined once in `.chip`; never write it by hand.
- **`1px`** — the gutter between `DeployVolumeSparkline` bars, and between `FleetStrip` marks
  inside one run,
  which is the SAME value reused rather than a third one. The sparkline is 64px wide with 12
  bars; `gap-1` (4px) would spend 44 of those 64px on gutters and leave a chart made mostly of
  nothing. The ruler is the same geometry deliberately — the two sit in adjacent columns of the
  same `/apps` row, and two 16px histograms drawn to two different recipes read as two unrelated
  widgets rather than as one row's two measurements.

If you find yourself wanting a third, you almost certainly want an existing scale value.

### Type — 9 roles, 2 trackings

Defined once as utility classes in `src/app.css`; use them, do not hand-roll the sizes.

| Class | Spec | Used for |
|---|---|---|
| `.t-display` | 24 / 300 / Montserrat | page h1, title half |
| `.t-display-id` | 24 / 500 / mono | page h1, identifier half |
| `.t-headline` | 17 / 600 / Montserrat | the missing mid step — verdict sentence, "Needs a person" |
| `.t-body` | 14 / 400 / system | prose |
| `.t-dense` | 12.5 / 400 / system | table cells, state sentences |
| `.t-micro` | 11 / 400 / system | ages, second lines |
| `.t-code` | 13 / 500 / mono | shas, versions, namespaces, gate names |
| `.t-code-sm` | 11.5 / 400 / mono | mono inside micro lines |
| `.t-label` | 10 / 600 / Montserrat / uppercase / **0.16em** | section eyebrows AND table column headers |
| `.chip` | 10 / 600 / mono / uppercase / **0.08em** | the chip, only |

Two uppercase trackings, deliberately: 0.16em on a monospace face looks broken. The old
9/10/11px sprawl collapses to exactly `.t-label` (10px) and `.t-micro` (11px).

Montserrat is the sans **display + headline + label** face. It was already being fetched on
every page load and used by zero elements. Body / dense / micro stay on the system stack.

### The chip — one component, one geometry, no `size` prop

`src/lib/components/Chip.svelte`. 20px tall · 0 6px padding · 4px radius · 1px border ·
mono 10 / 600 / uppercase / 0.08em · max-width 12ch with ellipsis · no icon.

**NINE roles** (`status` was deleted 2026-08-27 with the dot)**, and only THREE colour pairs
between them:**

| tone | roles | value |
|---|---|---|
| NEUTRAL | `count`, `head`, `unranked` | `gray-200` border / `gray-500` ink (dark `gray-700` / `gray-400`) |
| MINT, QUIET | `newest` | `#426d64` / `#83b0a8` — see "`newest` IS LOUDER" |
| ADVERSE | `rank` (`−N`), `diverged`, `failing` | `red-700` / `red-400`, TEXT-ONLY |
| ALARM | `alarm` (`stuck`) | amber-400 fill + amber-500 border + amber-900 ink · **no glyph** |
| IDENTITY | `env` | the four theme vars, by NAME only |

**`alarm` is the only chip with a FILL — that is what makes it the loudest object on the page,
and nothing else may fill.** It had a glyph as well until 2026-08-27, when the human deleted
it as a second encoding of the word beside it; the fill moved `amber-200 → amber-400` /
`amber-950 → amber-900` in the same pass to pay for it. The three ADVERSE roles are text-only,
so a stuck environment still outranks a merely failing or trailing one in the same box.

Four of those roles are the SAME gray and three are the SAME red. That is deliberate: **the
role names exist so a grep tells you what a chip MEANS**, and adding a name costs nothing when
it spends no new value. `failing` (2026-08-26) is the newest of them and spent zero — it is
`rank`'s red, and it exists because the word `failing` had nowhere to live but prose.
`newest` is the only rank word with a colour of its own, and per the rule below it may only
ever be a verdict about a row's own subject.

### The 12ch cap, and the ONE way to lift it — `wide` (2026-08-26)

`.chip` caps at `max-width: 12ch`. **Measured, that is about EIGHT characters**, not twelve:
`max-width` is border-box, so 72.25px minus 12px of padding and 2px of border leaves 58.25px
of content, and the 10px mono face at 0.08em tracking advances ~7.1px per character. Anything
from 9 characters up ellipsises.

**The cap is a product-wide contract and it stays** — one long environment name may not eat a
row. What changed is that it is now REACHABLE, and by one mechanism:

> **`<Chip wide />` lifts the cap. `class="max-w-none"` does not, and never reliably did.**

The `class` prop lands on the `.chip` element in the LONE form and on the `.chip-joined`
WRAPPER in the joined form. So `max-w-none` worked on a lone chip and **silently did nothing**
on a joined one — same prop, same value, two outcomes, no error. It cost one agent the joined
chip on the `/versions` service list, and it is the same clamp that renders three different
production regions as three identical `PROD-US…` chips. `wide` sets `.chip-wide` on the
`.chip` ELEMENT in both branches, so it is one prop with one result, and `Chip` now
`console.warn`s in DEV if a `max-w-*` utility is passed through `class`.

**Verified behaviour-preserving.** All 13 previous `max-w-none` call sites were migrated;
a census of **483 chips across 9 pages** at 1440 (`/`, `/rollouts`, `/apps`, `/apps/<name>`,
`/environments`, `/envs/prod`, `/versions`, `/versions/<rev>`, `/activity`) came back
**byte-identical** on eight of the nine, and the ninth is `/apps`, which changed on purpose.
`class` keeps `shrink-0` / `min-w-0` / `hidden` / `self-center`, which want the wrapper.

✅ **CLOSED 2026-08-26 — THE CLIPPING PASS. Every clipped identifier chip in the product is
now `wide`; the census is ZERO.** The entry that used to sit here said fourteen chips on three
pages. Re-running the census found **ninety clipped instances of eighteen distinct region
names, on FIVE pages** — it had missed `/apps/[name]`, `/namespaces/[name]` and the open
command palette entirely, because those pages only clip on the `edge-mesh` / `payments-core`
fixtures and the earlier sweep had loaded `/apps/hello-world`.

Measured at 1440 light under `MOCK_API=1`, `scrollWidth > clientWidth` on each chip's label:

| page | chips | clipped | distinct names |
|---|---|---|---|
| `/` | 63 | **18** | 18 — 17 in Trailing, 1 in Steady |
| `/rollouts` | 70 | **18** | 18 — the card's env chip |
| `/activity` | 78 | **41** | 18 — 18 in the filter row, 23 in the timeline |
| `/apps/edge-mesh` | 41 | **9** | 9 — the `ActivityRail` |
| `/namespaces/edge-mesh-prod-us-east-1` | 4 | **4** | 1 |
| command palette, query `edge` | +32 | +24 | 13 |
| `/apps`, `/environments`, `/envs/*`, `/versions`, `/versions/<rev>` | 130 | 0 | already `wide` |

**The worst of them was not `/`.** `/activity`'s environment FILTER ROW rendered eighteen
buttons of which fourteen read `PROD-US…`, `PROD-EU…`, `PROD-AP…`, `PROD-SA…`, `PROD-AF…`.
A filter you cannot tell from its neighbour is not a filter. That is a harder failure than the
Trailing section's, because on `/` the row at least carries a sha and a rank beside the chip.

**After: 0 clipped chips and 0 horizontal overflow on ten URLs × {1440, 390} × {light, dark}**
— 388 chips per pass.

**Two things had to move to make room, and both are recorded below** — see "The `/` compact
row picks its own column count" and "THE ALARM WAS BEING DRAWN TWICE".

**Three call sites were deliberately left capped.** See "What stayed at 12ch, and why".

**Product-wide invariant: an env chip's colour is a function of the environment's NAME and
nothing else. If a chip's colour changes when deploy status changes, it is a bug.** Status
lives on the glyph and the state sentence.

### What stayed at 12ch, and why (2026-08-26)

The cap is not a bug to be eliminated — it exists so one long environment name cannot eat a
row, and three call sites still earn it. Each has a comment at the call site saying so, because
the next agent to run a census will find them and want to "finish the job".

| call site | why it stays capped |
|---|---|
| `Navbar.svelte` breadcrumb | CHROME, not content. The bar prints the namespace and the rollout name in full immediately to its left, and it is a SINGLE NON-WRAPPING ROW — a 147px region chip takes its width straight out of the rollout name. Verified on the live cluster: the rollout page's OWN H1 chip, 60px below, IS `wide`, so the full name is on screen anyway. |
| `CommandPalette` app env strip | The strip is a COUNT AND A STATE — *"this app is in 13 places and they are all green"* — not a list of names. Measured at 1440: 13 chips wrap to 2 lines inside the 592px result row capped, and to 4 lines wide, which halves how many results fit the 520px scroll region. The row's identifier is the app NAME above it, and `/apps/<name>` prints every region whole one keystroke away. |
| `CommandPalette` result meta chip | The full namespace is printed on the SAME ROW as the result's own subtitle — `edge-mesh-prod-us-east-1` under `edge-mesh`. This is the "repeated label whose full name is adjacent" case exactly, and the palette is a fixed-width overlay that cannot grow to absorb 147px. |

Every other `role="env"` call site in the product is now `wide` — 13 of 16.

### The `/` compact row picks its own column count (2026-08-26)

**Un-clipping a chip is a layout change, and on `/` it broke a row.** The Trailing and Steady
grids were `grid-cols-1 sm:grid-cols-2 xl:grid-cols-3`, and `xl` is 1280 — where three columns
leave each row 347px. Measured on `/` at 1280, before → after the `wide`:

| | clipped chips | truncated APP names |
|---|---|---|
| 1440 | 18 → 0 | 0 → 0 |
| **1280** | 18 → 0 | **1 of 29 → 9 of 29** |
| 1024 | 18 → 0 | 0 → 1 |

`edge-mesh` beside `PROD-AP-SOUTHEAST-2` rendered as **`edge-m…`**. **Trading one ellipsised
identifier for another is not a fix**, so the row was fixed rather than the chip re-narrowed.

**The breakpoint was the wrong control.** What decides whether this row fits is the ROW's
width, and the sidebar plus the page gutters mean one viewport yields different row widths on
different pages. `[grid-template-columns:repeat(auto-fill,minmax(24rem,1fr))]` asks the
question directly. Measured after: 1440 → 3 columns at 400px, **0 of 29** names truncated;
1280 → 2 columns at 528px, **0**; 1024 → 2 columns, unchanged; 390 → 1 column.

`auto-fill`, not `auto-fit`, so a section holding one or two rollouts keeps card-width cards
instead of stretching one to 1216px — which is what the fixed 3-column grid did. `24rem` is a
Tailwind scale value, and a grid TRACK MINIMUM is not a spacing value: the 4/8/12/16/24 scale
governs padding, gap and margin, and this file already documents fixed tracks (`152px` BUILD,
`320px` rail).

**One row is still short at 390, and it is named rather than hidden.** In the Steady section,
`payments-core` beside `PROD-EU-CENTRAL` renders `payments-c…` — the Steady row carries the
word `NEWEST` where a Trailing row carries `−1`, ~30px more. It is 10 of 13 characters of a
name printed IN FULL twice directly above it, against four regions that were mutually
indistinguishable before. Accepted, and it is the only truncated name at any width.

`/activity`'s filter row also grew, and that is the whole point of it: **2 → 3 lines at
1440/1280 (+26px), 5 → 8 lines at 390 (+78px).** The first timeline entry is still above the
fold at 390.

### ⚠️ THE ALARM WAS BEING DRAWN TWICE, AND THE SECOND ONE WAS HALF AS LOUD (2026-08-26)

**Found by measurement, while checking whether the widened chips had spent the alarm's
headroom. They had not. Something else had already spent it.**

`StuckBadge.svelte` drew its own pill — `rounded-full`, `text-[9px]`, `px-1.5 py-0.5`,
`bg-amber-100`, `ring-1 ring-amber-200` — and that pill was the alarm on `/`, `/rollouts`,
`/namespaces/[name]`, the rollout detail page and `PromotionNode`. `CommandPalette` had a
sixth copy inline. **Five of the product's pages were drawing the loudest mark in the system
in a second, weaker geometry, and no census had ever caught it, because it is not a `.chip`
and every census in this file selects `.chip`.**

Measured at 1440 light with this file's own formula:

| | fill C | ink C | border/ring C | dot C | presence |
|---|---|---|---|---|---|
| `StuckBadge` pill | 0.0592 | 0.1358 | 0.0053 | 0.1358 | **116.1** |
| `Chip role="alarm"` | 0.1203 | 0.1126 | 0.1712 | 0.1728 | **204.2** |

**The pill was 0.57x the alarm it was supposed to BE.** This file had already written down
why, for the Chip: *"amber-100 (#fef3c6) is 1.11:1 against white — the mechanism the spec
names as what makes it loudest was contributing essentially zero luminance mass, and the chip
was really an outline chip with a warm tint."* That fix landed on `Chip` in the ONE STATUS
MARK pass and never reached `StuckBadge`.

It was survivable while the region chips were clamped to 72px — `/` measured 1.05x, barely
holding — and it inverted the moment they were not.

**`StuckBadge` now renders `<Chip role="alarm">` and owns only the reason sentence.** ZERO new
colour values, and it deletes five budget violations at once: a `rounded-full` outside the two
survivors the radius rule allows, a 9px type role that is not one of the nine, `px-1.5` and
`py-0.5` off the spacing scale, and `amber-100` / `ring-amber-200`. Its `size` prop is gone —
`Chip` deliberately has none and a wrapper must not reintroduce one behind its back.

### THE ALARM CEILING, RE-MEASURED AFTER THE CLIPPING PASS (2026-08-26)

Same formula as every table above (`area×fillC + area×0.28×inkC + perimeter×borderC +
dotArea×dotC`), instrumented in-browser by compositing each colour through its real ancestor
stack, so `oklch()` and `color-mix()` resolve the way the screen does. It reproduces this
file's published numbers within ~1%: `stuck` **204.2** against 206.7 light and **155.5**
against 156.2 dark, `prod-eu-central` on `/apps` **135.2** against 135.3.

| page | | before | after | ratio before → after |
|---|---|---|---|---|
| `/` light | loudest identity | `staging` 110.4 | **`prod-ap-southeast-2` 167.7** | |
| | alarm | StuckBadge 116.1 | **Chip 204.2** | **1.05x → 1.22x** |
| `/rollouts` light | loudest identity | `staging` 110.0 | **`prod-ap-northeast-1` 167.7** | |
| | alarm | StuckBadge 115.3 | **Chip 204.2** | **1.05x → 1.22x** |
| `/` and `/rollouts` DARK | loudest identity | `staging` 134.9 | `staging` 134.9 — **unchanged** | — → **1.15x** |
| `/apps` light | | 135.2 / 204.2 | untouched | 1.51x |
| `/apps` dark | | 132.8 / 155.5 | untouched | 1.17x |

**Widening cost the light ceiling 0.29x of headroom and the StuckBadge fix bought back 0.46x**,
so `/` and `/rollouts` end LOUDER relative to their identities than they started.

**DARK DID NOT MOVE AT ALL, and the reason is already in this file.** A warm identity at 28%
alpha cancels against the blue card ground, so a full-width `prod-ap-northeast-1` measures
**121.7** in dark — still BELOW `staging`'s 134.9. In dark, widening a production region chip
cannot change which identity is loudest. The one-line `.dark .chip-env` fix this file names as
"out of reach of `environment-theme.ts`" is still not taken, and taking it would put this
measurement back in play.

**`/activity`, `/apps/[name]` and `/namespaces/[name]` carry no alarm mark at all** —
`role="alarm"` has four call sites (`/apps`, `/apps/[name]`, `/envs/[name]`,
`/versions/[...slug]`) and `StuckBadge` five, and none of the three is among them. Per the
FIELD CEILING's scoping rule the total-ink comparison needs both marks on screen together, so
there is no ratio to report there. If an alarm is ever added to one of them, the number to
beat is **204.2 light / 155.5 dark against a 167.7 / 121.7 region chip — 1.22x / 1.28x.**

### Buttons — 3 kinds, 1 size, no `size` prop

`primary` = `bg-gray-900 text-white` (dark: `bg-white text-gray-900`), **maximum ONE per
page**; if two rows need a decision, only the topmost gets it. It is loud by *contrast*, so
it costs zero colour budget and cannot collide with amber. `default` = white with a
gray-200 border. `ghost` = transparent, gray-400, for row affordances revealed on hover at
≥lg. `primary-600` orange is banned.

**A hover-revealed control is permanently visible wherever hover does not exist.**
`.row-reveal` lives inside `@media (min-width: 1024px)`, so it hides nothing on a phone —
every call site must add `hidden lg:flex` itself. It did not, and at 390px `Change version`
rendered at rest on both healthy ledger rows, breaking the rule that **only the adverse row
carries buttons at phone width**. Grep `:hover`- and `group-hover`-revealed affordances and
open each at 390px; a value census cannot see this, and neither can a desktop screenshot.

### Never name a cause you cannot evidence

Twice now the page has asserted a specific mechanism it had no evidence for: first by naming
three blocking gates when two of them were passing, then by printing *"prod is 19 builds
behind, waiting on a gate"* for an app that declares **no gates at all** (`blockReason` ended
`return 'a gate'`, a fallback reached only when both gate lists are empty). Both cost a full
round and both read as confident.

The rule, applied everywhere the UI phrases a reason — the verdict sentence, the ledger state
cell, the `stuck` chip's tooltip, `StuckBadge`, and **button labels**:

- Name a cause only from the field that established it. Gate wording needs a non-empty gate
  list; "baking" needs a `baking` stuck reason; a duration needs the detector's own measured
  span, not a re-read of the clock.
- With no evidence, describe the **observable** and stop: it is behind, it has not moved, this
  is how long. `"prod is 19 builds behind, and has not moved in 3 days."` is a useful sentence.
  `"waiting on a gate"` is a lie with better grammar.
- This binds affordances too. The page's ONE primary button read `Review gates →` on every
  adverse row, including rows with no gates to review.

Silence about a cause beats a confident wrong cause. It is the same rule as
`newerReleaseCount` returning `null` instead of `0`, one level up.

### ONE rank, product-wide — `env-rank.ts` (2026-08-23)

> *"one rollout, three pages, three numbers."*

⚠️ **THIS ROUND FIXED FOUR OF THE SIX SURFACES AND MISSED `/` AND `/rollouts` ENTIRELY**, which
kept their own derivation for another week and produced the worse version of the same defect —
one PAGE printing two verdicts for one build. Closed 2026-08-30; see *"`N BEHIND` HAS ONE
DEFINITION NOW"* at the top of this file. The lesson is in the miss: this note said *"`/apps`,
`/environments`, `/envs/*` and `/apps/[name]` all read it"* and treated that as done, when the
two pages under the do-not-touch constraint were the ones nobody had checked. **A "one
derivation" claim is only true if the exemptions are enumerated.**

`−N` is a chip geometry the whole product shares, and four surfaces were filling it from
four different derivations. Measured on `checkout-edge` in prod, one rollout, one render:

| Surface | Printed | What it was actually counting |
|---|---|---|
| `/apps/[name]` | **−19** | the build ladder rank — correct |
| `/apps` | −17 | `cellLag`, the HOP to the upstream environment |
| `/envs/prod` | −17 | the same hop |
| `/environments` | −2 | `i`, the INDEX of the version in the list of versions currently deployed |

The last one is the original `cellLag` defect all over again: capped at `versionCount − 1`
exactly as that one was capped at `envCount − 1`, so it could never express a real lag and
its ceiling moved with the fixture. On live data it printed `−1` where `/apps` printed `−4`.

**A rank is a property of the BUILD, so it may not change when a different environment
deploys.** That is what rules the hop out: "staging is 2 behind dev" is a fact about two
rows, and it cannot be printed in a chip attached to one sha without lying about what the
number counts. `view-models/env-rank.ts` is now the single derivation — `buildLadder` rank,
plus `divergedFromLine` — and `/apps`, `/environments`, `/envs/*` and `/apps/[name]` all read
it. `env-rank.test.ts` asserts the matrix and the ladder agree cell by cell; that test is the
thing that keeps them from drifting apart again.

`cellLag` survives for the questions that really are about a hop. It must never feed a chip.

**Four verdicts, and one of them prints nothing.** `newest` · `−N` · `diverged` · `unknown`.
`unknown` renders NO chip and NO number, because a `0` there reads as "newest" — the same
null-means-unknowable contract `newerReleaseCount` already enforces.

**A ladder with no `created` was sorting by SHA.** `buildLadder` broke `createdMs` ties with
`version.localeCompare`, i.e. it ranked builds alphabetically by hash whenever no rollout
published an `availableReleases` list. On `orders-api` that printed `−3` on the environment
running the app's newest build and `newest` on the one two promotions behind — silently, because
the output still looked like a rank. The tie-breaks are now `created` → **env-order rank of the
environment currently running the build** → latest deploy time → `localeCompare`. Env rank sits
above deploy time deliberately: a promotion chain reaches dev before prod, so the LATEST deploy
in wall-clock time is routinely of the OLDEST build.

### ⚠️ How to audit a page — a value census proves almost nothing on its own

Three times in one run an inventory returned green on a page that had a visible, serious defect.
Each time the cause was identical: **the census only counts what it was told to enumerate.**

| What was missed | Why the inventory could not see it |
|---|---|
| 465px of dead column between two panels | whitespace has no computed style |
| The version ramp covering 41× the area of the page's only alarm | every value was individually in budget; nothing measured COVERAGE |
| 12 elements on `0px 0px 4px 4px` — reported by two agents as "exactly 2 radii" | a uniform-value dedupe does not match a partial one |
| `hello-world-app` printed 9 times on the page that IS hello-world-app | repetition is not a style property |
| The Gantt's 1px status ring out-shouting the `stuck` chip 2.68x (light) / 3.78x (dark) | a 1px outline is trivially in budget; nobody multiplied its PERIMETER by its chroma |
| The page's biggest sentence naming a gate on an app with no gates | a census enumerates values, not truth claims |

**The rule: a value census proves only that the values it enumerated are in budget. It proves
nothing about the properties it did not think to enumerate, and nothing at all about space,
repetition, or coverage.**

So a page audit is not done until all of these have run:

1. **Value censuses** — colour, radius, spacing, type. Report the **raw computed string**, never
   `parseFloat`, or asymmetric and multi-value shorthands vanish. Check `padding`, `margin`,
   `border-width` and `outline` the same way.
2. **Coverage** — for any colour system, total painted AREA per hue, not just the value count.
   Compare the loudest thing on the page against the thing that is *supposed* to be loudest.
3. **Repetition** — tokenise every visible string in `<main>` and list anything appearing 4+ times.
   Then ask which repeats carry information and which the container already guarantees.
4. **Space** — each column's panel height and the delta; the gap between the shortest column and
   the next full-width object; per-column fill rate in every table (empty cells ÷ rows, and the
   track's width as a % of the panel).
5. **A full-page screenshot, read by eye, in both themes.** Every single one of the four defects
   above is obvious in a screenshot and invisible in a number.

Measurement hygiene, learned the hard way: **settle the page** (~2.5s) before measuring or you
will read a transient — an unsettled census reported 17 colours on a page that has 15, three
times. And **drive the real theme toggle**, asserting `documentElement.classList` and
`localStorage.theme` agree; forcing the class alone leaves any JS-computed colour painting
from the wrong seed. (The ramp that produced this lesson is gone, but the trap is not: any
value derived in JS rather than by CSS reads the store, not the class.)

### ⚠️ Value censuses are blind to whitespace — measure column balance separately

Nothing on the app page may grow unbounded: the ledger grows with environments (bounded by the
app), the builds table caps at 8, **and the rail caps at 8 too — the same number, deliberately.**
Two columns that cap at the same count stay balanced for every app instead of for one fixture.

This rule exists because it was broken and nothing caught it. The rail was set to `limit={14}` —
technically a cap, far too loose. Measured at 1280: rail 976px against a 562px builds panel, 414px
taller, leaving **465px of dead column** between the bottom of Builds and the top of the Gantt. It
degrades with data, too: the rail grows with history while the builds table does not, so a busier
app looks worse rather than better. Capping at 8 brought the columns within 9px and the gap down to
47px, which is just the section gap.

**The lesson is about measurement, not layout.** Colour, radius, spacing and type censuses are
inventories of *values*, and they all read green while the page had a 465px hole in it — because
empty space has no computed style to enumerate. A value inventory can never see a whitespace defect.

So whenever a page has a multi-column region, measure it explicitly and treat the numbers as
first-class alongside the colour count:

- each column's panel height, and the delta between them
- the vertical gap between the bottom of the shortest column and the next full-width object

Selector note, because this is fiddly: `closest()` from a section eyebrow does NOT land on the
panel — the label sits outside the bordered element. Find the eyebrow by text, walk to its
`section`, then take the descendant whose computed `borderTopWidth > 0` and `borderRadius >= 12`.
Use a tall viewport or you will measure a clipped column.

### ⚠️ Mockups are drawn without the sidebar — size tracks from the DOM, not the image

The design mockups are 1280px wide with no chrome. The real app puts a 176px sidebar next to
`<main>`, so a "1280px" row actually has **1022px** of usable width. Any fixed track copied
straight out of a mockup therefore runs roughly **15% too generous**, and the overflow always lands
on whichever column holds a sentence, because that is the only one that can absorb it — which is
exactly how a table ends up with five comfortable columns and one that wraps.

This is not hypothetical: the ledger's actions track was specified at 150px, measured at 221px of
real content (`Rollback` 84px + `Review gates →` 129px + 8px gap), and the 86px had to come back
off BUILD, RANK and AGE — all three of which were holding ~40px of dead width each while the state
cell was the one being squeezed.

**Measure the real content in the real container before fixing any track width.**
`getBoundingClientRect().width` on the actual rendered control, not a guess from the image.

### ⚠️ `app.css` is UNLAYERED, and that beats every Tailwind utility

Tailwind v4 puts its utilities in `@layer utilities`. **Any unlayered rule outranks every layered
rule, regardless of specificity or source order.** So a plain `.foo { ... }` in `app.css` silently
wins against `class="foo text-sm"`. This bit three separate times in one afternoon:

1. `.chip { border: 1px solid transparent }` unlayered beat `border-gray-200` / `bg-amber-100`,
   so **every non-env chip rendered a transparent border** and the `alarm` chip lost its fill.
   Fixed by moving `.chip` and `.chip-dot` into `@layer components`.
2. `.ledger-grid { display: grid }` beat a `hidden` utility on the same element.
3. `.t-label { font-weight: 600 }` beat `font-bold`, so a "make the selected state heavier"
   change did nothing.

**The rule:** a class that owns GEOMETRY or LAYOUT and expects utilities to supply colour or
visibility must live in `@layer components`. A class that is meant to be authoritative and
un-overridable — the `.t-*` type scale — stays unlayered *on purpose*, because the scale owning
font-size/weight/family is the whole point. Know which one you are writing, and say so in a
comment. When a utility "does nothing", this is why: check the layer before you debug the value.

### Open against the budget — measured, named, not hidden

- **CLOSED. Dark now counts 14, light 15, both with one green.** Dark had run 5 values over light
  purely from alpha-composited surfaces (`bg-gray-700/60`, `bg-gray-700/80`, `bg-amber-900/40`,
  `border-amber-700/60`), because compositing produces a value no rule emitted and no census can
  trace back to a token. Replacing each with a solid token took dark 20 → 17 → 14.
  **Prefer a solid token to `token/opacity` for any FILL.** Alpha is legitimate for overlays and
  for hover states; it is not a way to make a new shade.
- **`baking` and `stuck` are 7.8° of hue apart** (`yellow-500` #f0b100 vs `amber-500` #fe9a00) and
  at a 12px swatch they read as one colour. The hues are NOT changed — both are pinned
  product-wide (yellow means baking everywhere, amber means stuck everywhere) and re-hueing one
  inside a single component would break the system to fix a legend. Instead the distinction no
  longer RESTS on hue: status is stated in words in the state cell and in accessible labels, and
  every key swatch is labelled. Hue is a fast path, not the only path.
  If it still needs solving, move the token globally — do not special-case a component.
- The env-identity chip is reported as a SYSTEM, not counted values: 9 values, every one
  reproducible from 4 env seeds. (The Ember ramp was the other such system, at 13 values; it is
  deleted, so the raw total drops by that much.) Raw total on the
  page is 36. **Say both numbers.** "37 → 15" alone invites someone to count 36 themselves and
  stop trusting the number; the real claim is that every value is now rule-generated rather than
  chosen.

### What the budget does NOT yet cover — deliberate, tracked, not forgotten

The budget above is **enforced on the six rebuilt pages — `/apps`, `/apps/[name]`,
`/environments`, `/envs/[name]`, `/versions`, `/versions/[...slug]` — and on every component that
renders on them**: `Chip`, `ActivityRail`, `DeployVolumeSparkline`, `CommitSummary`,
`BakeStatusIcon`, `StuckBadge`, `PinBadge`, `GithubConnectButton`, `StageChain`, `ExposureBar`,
`FleetStrip`, `CoverageBar`, `EnvHealthStrip`, `DeployHistoryStrip`, and the `ScheduleStatus`
compact form. (`PromotionLadder`, `RegionSet`, `LagChip`, `MatrixCell` and `StatusTile` were on
this list and are DELETED — 2026-08-26.) Those are clean: one green, two radii, five spacing
values.

The rest of the product is **not** clean yet, and that was a scope decision rather than an
oversight. The Chip/env-identity work was product-wide by definition and was done everywhere; a
colour and radius purge is a redesign, and redesigning pages nobody reviewed this round would risk
regressions no one is checking for. Measured debt, worst first:

**Re-counted 2026-08-26, comments stripped. TOTAL 65 hits across 27 files** — the previous
table was measured before the six-page rebuild and every number in it was wrong, four of them
by more than 2x. Reproduce it before quoting it; a debt table that nobody re-runs is a claim,
not a measurement.

| File | banned-token hits |
|---|---|
| `lib/components/ChangeVersionModal.svelte` | 7 |
| `routes/rollouts/[cluster]/[namespace]/[name]/+page.svelte` | 6 |
| `lib/CommandPalette.svelte` | 6 |
| `lib/components/DeploymentPipelineCard.svelte` | 5 |
| `routes/rollouts/[cluster]/[namespace]/[name]/history/+page.svelte` | 4 |
| `lib/Navbar.svelte` | 4 |
| `lib/components/RetryTestsModal.svelte` | 4 |
| `routes/activity/+page.svelte` | 3 |
| `lib/components/DeploymentTimeline.svelte` | 3 |
| ...plus 18 more files at 1-2 each |
| ~~`routes/versions/+page.svelte`~~, ~~`routes/versions/[...slug]/+page.svelte`~~ | **0** — cleared 2026-08-26 with the coverage rebuild |
| ~~`routes/envs/[name]/+page.svelte`~~ | **0** — cleared 2026-08-26 with the env-pages rebuild |
| ~~`routes/apps/+page.svelte`~~, ~~`routes/apps/[name]/+page.svelte`~~, ~~`routes/environments/+page.svelte`~~ | **0** |
| ~~`lib/components/ResourcesCard.svelte`~~ | 1 (was recorded as 12) |
| ~~`lib/components/ScheduleStatus.svelte`~~ | 2 (was recorded as 8) |

"Banned tokens" = `rounded-lg` / `rounded-md` / `rounded-sm`, any `emerald-*`, and `green-500` /
`green-600`. **The debt is now concentrated in the ROLLOUT-DETAIL cluster and the modals** — the
pages nobody has rebuilt — and `emerald-*` is still the item that keeps the product-wide green
count above 1 even though every rebuilt page's is 1.

Reproduce with (this is the command the numbers above came from — it strips `<!-- -->`, `/* */`
and `//` comments, which the older uncorrected census did not, so it counted doc-comment
mentions of `rounded-md` as usages):

```
grep -rE 'rounded-lg|rounded-md|rounded-sm|emerald-|green-500|green-600' src --include='*.svelte' --include='*.ts'
```

Do this as its own pass, page by page, with a visual check per page. Do not do it opportunistically
inside a feature change.

### Env identity ramp (global)

**THE SHIPPED VALUES, verified in `environment-theme.ts`:
`dev`/`development` `#16a34a` · `staging`/`stage` `#7c3aed` · `prod`/`production` `#d97706` ·
`test`/`testing` `#0891b2`**, with `borderColor` a fixed 64% white mix and `surfaceColor` a
fixed 90% white mix. That is the top-of-file CLOSED palette and it is the whole of the rule.
`bandColor` / `--rollout-theme-band`, `ENV_SURFACE_CHROMA`, `ENV_SURFACE_CHROMA_PROD`,
`ENV_BORDER_CHROMA`, `surfaceMixAmount()`, `borderMixAmount()` and `isProductionTheme()` do
not exist in the code.

> ⛔ **SUPERSEDED 2026-08-25 — everything from here to the end of this section describes the
> teal/rust/orange ramp (`dev #0d9488`, `prod #7c2d12` → `#8f3b00`) that was REVERTED.** None
> of those values is in the code. It is kept for the same reason the "Identity presence"
> block above it is: it is the record of four locally-correct rounds that were collectively
> wrong, and that record is the only thing that stops a fifth. **Read the top of this file
> first; if the two disagree, the top of the file wins.**

`dev`/`development` `#0d9488` teal-600 · `staging`/`stage` `#7c3aed` violet-700 ·
`prod`/`production` `#8f3b00` orange · `test`/`testing` `#0891b2` cyan-600.

`dev` was `#16a34a` — the exact green that means `Succeeded`, so a dev badge read as a
health verdict. `prod` was `#d97706` — the exact amber that means `stuck`, so production
read as a permanent alarm.

**Prod left slate-600 on 2026-08-24, from the human: *"Prod highlighting is gray now. It
should be amber or orange something like that clearly indicating danger."*** The old note
here said "prod does not need to shout; it is identified by the word PROD", and taken
literally that produced an environment with no identity colour at all rather than a quiet
one. Measured before the change:

- prod's DARK chip label `#949ca8` was **2.27 dE00 from `gray-400` `#9ca3af`** — the
  product's own muted-text ink, below the just-noticeable difference. Prod's identity mark
  was the same colour as text that means "this is not important".
- prod's LIGHT chip surface measured **0.0029 OKLCH chroma against staging's 0.0251** — a
  **8.6x spread** in the channel that is supposed to be constant across four peers.

Identity had become a ranking and prod ranked last. It went to `#7c2d12` orange-900 — orange
being the only warm family with no owner inside `<main>` (red = `Failed`/`diverged`, amber =
`stuck`, yellow = baking, coral `--color-primary-*` is banned from `<main>`), so **no new hue
family is opened.**

**Then prod moved again on 2026-08-25, to `#8f3b00`, because orange-900 was still too
faint** — see "Identity presence" in the closed budget above for the full measurement. Short
version: equalising the SURFACE fixed one of a chip's three colour channels, and prod stayed
the quietest chip on the other two. `#8f3b00` is the same orange family, hotter (C 0.128 vs
0.117), and — the part that matters for safety — at hue 46.5° instead of 38.2°.

**The one adjacency this creates, and why it is safe.** Prod is the closest pair to a status
hue in the budget: **19.0° of hue from `Failed` red-700** (prod 46.5°, red 27.5°). That gap
WIDENED from 10.7° in the same edit that made prod louder — presence and separation were
moved together on purpose, and that is the only reason raising prod's chroma was safe.
Verified by eye at 1440 and 390 in both themes on `/apps` and `/environments`, where a
`diverged` chip renders 4px from a prod chip:

| | light | dark |
|---|---|---|
| prod chip ink | `#753000` C 0.1101 | `#be8d6b` C 0.0762 |
| `diverged` ink | `#c10007` C 0.2086 | `#ff6467` C 0.1892 |
| separation | red is **1.9x** the chroma | red is **2.5x** the chroma |

And they are never the same MARK: `diverged` is text-only on the page ground (the `rank`
geometry), prod is a filled terracotta chip. Fill-vs-no-fill does more work here than hue.
**If a future change gives `diverged` a fill, or drifts prod's hue back toward 38°, this
adjacency stops being safe.**

## Enforced rules — do not regress

### Visual treatment

- **Colored borders are allowed** (updated 2026-07-19). Colored/thickened borders on elements are fine. A colored **side/left accent bar** (`border-l-4`, etc.) is OK **only on square-cornered elements** — never on a `rounded-*` element. Dots, icons, status circles, and background tints remain good status signals.
- **No popup hover effects** on list/grid cards. Specifically: no `hover:-translate-y-*`, no `hover:shadow-xl`/`hover:shadow-lg`, no `hover:ring-*` that materialises on hover. Plain `hover:bg-*` colour transitions only.
- **No status-driven background gradients.** `card-failed`/`card-active` linear-gradient tints are removed and must not be reintroduced. Status is conveyed via the status circle + inline text only.
- **No long composition / "succeeded vs failed" progress bars.** Removed from page headers (home, /apps, /envs/[name], /namespaces/[name]) and from /activity day headers and /environments env column headers. They look like progress bars but aren't.
- **No left-edge env-color gradient on rows** (the `environment-theme-edge` "vertical blue bar" class is deleted).
- **No env-themed band on top of the individual rollout page's main status card.** Card body sits on plain bg.
- **No status-colored boxed callouts on list cards.** Failure / behind / promote hints render as plain inline text in the status colour, not boxed `bg-red-50` / `bg-orange-50` / `bg-emerald-50` pills. The "healthcheck failed" boxed pill looked terrible; never reintroduce.

### Colour palette discipline

- Reuse status colours: green (succeeded/healthy), red (failed), yellow (InProgress / baking — RESERVED for baking only), blue (Deploying), amber (stuck), gray (pending/no-deploy/behind context). InProgress and Deploying are NOT the same state and must NOT share a colour.
- Env theme colours (dev/staging/prod/etc.) belong to env badges and the env band on /apps/[name] pipeline nodes. They do not apply to the card body.
- Stop adding new colour scopes. Audit existing colour uses before adding any new tint.

### Semantics

- **"Drift" is not a valid status.** Different versions across envs is the normal state during promotion. Removed the DriftBadge and all drift counters. Do not reintroduce drift framing.
- **"Stuck" is the valid promotion-health concept.** A rollout is stuck if:
  1. Its bake/deploy state has been running > 1h, or
  2. It is "behind" an upstream peer env for > 24h and unpinned.
  Surface stuck via `StuckBadge` on /apps cards, /environments matrix cells, /apps/[name] aggregate, and rollout detail status card.

### Navigation

- **Sidebar holds section nav** (Rollouts / Apps / Environments / Activity) on desktop. Mobile uses the bottom tab bar.
- **No section dropdown in the navbar.** A static breadcrumb-style label is OK; a popover/dropdown of sections is not.
- **Drop "Rollouts" hardcoded title from navbar.** It was redundant with section nav.
- **No status badge in navbar.** The Ready/Error/Unknown badge on rollout detail is redundant with the on-page status card.
- **No duplicate ⌘K hint.** The keyboard shortcut hint appears once; the standalone magnifying-glass search button is not the right home for it.

### Page layout

- **Headers stack on mobile.** Page title gets its own truncatable line; the meta/stats row sits below. Title must not be cut off by stats.
- **No horizontal scrolling for primary content on mobile.** Promotion flow and similar must reflow vertically.

### Craft rules from the 2026-08-23 polish pass (app page) — enforced

Seven defects, all of the same family: the page spending ink on things that cost a reader
attention and return nothing. None of them were budget violations; every value was in range.

- **Never render an ellipsis mid-word in prose.** `status.description` is deleted from
  `/apps/[name]` entirely, not word-clamped. It is the one line on a deploy board that can
  never change an operator's next action, and 6 dropped characters out of 132 bought a
  wasted line plus something that reads as a bug. The full text lives on rollout detail.
- **A chart needs a shape, not a datum.** `DeployVolumeSparkline` renders on the app page
  only at `deploys24h >= 3` (`SPARK_MIN`). One bar in twelve buckets is a rendering glitch
  drawn at the size of data, restating a number the words beside it already give exactly.
  Below the threshold the count stands alone.
- **An unavailable integration never takes a data row.** The `Connect GitHub` prompt moved
  out of the Builds panel (where it was row 1 of 8, above the newest build) onto the
  panel's header line, as a plain muted sentence that is itself the click target. It is a
  sentence and not a second bordered button because the navbar already carries one,
  permanently, 40px above.
- **At most ONE instructional subtitle per page**, and only where the reading order is a
  structural decision the reader cannot infer. On `/apps/[name]` that is
  `promotion order, top to bottom` — the ledger draws no arrows. `newest first · the swatch
  is the Gantt's legend` and `who ran what, and for how long` are gone: the first is stated
  by the rank chips, the second captions a chart that shows exactly that.
- **CONVERGED RUNS recede; they do not merge.** Consecutive settled env rows on the same
  build, in the same state, with the same thing waiting, are a run. Every row keeps its
  chip, build, age, glyph and action at full size — the 2nd+ row of a run loses only the
  REPETITION: its sha drops to `gray-500` / dark `gray-400` (4.84:1, still a link, still
  the full sha) and its state cell reads `same as dev` instead of reprinting a sentence the
  reader finished 40px earlier.
  **Do not "finish the job" by merging the rows.** A prod fan-out shares ONE promotion step,
  which is why `RegionSet` is legitimate; dev and staging are two SEPARATE steps, so a
  single `Change version` on a merged row would be a destructive control with an ambiguous
  target — and stages-are-rows is the rule the whole ledger is built on.
- **Test the rendered PIXELS, not the item count.** (This rule governed a Gantt lane that is
  now deleted; the lesson outlives it.) dev has five deploys minutes apart at the left of
  a 26-day window, so by count it is a timeline and by eye it is one block. Exception, and
  it is load-bearing: when the LIVE segment is the narrow one its label is forced anyway —
  silence is acceptable, a chart claiming an env runs a build it stopped running is not.
- **The Builds table's wide track carries `Ran in` when GitHub is not connected.** It used
  to be deleted outright, which cured a header over an empty column and left five of eight
  rows holding a sha, a rank and an age across the whole panel.
  `everIn()` is POSITIVE EVIDENCE ONLY. Deploy history is a bounded window, so an empty set
  proves nothing: a build with no retained deploy renders NOTHING, never `never deployed`.
  Turning a retention limit into a claim is inventing data.
  Below `lg` the cell prefixes `ran in` — with no column header a bare `dev · staging` under
  a sha reads as "live in dev and staging", the exact opposite of what it says.
- **Every non-flexible grid track must be a FIXED width.** `auto` was tried for the trail
  track and reverted: each row is its own grid, so an intrinsic track sizes per row (81px
  where there is a trail, 0px where there is not) and LIVE IN / AGE stopped lining up
  across rows. One flexible track per grid, everything else fixed.

### `/apps` — AN ENVIRONMENT IS NAMED ONCE PER ROW (2026-08-26)

Reported and deliberately not patched, because it needed a decision:

> *"the lede and the adverse chips say the same thing twice on every attention row
> (`PROD is stuck` + `[•][PROD][STUCK]`). Cutting either loses something real — the chips
> carry the fixed env identity colour and the status hue, the lede carries the word `failing`
> that the red dot cannot."*

Both halves of that are true, so **the answer was not to delete one — it was to make the BOX
SELF-SUFFICIENT so the sentence had nothing left to repeat.** Measured on the mock fixture at
1440, before:

| row | lede | box | verdict |
|---|---|---|---|
| `checkout-edge` | `PROD is stuck` | `[●][PROD][STUCK]` | **100% duplicate** — same env, same word |
| `payments-core` | `PROD-EU-CENTRAL is off the release line` | `[●][PROD-EU…][DIVERGED]` | duplicate, **and the box's name was destroyed by the 12ch cap** |
| `checkout-worker` | `STAGING is failing` | `[●][STAGING]` | complementary — but only because the box had NO WORD |
| `orders-api`, `edge-mesh`, `recommender-svc` | in-motion / lag sentence | none | not duplicated at all |

So the duplication was not a style choice, it was a **symptom of two holes**: `fail` had no
chip, and the env chip could not print a region name. Fill both and the sentence is free.

**What shipped.**

1. **Every adverse state prints its word in the box** — `stuck` (alarm), `diverged`, and the
   new `failing` role. **ZERO new colour values:** `failing` is `rank`'s red, text-only, so
   `alarm` keeps the only fill.
2. **The env chip inside the box is `wide`.** `PROD-EU-CENTRAL` prints whole (72.23px
   ellipsised → 115.31px complete). This is what makes step 3 safe: before it, the lede was
   the ONLY place the row spelled the target out.
3. **THE RULE: if an environment has a box, it is not in the sentence.** The lede reports the
   worst environment WITHOUT one — in motion first, then the deepest lag — and prints nothing
   when there is none.
4. **The 3-box cap is counted, never silent.** `+N more`, with the remaining environments and
   their states in its tooltip.

**Measured after.** `checkout-edge` went from `PROD is stuck · [●][PROD][STUCK]` to
`[●][PROD][STUCK] · DEV rolling out` — the repeat is gone and the sentence now explains the
row's own blue status circle, which previously contradicted its amber sentence.
`checkout-worker` is `[●][STAGING][FAILING]` and nothing else. With five failing regions
forced into the `edge-mesh` fixture, the row reads
`[PROD-EU-WEST-1 FAILING] [PROD-US-EAST-1 FAILING] [PROD-US-EAST-2 FAILING] +2 more` over
`PROD-AF-SOUTH-1 is 2 builds behind` — against a five-name sentence over three chips that all
ellipsised to `PROD-US…` before. 390 `scrollWidth === clientWidth` on every shape, both themes.

**THE ALARM CEILING NARROWED AND STILL HOLDS — record the new number.** Presence measured on
`/apps` with `area×fillC + area×0.28×inkC + perimeter×borderC + dot`, the same formula as the
tables at the top of this file (it reproduces the `stuck` chip at 206.7 light / 156.2 dark
exactly):

| | before | after | alarm ÷ identity |
|---|---|---|---|
| light — loudest identity | `staging` 108.3 | **`prod-eu-central` 135.3** | 1.91x → **1.53x** |
| dark — loudest identity | `staging` 131.7 | `staging` 131.7 (unchanged) | 1.19x (unchanged) |

Widening a chip multiplies its presence by its width, so **`wide` is the fastest way in this
product to spend the alarm's headroom.** 1.53x is still clear of the ceiling; the dark case
did not move at all, because the warm identity cancels against the blue card ground. **If a
future pass takes the `/`, `/rollouts` and `/activity` clipping fix above, re-run this
measurement — twelve wide region chips on one screen is a bigger change than one.**

**One thing traded, named.** The old lede listed EVERY failing environment; the box list caps
at 3 and counts the rest. The names moved into the `+N more` tooltip and the row links to
`/apps/<name>`, which lists all of them. Accepted: three unambiguous names beat five ambiguous
ones, and the cap was already there.

## Open issues — still to address

### From the 2026-08-27 colour audit — measured, argued, NOT implemented

Each of these is a real measurement. Each was refused for a stated reason, not skipped.

- ⚠️ **`text-gray-400` at 2.60:1 and `dark:text-gray-500` at 3.03:1 SURVIVE ON `/` AND
  `/rollouts`.** The muted pair was moved one step on all eight in-scope pages (48 call sites), but
  the colour lives at the CALL SITE, not in the `.t-*` classes — those own font only — so there is
  no token to fix centrally, and the two reference pages were out of scope. **It is the same one-step
  move (`gray-500` / `gray-400`, 4.84:1 / 5.64:1, both already in the palette) whenever those pages
  are next opened.** It is the third time this family has bitten: `amber-100` at 1.11:1, the
  `gray-400` dot at 2.60:1, now this.

- ⚠️ **THE STATUS DISC NEVER GOT THE `amber-100` LESSON, AND IT STAYS THAT WAY FOR NOW.**
  `green-100` measures **1.10:1** against white, `yellow-100` **1.07:1**, `red-100` and `blue-100`
  1.22:1 — four hues at four chromas spanning 2.2x, every one **2.5–2.8x below the 3:1 non-text
  floor**. On `/activity` that is 56 discs × 784px² × 0.0442 = **~1,943 ink units of green tint**.
  **Refused for two reasons.** (1) `getStatusCircleClass` was flattened to one neutral gray on
  2026-08-24 and the human RESTORED the per-status tint on 2026-08-26 on the instruction *"I
  generally think we're undercoloring now a bit"* — this is a 24-hour-old decision against exactly
  this reasoning. (2) It is shared with `ControlCenter` and `RolloutGrid`, i.e. `/` and `/rollouts`,
  so any change at the token reaches the protected pages. **If it is ever revisited: it is a GROUND
  behind a glyph that already carries the hue at full chroma, so the 3:1 mark floor is arguably the
  wrong test — the defect worth fixing is that it marks the NORM 56 times on one page, not its
  contrast.**

- ⚠️ **`stuck` AMBER AND `baking` YELLOW ARE 2.8° APART IN LIGHT INSIDE `EnvHealthStrip`** —
  `amber-500 #fe9a00` against `yellow-700 #a65f00`, adjacent 26x6px dashes on `/environments`'s
  Production row (`1 stuck · 1 baking · 1 healthy`). Worse than the 7.8° already recorded for dark.
  **Not changed, and here is the arithmetic for whoever tries.** The two dashes are separated by a
  4px gutter of card ground, not touching; they differ by **ΔL 0.23** and lightness is the channel
  that separates fills at 6px — this file's own FIELD CEILING argument; and their mutual contrast is
  **2.31:1**, above the 2.13:1 the shipped `CoverageBar` already accepts between `notYet` and its
  ground. Both candidate fixes cost more than they buy: **dropping `baking` from the strip** breaks
  the component's stated contract that its buckets are mutually exclusive and add up to the app
  count, and **moving `baking` to `yellow-400`** (the glyph value, ΔH 23.4° — an 8x better
  separation) puts a 6px mark at ~1.4:1 against white, far under the 3:1 floor. The bucket ORDER
  already puts `deploying` between them; they only touch when no app is deploying. After the
  `healthy → gray` correction the pair is two of only a few coloured ticks on the row rather than
  two of twenty, and the caption names them in the order they are drawn.

- ⚠️ **DARK INVERTS THE SYSTEM: green gains 1.40x chroma while red loses 9%.** `green-700` C 0.1495
  → `green-400` C **0.2091**; `red-700` C 0.2086 → `red-400` C 0.1892; the alarm's fill falls to
  0.64x. **The norm gains 40% and the two adverse families lose 9% and 36%; the green : alarm swing
  between themes is 2.2x.** The proposed rule — *a state hue's dark variant may not exceed its light
  variant's chroma* — is right, and only green breaks it. **Not implemented: green is one token used
  by `BakeStatusIcon`, the status dot, the verdict ring, `FleetStrip` and `EnvHealthStrip`, so
  moving it reaches `/` and `/rollouts`.** What this pass did instead was remove green from the
  places it was marking the NORM, which addresses the measured consequence on every in-scope page:
  `/environments` 48 → 2 green elements, `/activity` 268 → 165, `/namespaces/<name>` 10 → 6.
  **`EnvHealthStrip`'s `failing` tick did move to `dark:bg-red-500`** to match `FleetStrip` and
  `CoverageBar` — one fewer dark red in the inventory, and it buys back some of what dark takes off
  red.

- ⚠️ **`.dark .chip-env` PARKS PROD 10.8° FROM STAGING.** Already open in this file as *"suppresses
  warm identities"*; the measurement adds what the fix must say. Composited dark fills: prod C
  0.0048 at hue **288.5°** (light: C 0.0131 at 70.3° — **the hue swings 218° and crosses neutral**),
  staging C 0.0496 at 277.7°. Light fill-chroma spread max÷min is 1.62x; **dark is 10.3x.** Only the
  border (67.9° vs 291.4°) and the ink keep the two identities apart. **An opaque dark fill is the
  only fix — the alpha value is not the variable**, which this pass confirmed the hard way on
  `/apps/<name>` (see below). Reaches `/` and `/rollouts`; do the dark-green item above first or in
  the same change, and re-run the dark alarm ceiling after.

- ⚠️ **`/` STILL DRAWS A STATUS-COLOURED FIELD AND `/apps/<name>` NO LONGER DOES, SO THE TWO PAGES
  DISAGREE.** `/`'s equivalent of `tk--broken` is `#fffafa` at alpha 0.4 over 68,738px², and in dark
  `#1b1827` at hue **295.3° — 2.1° from staging's identity violet.** `/apps/<name>`'s was the same
  bug at 20.4°, and is fixed (below). `/` was out of scope. **The enforced rule — no status-coloured
  boxed callouts — is what both were violating; `/` is the one left.**

- ⚠️ **`/apps/<name>` DRAWS `−N` AT 24px, ~5.8x THE INK IT COSTS ANYWHERE ELSE.**
  `routes/apps/[name]/+page.svelte` renders the task glyph as `tk-glyph t-display-id text-red-700`
  — a 24px/500 mono glyph — where every other page draws the same fact as a 10px chip, so this
  page's `−N` carries ~5.8x a chip's glyph area and ~10.4x the `newest` chip on the same page. On
  `payments-core` there are four (`!`, `−4`, `−3`, `−1`). **Not changed: the VALUE is correct
  (`−N` is red product-wide) and the defect is SIZE, which means redesigning `.tk-glyph`'s grid area
  and its 20px/32px line-box tuning against the chip band — a layout change on a panel the human has
  been through several rounds on, not a colour fix.** It is why `/apps/payments-core` still ranks an
  environment NAME first: that page's loudest CHIP is an identity, and its loudest glyph is this.

- ⚠️ **`/versions/<rev>` AND `/versions` STILL CARRY `.cov-swatch` KEYS.** Two on the detail page's
  bucket-card headers, one derived row under the list. They are sanctioned in this file as a shared
  atom and, unlike `/activity`'s deleted legend, they are built from the buckets actually on screen
  rather than from a dummy graphic — a key that cannot advertise a bucket the page does not contain.
  **Kept.** Worth revisiting only if the bar ever labels its own segments.


- ⚠️ **`/` and `/rollouts` are NOT byte-identical to their pre-2026-08-27 state, in exactly two
  respects, both instructed by the human.** The rest of both pages — every chip's width,
  height, padding, radius, border width, border colour, background, font and text, the joined
  structure, and `scrollWidth === clientWidth` — is byte-identical at 1440 and 390 in both
  themes, and the rollout detail page is byte-identical in all four. The two deltas are the
  shared atoms the instructions changed:
  1. the `newest` chip's ink, `#56766f`/`#8eada7` → `#426d64`/`#83b0a8` (8 chips on `/`, 11 on
     `/rollouts`); the box's WIDTH is unchanged at 53.94 × 20;
  2. the one `stuck` chip on each page: 57.11 × 20 → **48.11 × 20** (the glyph came off) with
     the fill and border upgraded to buy the loudness back.
  If either is unwanted, both are a one-line revert in `Chip.svelte`.

- ✅ **CLOSED 2026-08-26 — the region-name clipping is fixed on every page.** It was worse than
  this entry said: 90 clipped instances of 18 distinct names across FIVE pages, not 14 across
  three. Full evidence, the three call sites deliberately left capped, the `/` grid change that
  paid for it, and the re-measured alarm ratios are under "The 12ch cap, and the ONE way to
  lift it" and the three sections that follow it.
- ⚠️ **`.dark .chip-env` still cancels a warm identity against the blue card ground.** Named
  since 2026-08-25 and still unfixed. It is currently doing the product a favour — it is the
  reason widening every production region chip did not move the DARK alarm ceiling at all — so
  if it is ever fixed, re-run the table under "THE ALARM CEILING, RE-MEASURED" first. A
  full-width `prod-ap-northeast-1` measures 121.7 in dark against `staging`'s 134.9; make the
  fill opaque and it will not.
- ⛔ **RESOLVED BY DELETION — the two entries below described the `/apps/[name]` BUILDS PANEL
  and its AGE column, and that page no longer has either.** It is Direction B (Act / State):
  tasks, `StageChain`, the production fleet block, `ActivityRail`. Kept because the two
  lessons outlive the panel: a `1fr` track beside a fixed rail can hide hundreds of px of
  surplus that no value census can see, and a column that prints the same string on every row
  is spending width on nothing.
  - **The Builds panel had ~460px of structural surplus at 1440.** 908px of content width
    against ~443px of real row content.
  - **`24d` was printed 10 times on one screen** — the page's largest information-free repeat.
- **`/api/rollouts` returns 500 intermittently** on the hub while `curl` against the same
  endpoint succeeds. Backend, not frontend; the page renders from the successful polls.

## Recently addressed (do not regress)

- ✅ **2026-08-27 — THE FLEET RULER IS DELETED. `/apps`'s criterion-1 object is the FLEET
  STRIP.** From the human, on the second round of repairs to the ruler: *"Fleet by build barely
  improved."* Two rounds had been spent on it — round one gave all twelve empty rank stations a
  visible track, round two darkened the head station and moved the `head <sha>` chip against the
  ruler's right edge — and both fixed the EMPTY part. `FleetRuler.svelte`, `view-models/fleet-ruler.ts`
  and `fleet-ruler.test.ts` are deleted; `FleetStrip.svelte` and `view-models/fleet-strip.ts`
  (19 tests) replace them. **Do not rebuild the histogram.**
  - **The ruler drew the AXIS; the strip draws the FLEET.** One mark per environment, grouped by
    the BUILD it runs. Marks that touch run the same build; an 8px gap means the build changes.
    One unbroken run = converged, which is `PAGE-CRITERIA.md` §03 criterion 1 answered by shape.
  - **This IS the IA proposal's own answer** — *"dots one colour = converged"* — with the one
    channel it may not use removed. Per-sha colour stays dead (`VERSION_PALETTE` tombstone, above);
    the proposal's test is SAME-VERSUS-DIFFERENT, not which-colour, and PROXIMITY answers
    same-versus-different without naming a build. **Zero colour values were spent on identity.**
  - **The four measurements that decided it.** (1) A converged fleet occupied 1 of 12 stations, so
    on the live cluster — 4 apps, 3 environments, mostly converged — 92% of the object was the
    absence of data; the strip is 100% marks. (2) Bar height was `count / max`, so ONE environment
    behind rendered HALF-HEIGHT at N=3 and as a 30% STUB at N=13 — the same fact, two pictures,
    down a column whose criterion says "legible at 50"; on the strip it is one mark standing apart
    at both. (3) A column took the WORST tone of the environments in it, so a stuck region and a
    healthy one on one build shared one amber bar; a mark is ONE environment, so the hue names it.
    (4) Position on a rank axis has to be TAUGHT, and the teaching was the dummy-ruler footer
    legend the human deleted.
  - **What the ruler carried that the strip does not, stated rather than hidden:** metric DISTANCE.
    The strip carries the ORDER (runs go newest to oldest) but not how far. Distance is not
    criterion 1, and the row states it twice already — the lede names the worst un-boxed
    environment and its exact lag, and every mark's `title` carries its own.
  - **Three rules, each about a mark, none about a coordinate system:** one mark = one environment;
    marks that touch = the same build; a TALL mark is on the head build. The height channel is
    BINARY (16px / 10px), never a ramp — an ordinal height or colour over rank is `heat(rank)`,
    measured at dE00 1.70–1.92 against a ~2.3 JND and dead.
  - **The head slot is drawn even when it is empty**, as ONE hollow full-height mark. That is the
    ruler's `HEAD_TRACK` argument kept and its cost cut from eleven empty stations to one — and it
    is what guarantees a full-height reference is on screen, without which the height channel has
    nothing to be measured against.
  - **Length is data.** N environments, N marks, nothing dropped. `/apps` prints no environment
    count anywhere (it was cut as a restatement of the caption's denominator) and the strip gives
    it back for free. The ruler was 12 stations wide at every N.
  - **Geometry: two gaps, both already owned.** `1px` inside a run (the declared sub-scale
    hairline, shared with `DeployVolumeSparkline` in the adjacent column), `8px` between runs (a
    scale value) — 8:1, against the 2.82x the eye needs to group. Marks are `width: 10px` and
    shrink uniformly; measured at 1440/1280, 3-env fleets hold 10px, `payments-core`'s 9 over 5
    runs come out 6.7px and `edge-mesh`'s 13 over 3 runs 5.7px, with the strip's box fixed at 96px
    so the `head <sha>` chip after it starts at x=875 on EVERY row.
  - **`width`, not `flex-basis`.** A mark is an EMPTY span, so `flex: 0 1 10px` gave Chrome a
    NEGATIVE max-content flex fraction and every run collapsed to the 2px floor — measured, all six
    rows. A definite `width` is what makes a run as wide as its marks.
  - **Colour was copied from `/apps`'s `STATUS_DOT_CLASS`, character for character, INCLUDING
    `pending`** — the ruler had to override that entry because it never drew a never-deployed
    environment; the strip does, as the `gray-200 / gray-700` empty-slot value. **That const is
    now DELETED with the per-environment status dot (same day, see below), so `FleetStrip`'s
    `MARK` is the SOLE owner of the cell-state → status-hue mapping on `/apps`.** The values did
    not move; the ownership did, and a hue changed in `MARK` is now changed for the page.
  - **Phone is a design, not a derivation.** The desktop strip gets a fixed 96px BOX so the chip
    column holds; at 390 the row is a STACK with no column to hold, so the strip sizes to CONTENT
    (ceiling 160px) and the chip sits 8px off the last mark. A 160px box on a three-environment
    fleet parked the chip 110px from the 32px of marks it names.

- ✅ **2026-08-27 — `/versions`'s `Ships as` is a BADGE again, and the badge is allocated by
  weight.** From the human: *"Revision list i think you changed to badges and then reverted instead
  of finding a way to make improvements."* Correct. Round one was an inline run whose service-to-
  label gap (6px) barely beat its label-to-next-service gap (12px); round two tried the joined
  badge, put the SERVICE NAME in the chip half, hit `.chip`'s 12ch cap — `hello-world-app` and
  `hello-world-manifests` both rendering `HELLO-W…` — and reverted to plain text. **The blocker is
  gone: `<Chip wide />` lifts the cap in the joined form.**
  - **The form is `service-name` + `<Chip role="count" label="as" value={label} wide />`**, i.e. a
    two-section `[AS][1.66.0-66]`. The IDENTIFIER goes in the mono value half, where every
    identifier in this product lives (`head 9f10e49`, `−4 d0ff17e`); a version label is an
    identifier, not a verdict, so it may not be set in the chip half's uppercase tracked face.
  - **The tag-cloud objection is answered by ALLOCATION, three ways.** (1) Only the DEVIATION is
    badged — a service shipping under the revision's own sha gets no badge, which is the rule
    itself. (2) The service name never enters the chip half: it stays `t-dense` lowercase, the ink
    `/versions`, the bucket cards and the detail table all print it in. (3) The loud half is TWO
    CHARACTERS. Measured on the live cluster at 1440: **8 badges over 40 service lines on 11 rows**,
    each with a 26.7px `AS` half — against the rejected form's 40 uppercase name slabs at ~125px,
    i.e. **~23x less bordered uppercase area**. Proximity measured 8px inside a pair against 71px
    to the next column's name — **8.9x**.
  - **The label-only-when-it-differs rule now reads as a MARK, not as a missing word.** 32 of 40
    lines carry no badge. A missing word looks like missing data; a line with no badge beside a
    line with one is a shape. The key caption states it: *"a service with no `AS` badge ships this
    revision under its own sha."*
  - **The list and the detail page's `What each service ships it as` are one idea at two scales.**
    Both print the service name in `t-dense` gray-700 and then a joined chip whose VALUE half is
    the label. Only the chip half differs, and the difference is the two criteria: the list
    qualifies the label by the RULE (`as`), because list rule 2 already spends rank on row
    position; the detail qualifies it by the RANK against that service's own ladder
    (`[NEWEST][1.66.0-66] of 4`), because its criterion 2 is that question at full depth.
  - `.rev-svcs`'s track floor moved **192px → 240px**: the badge's two borders, two 6px paddings
    and the `AS` half widen the widest live pair to ~232px, and below the floor `hello-world-app`
    and `hello-world-manifests` truncate to the same string — the exact defect that killed round
    two, one level up. `.rev-svc-label` is deleted.

- ✅ **2026-08-26 — THE DOC PASS. This file had gone stale in ten places and a stale rule is
  worse than no rule.** A previous round had an agent restore a legend this file still
  endorsed. Corrected, each verified against the code rather than against another paragraph:
  `/apps` is FOUR tracks, not five, and the `head <sha>` badge lives inside the Fleet cell;
  `/apps/[name]` is Direction B, NOT the commit spine and NOT the two-pane workspace, and
  `PromotionLadder` plus eight sibling modules are deleted; the env identity ramp section
  named the reverted teal/rust seeds beside a top-of-file section saying the opposite;
  `bandColor` / `--rollout-theme-band` were documented as existing and do not; the
  banned-token debt table was measured before the six-page rebuild and every number in it was
  wrong (`ResourcesCard` recorded 12, actual 1); the `/apps` footer legend, its dummy ruler
  and the empty state's fake row are all deleted and the file still described the encoding
  they taught. **The FIELD CEILING section and the shipped `CoverageBar` were re-checked and
  AGREE** — five buckets, `live` `#426d64`/`#83b0a8`, `notYet` amber, `failing` red, two
  grays, `.prop-bar` 4px radius / 1px gutter / 6px floor with the miniature's own 4px.

- ✅ **2026-08-26 — THE VOCABULARY PASS. Six rebuilt pages read side by side for the first time.**
  Four agents each rebuilt a page to its criteria and nobody owned the vocabulary ACROSS them.
  Three findings, all fixed; the censuses and the arguments are above under "THE FIELD CEILING"
  and "ONE PROPORTIONAL BAR".
  - **`CoverageBar`'s `live` was gray and is now the quiet mint.** Reversed with the field ceiling
    re-derived for a page whose primary mark is an area rather than a chip. **Zero new colour
    values.**
  - **`.prop-bar` and `.cov-swatch` are shared atoms in `app.css`.** `CoverageBar` and
    `ExposureBar` had two geometries and two answers to their one shared segment; they now have
    one of each and supply only their own height.
  - ⛔ SUPERSEDED 2026-08-27 — `FleetRuler` is DELETED, see the top of this section.
    **`FleetRuler` draws a TRACK per slot.** The 3px stub plus a 1px baseline was written against
    a 9- and 13-environment fixture; on the live cluster's three converged environments the column
    read as an underscore with a speck on it, on the page the human opens most. Twelve visible
    stations, one lit — the same picture at N=3 and at N=13. Zero new colour values and zero
    colour COST: the track is the stub's own achromatic `gray-200 / gray-700` at 5x the area.
    **What this trades:** the ruler no longer matches `DeployVolumeSparkline` pixel for pixel in
    the adjacent column. Argued and accepted — a time series is read as an ENVELOPE and its empty
    buckets are correctly nothing, while a rank scale is read as a POSITION and its empty stations
    must be visible or there is no scale to be positioned on.
  - **Off-scale spacing swept from the pages in this pass:** `gap-0.5` (2px, ×6 on
    `/environments`, ×1 on `/envs/[name]`) → `gap-1`; `py-0.5` on `/apps` → dropped. 2px was an
    undeclared third sub-scale value; the only two are the chip's 6px and the histogram 1px.
  - **Dead code removed, each verified at zero call sites first:** `PromotionLadder.svelte`,
    `view-models/promotion-ladder.ts` (+test), `RegionSet.svelte`, `MatrixCell.svelte`,
    `LagChip.svelte`, `StatusTile.svelte`, `view-models/release-frontier.ts` (+test), and
    `revisionVerdict` / `serviceWhere` from `revision-ledger.ts` (+their tests). `regions.ts` is
    KEPT — `regionLabel` still has three call sites — but `splitRegions`, `modalBuild`,
    `regionLaggards`, `regionSummary` and `REGION_TILE_GRID_STYLE` lost their last consumer with
    `RegionSet` and are now test-only. Sweep them when that page's shape settles.
  - **Reported, NOT fixed, because it is another page's lane.** `/rollouts` — one of the three
    pages the human names as best — has the product's worst spacing census: `gap-1.5` (6px, ×35),
    `gap-2.5` (10px, ×30), `px-2.5`, and a `6px 12px 6px 32px` padding. Both gap values are off
    the 4/8/12/16/24 scale. **This is worth stating plainly: the human's taste and the measured
    discipline do not coincide, so a clean census is a floor and never the bar.** The three
    revision/environment pages are the CLEANEST in the product on radius and spacing and were the
    ones called "absolutely underdesigned".
  - **Measured after, all 8 pages at 1440 light.** ONE chip geometry product-wide —
    `20px · r4px · 10px/600 mono`, with only the fill and the seam partials varying. Radii:
    `4px`, `12px`, `rounded-full`, plus the two joined-chip partials — no page has a fifth.
    Visible text colours per page: `/versions` 4 (all gray, zero chromatic), `/apps` 6,
    `/environments` 8, `/versions/<rev>` 10, `/` 9, `/rollouts` 10, `/apps/<name>` 12 — and every
    chromatic one is a chip label or an env identity ink. **Zero coloured prose on any of them.**

- ✅ **2026-08-26 — `/versions` and `/versions/[...slug]` are RELEASE COVERAGE.** The human:
  *"Revision list and revision detail look absolutely underdesigned. It feels like you're just
  putting data onto screen instead of designing beautiful components that makes it easy to grasp
  what's the state of things."* The cause was structural: `Dashboard IA Proposal.html` ends by
  ASKING whether a Version entity deserves its own page and never answers, so this was the one
  pair the design project never decided. It is decided now, from `fleet-explore.js` concept 07
  ("take one build and ask how far it has reached across the fleet"), with criteria written in
  `.agents-context/design/REVISION-PAGES.md`.

  **The object is one COVERAGE BAR, and it is the same component at both scales** —
  `components/CoverageBar.svelte`, 26px on the detail page and 8px in a fixed list column, fed by
  the same five buckets from `view-models/revision-coverage.ts`. Detail then gets one CARD per
  non-empty bucket listing its places; the list gets one row per revision.

  - **THE BUCKETS ARE `live · failing · ahead · notYet · unplaceable`, and the fifth is an
    admission.** Concept 07 names four. When a service's ladder cannot place either this build or
    the build an environment is running, "ahead" and "not yet" are both unsayable, and folding
    those slots into `ahead` would turn an absence of evidence into a claim about direction.
  - ⛔ **SUPERSEDED 2026-08-26 — `live` IS CHROMATIC. See "THE FIELD CEILING" above.** This entry
    originally recorded that *"a coloured field of this size cannot exist in this product"* and
    shipped `live` as `gray-500`. That conclusion was wrong on its own arithmetic (the mint is
    5.7x the alarm, inside the 10x bound it invoked), wrong on the search (it only tested light
    `-100`/`-200` tints, where legibility needs chroma; a dark low-chroma green is legible at 8px
    on LIGHTNESS), and wrong on the axis (`gray-500` means `onNewest`, a RANK verdict, and
    `Live here` is `Succeeded`). `live` is now the quiet mint `#426d64` / `#83b0a8`. The rest of
    the palette is unchanged and is still `/apps`'s `STATUS_DOT_CLASS` with two substitutions:
    `live` mint, and `ahead` at `gray-300 / gray-600` rather than the dot's `gray-200 / gray-700`
    (measured, `gray-200` on a white card is 1.2:1 and `gray-700` on the dark card is 1.3:1, and
    at 8px that is the invisible-axis defect). The rule the five values obey is
    **chromatic = about this build, achromatic = not**.
  - **`min-width` on a segment is load-bearing.** 6px full / 4px compact. One place inside a
    13-environment fleet is 5.6px of a full bar and 0.9px of the miniature, and a segment that
    thin is a rendering artefact, not a mark. Costs the majority bucket a few pixels of
    proportion; buys "this bucket is not empty".
  - **The list is the detail page at one row per revision, and the ARGUMENT is that counts do not
    compare.** On the live cluster `9f10e49` reads `14 of 15` and `7cdafab` reads `1 of 9`, because
    a revision's denominator is the slot set of the services that carry IT. Two fractions with
    different denominators do not compare down a column; the same proportional bar does. The
    absolute count keeps its own fixed column, because `1 of 9` and `1 of 15` are different facts
    once you have picked a row.
  - **BUCKET CARDS GROUP TWICE — by service, then by what each place is running.** One row per
    place printed the same strings once per place: `Live here` printed `hello-api-app` and
    `1.66.0-66` four times each over 14 rows, and `Moved ahead` printed `now on 9f10e49` EIGHT
    times. Grouped, criterion 2 is answered STRUCTURALLY — the service and what it calls the build
    ARE the group heading — and environments become CHIPS THAT WRAP rather than rows that stack, so
    `edge-mesh` costs one wrapped line per service at 13 regions where it cost thirteen rows.
    `Not yet` keeps one row per place, because there each place has its own gate and its own action.
  - **`max-w-none` on the env chip inside a bucket card, and only there.** `.chip` caps at 12ch,
    which is right in a fixed table track and wrong in a list: `prod-ap-south`, `prod-us-east` and
    `prod-us-west` all ellipsised to `PROD-AP…` / `PROD-US…` / `PROD-US…` — two different regions
    rendered as the same string, the exact defect that killed the `/apps` convergence bar.
  - **Criterion 3 names a cause only from the field that established it.** `Not yet` prints
    `waiting on <gates>` only when `promotionBlock().blockingGates` is non-empty (on the live
    cluster: `waiting on hello-world-manual-approval, schedule-gate-q25wv`), and otherwise states
    the observable — `still on 2a55f0c`. It deliberately prints NO second number beside the `−N`
    chip: a distance from THIS build would be a different, equally true number 20px from the
    product-wide rank, which is the two-denominators defect.
  - **`Promote` moved OFF the list and onto the detail page's `Not yet` card**, where the row that
    states the problem carries the action. Same `ChangeVersionModal`, same `isDeployable` gate, no
    new mutation path. The list is read-only, which is what `/apps`, `/rollouts` and every other
    list in this product already are.
  - **The disconnected-GitHub state is the SHIPPED state and reads as one muted line** —
    `Commit message and author need GitHub, which is not connected.` It takes no data row and no
    second button; the navbar already carries the one `Connect GitHub` control, 40px above. The
    old full-width `What changed` panel is gone: it existed to fill 332px of empty main, and the
    bar plus the bucket cards fill it now.
  - **Kept, unchanged:** revision keying (11 rows for 11 revisions), the print-the-label-only-when
    -it-differs rule, the `11 of 37 revisions deployed` scope line, and the 12-char slug with its
    back-compat resolution — verified, an old label URL (`…/1.66.0-66`) and a 7-char sha both
    canonicalise to `…/9f10e494d560`.
  - **Verified** at 1440 / 1280 / 390 in both themes, on the live cluster and on `MOCK_API=1` for
    the shapes it lacks (a `Failed` deploy, 13 regions, a diverged region). 390 `scrollWidth ===
    clientWidth` on both pages. `svelte-check` unchanged at 4 errors / 4 warnings. Census on the
    detail page: radii `4px` / `12px` plus the chip seam's two partials; padding `24` / `0 12` /
    `12 16` / `0 6`; gaps `1` / `4` / `8` / `12` / `16`; nine type roles, all from the scale.
  - **One tension, since resolved.** A `Failing on it` bucket that dominates the bar paints
    ~12,700px² of `red-700`, ~17x the `alarm` chip's ink. That is legal and always was — see
    "THE FIELD CEILING", which is the rule this observation was one step away from: on that page
    the red segment IS the alarm, and a field is ranked by chroma density rather than total ink.
    The clause that still binds is §3 — put a coverage bar in a fixed list column beside a chip
    and it is a MARK again, bound by the total-ink cap.


- ✅ **2026-08-26 — `/apps` and `/apps/[name]` are rebuilt against `PAGE-CRITERIA.md` §03.**
  Both pages had a criteria rubric for the first time, and neither answered it.

  **`/apps` — FOUR fixed tracks: `App (1fr) · Fleet by build (232px) · Deploys·7d (128px) ·
  Lead (76px)`.** It shipped with five; `Head` was dissolved the same day (see "THE RULER
  TEACHES ITSELF" below) and the `head <sha>` badge moved INTO the Fleet cell, 8px off the
  ruler's right edge. Do not re-add a `Head` column. The row was a
  CONVERGENCE BAR (one joined `[status][ENV][−N]` box per environment, wrapped). It answered
  "which environment is behind" precisely and answered none of the page's three questions.
  Measured on the 13-environment fixture it took THREE wrapped lines and printed `PROD-US…`
  four times — four different regions ellipsised to the same eleven characters, so the one
  thing the box existed to carry was the thing the width destroyed. It also cost
  O(environments) of row height against a criterion whose own words are "legible at 50".
  - ⛔ **SUPERSEDED 2026-08-27 — every bullet from here to the end of this entry describes the
    12-SLOT RULER, which is DELETED.** `/apps`'s criterion-1 object is `FleetStrip` — one mark per
    environment, grouped by build. See the 2026-08-27 entry at the top of this section for the four
    measurements. What survives from the bullets below: `Lead` is unchanged, the sort is still
    worst-first with fleet FRAGMENTATION as the first tiebreak (it now counts distinct BUILDS,
    including diverged ones), env identity is still re-allocated rather than deleted, and the
    footer legend and its dummy graphic are still deleted and may not come back.
    **THE FLEET RULER** (`components/FleetRuler.svelte`, `view-models/fleet-ruler.ts`) was the
    object. A 12-slot histogram of build RANK, newest at the RIGHT, bar
    height = how many environments run that build. One tall bar hard right = converged;
    bars trailing left = scattered. **Position, not hue** — the same substitution
    `PromotionLadder` made when it replaced the Gantt, so per-sha colour and the Ember ramp
    both stay dead. Zero new colour values: `BAR` is character for character `/apps`'s
    `STATUS_DOT_CLASS`, a settled bar is GRAY, and a column takes a status hue only when an
    environment in it is failing / stuck / deploying / baking.
  - **The 1px baseline is load-bearing, not a frame.** Without it the ruler is 12 bars of
    which ~2 are occupied and 10 are a 3px `gray-200` floor at 1.24:1 — the AXIS is invisible,
    so POSITION cannot be read and the encoding collapses to "some bars, somewhere".
  - **The ruler sets no width of its own.** 96px in the fixed column, 160px at phone width,
    both from the caller via `.fleet-ruler`. 216px was tried and reverted: at 18px per bar a
    saturated block stops reading as a mark on a scale and starts reading as a segmented
    progress bar, which the enforced rules delete on sight.
  - **`Lead`** (`view-models/lead-time.ts`) is the MEDIAN measured time from the first
    environment to the FIRST production region — production is a SET, so arrival is first
    arrival. Median, never mean. Returns null and prints an em-dash when no build was
    observed making the whole trip inside the retained history.
  - **Env identity is re-allocated, not deleted.** The lede sentence names the worst
    environment in words, and failing / stuck / diverged environments still get their own
    named box. What is gone is the twelfth copy of `−1` on an app where every region is one
    build behind — that is a shape, and the ruler draws it in 96px.
  - **Sort is worst-first with fleet FRAGMENTATION as the first tiebreak.** An app whose
    environments sit on four builds is a worse fleet than one on two, at equal lag.
  - **THE RULER TEACHES ITSELF; BOTH TEACHING GRAPHICS ARE DELETED (2026-08-26).** The page
    ended in a FOOTER LEGEND — a miniature FAKE ruler beside the sentence *"Fleet: one bar
    per build, height = environments on it, newest build at the right."* The human liked the
    object and named the defect exactly: *"it could be better designed instead of explaining
    it with the dummy graphic."* **A legend drawn from a graphic that is not the real object
    is an admission that the real object does not explain itself.** The empty state's faded
    SAMPLE ROW (dummy app name, dummy ruler, dummy head chip) went with it, and it had
    already drifted: it still drew the pre-2026-08-26 baseline-and-stub geometry, i.e. a
    teaching graphic teaching the wrong shape. **Neither may come back.** The sentence's
    three clauses were re-homed instead: *"one bar per build"* → the column header reads
    `Fleet by build` (and is the cell's own inline label at phone width, where there is no
    header row); *"newest at the right"* → the `head <sha>` chip, 8px off the last station,
    so the axis terminates in a named build instead of in whitespace, plus a darker rank-0
    station (`FleetRuler`'s `HEAD_TRACK`); *"height = envs on it"* → the caption
    `2 of 3 on head`, 4px under the bars.

- ⛔ **SUPERSEDED — the entry below describes `/apps/[name]` as the COMMIT SPINE with a
  `PromotionLadder`. IT IS NEITHER.** The ladder was rejected by the human a second time
  (*"i don't like version ladder"*) and `PromotionLadder.svelte`,
  `view-models/promotion-ladder.ts`, `RegionSet.svelte`, `MatrixCell.svelte`,
  `LagChip.svelte`, `StatusTile.svelte`, `view-models/release-frontier.ts`,
  `lib/ember.ts`, `VersionGantt.svelte` and `view-models/gantt.ts` are all DELETED — nine
  modules, verified at zero call sites. **The shipped page is Direction B (Act / State):**
  a `Needs a decision` task list with every button on the page, then read-only state —
  `StageChain` (one node per stage, the hop between them), a production FLEET block
  (regions are a SET, so nodes and no rails, under a verdict in words: `all agree` /
  `3 builds`), and `ActivityRail` for the history criterion. **No ladder, no Gantt, no env
  cards, no ledger table.** The measurements below about the growth curve of env cards are
  still true and are why the card form is not coming back; every sentence about a ladder,
  a spine, a commit row, `markHref` or a folded `PROD ×N` rung is not.

- ⛔ SUPERSEDED — see above. **2026-08-26 — `/apps/[name]` is the COMMIT SPINE with a decision list above it. The
  two-pane workspace is deleted.** `HANDOFF.md` §5 (env cards) and `PAGE-CRITERIA.md` §03
  (commit spine) are different answers to the same page. The spine wins, measured:
  - **Growth curve.** On `payments-core` (9 environments) at 1440x900 the nine env cards
    spanned y=184 → y=1,716 — 1,532px, ~170px per environment — and the ladder, the object
    that answers all three criteria, started at **y=1,761**. Two full folds below the fold.
    After: the ladder starts at **y=418** and the whole page ends at 940px. `edge-mesh`
    (13 environments) went from a projected ~2,200px of cards to a ladder top of **y=316**
    and a 900px page. An environment's pin docks onto a build row that already exists, so
    **N envs cost zero rows.**
  - **Criterion 3 is the separator.** "Is its prod fleet consistent?" — the spine answers it
    as a SHAPE with no reading at all (agreeing regions fold to one `PROD ×N` chip on one
    row; a split fleet is marks scattered down several rows with a 1px rule measuring the
    split). The card form answers it by making a person read nine `−N` chips down 1,532px
    and hold nine numbers in their head. That is not a worse rendering of the answer.
  - **The split is by INTENT, per `DESIGN-INTENT.md`'s Direction B**, not by layout:
    `Needs a decision` (failing · stuck · blocked · diverged · pinned, action on the row,
    every button on the page) then the read-only ladder. **Being behind is NOT a task** —
    drift is the pipeline working, and putting a row and a button on it would put twelve of
    each on `edge-mesh`, which is the growth curve this rebuild exists to get off.
  - **A diverged environment is MARKED on the ladder, not filtered out** (it used to be
    filtered). Now that the ladder is the page, an environment absent from it cannot be
    located at all, and on `payments-core` it left the `−2 d0ff17e` row standing with no mark
    and no explanation. The mark claims only "this environment runs this build", which is
    observed; the word `diverged` is carried on the task row, in red, with the action.
  - **A healthy environment no longer carries `Change Version` on this page.** Direction B's
    own rule — the right half is read-only and never duplicates the left. Every env chip in
    the ladder is now a LINK to that rollout's page (`PromotionLadder`'s new `markHref`),
    which has the same three buttons plus the gates, pods, logs and history that make a
    version change a decision rather than a guess. A FOLDED `PROD ×4` mark resolves to no
    link: it stands for four rollouts, and a single destructive target chosen silently is the
    same defect as a merged ledger row carrying a control.
  - **The primary button is an explicit class override, not Flowbite `color="dark"`.** That
    colour resolves to `bg-gray-800` in both themes, which on a `gray-800` card made the
    primary the QUIETEST button in the row. `DESIGN.md` specifies the inversion
    (`bg-gray-900 text-white`, dark `bg-white text-gray-900`) precisely so the button is loud
    by CONTRAST, costing zero colour budget.

- ⛔ **SUPERSEDED TWICE — the two-pane workspace is DELETED, and so is the spine that
  replaced it. See the Direction B note above.** Kept only for the human quote and for the
  container-query lesson, which outlived the component: **card breakpoints must be CONTAINER
  queries, not `sm:`/`lg:`**, because the sidebar is 176px at `sm`+ and absent below, so the
  content box is not monotonic in viewport width. `/apps` uses the same rule today.

  **2026-08-26 — `/apps/[name]` is the two-pane workspace. "The frontier" is deleted.**
  The human, on the single full-width build table that stood here: *"App detail barely
  changed. I don't like frontier. It's even worse than what we had previously … It feels
  like you're just putting data onto screen instead of designing beautiful components that
  makes it easy to grasp what's the state of things."* Rebuilt from `HANDOFF.md` §5:
  `lg:grid-cols-[1fr_320px]`, one env CARD per cell on the left in promotion order
  (`compareEnvironmentNames`), the `ActivityRail` restored on the right and sticky, and the
  version ladder full width below both columns. Card header is
  `[status circle] · [env badge] · [namespace] · [rank chip] (· held · alarm)` with the
  rollout-detail button row — `GitHubViewButton` / `Change Version` / `Rollback`, Flowbite
  `Button size="xs" color="light"`. Card body is `Version` · `State` · `Recent deploys`
  (`DeployHistoryStrip slots={5}`). **No Gantt** — the tombstone below still holds; §5's
  "compact Gantt + range picker + version ladder legend" is served by `PromotionLadder`,
  whose `All N builds →` is the ladder's own analogue of a range picker (the ladder has no
  time axis, so a time window has nothing to window).
  - **Card breakpoints are CONTAINER queries, not `sm:`/`lg:`.** The sidebar is 176px at
    `sm`+ and absent below, so the content box is not monotonic in viewport width. 540px
    switches the body from the phone form (Version | State side by side, strip spanning) to
    §5's 3-column split; 740px puts the button row back on the header line; 479px drops the
    button icons so three buttons fit one line.
  - **Phone geometry, measured at 390x844:** `scrollWidth === clientWidth`, cards 248px,
    production's card top at 786. With three environments and a fixed `MobileTabBar`, only
    two cards fit above the fold — that is inherent to "one card per environment", and the
    adverse fact is carried above the fold by the verdict sentence, not by the card.
- ✅ **2026-08-26 — status circles carry their colour again.** `getStatusCircleClass` had
  been flattened to one neutral gray ground for every status. From the human: *"I generally
  think we're undercoloring now a bit"*. It returns the per-status `-100` tint again
  (green / red / YELLOW baking / BLUE deploying / gray pending), which restores the atom
  `HANDOFF.md` §3, §5, §6 and §7 all name by name, on every page that draws it. Measured, a
  32px `green-100` disc is ~35 ink units against the `alarm` chip's ~159, so the disc is
  4.5x quieter than the alarm and the "nothing out-shouts the alarm" invariant holds. The
  budget is six hues and it exists to be SPENT, not minimised.
- ✅ **Handoff v3 — real pipeline data + polish pass.**
  - **Pipeline glyph uses real KruiseRollout stages.** Backend list endpoint (`main.go`) now returns `kruiseRollouts` (lightweight list across queried namespaces) using new `GetKruiseRolloutsAllNamespaces` / `GetKruiseRollouts` helpers. Frontend correlates each kuberik Rollout to its KruiseRollouts via the linked Kustomization's inventory entries (`{ns}_{name}_rollouts.kruise.io_Rollout`) in new `lib/pipeline.ts`. PipelineGlyph now takes a `stages: StageState[]` array; RolloutGrid passes `buildPipelineStages(rollout, kruiseRolloutsForRollout(...))`. Falls back to a synthesised glyph when no KruiseRollouts are linked yet.
  - **Top-right header meta reordered** to `LAST 24H · [spark] · N deploys` to match the design — previously it was `N · deploys · 24h · [spark]`.
  - **Removed `query.isFetching` refetch spinners** from every page (rollouts, apps, environments, env-detail, namespace-detail, app-detail, activity). The brief flicker after each 10–15s poll read as a visual bug; the dashboard now refetches silently.
  - **Command palette env badge** — `getRolloutEnvironmentTheme(r)` was called without the Environment object so rollouts without `environment-theme-*` annotations (e.g. `kuberik-demo-app`) showed no badge. Now passes the matching `Environment` from the list, so every rollout that has an Environment binding gets a badge.
  - **Activity row alignment** — locked the status-circle column to 28px and moved the vertical rail to `left-[30px]` so it passes exactly through every circle center. Bumped the circle to `h-7 w-7` to match the rail column width, and tuned the outer ring to `dark:ring-gray-900` so it matches the page background instead of the card.
  - **Rollout-detail tabs: no horizontal scroll on mobile** — the tabs row dropped `overflow-x-auto`. On `<sm` viewports the labels hide (`hidden sm:inline`), tabs split evenly across the row (`flex-1`), and the four icon-only tabs always fit without scrolling. From `sm:` upward the labels reappear and tabs revert to flex-initial.

- ✅ **Handoff v2 — alignment + rank pass.** Pinned all list-view rows to fixed-width grid templates so columns line up across rows and across sections.
  - **Rollouts list** (`RolloutGrid.svelte`, `app.css`): grid template `40px 1fr 140px 70px 110px 60px` at `lg`, with a sticky column-header row (`Rollout · Pipeline · 24h · Version·age`). Replaced per-env stat tiles with compact env filter pills next to the search input.
  - **Pipeline glyph** (`PipelineGlyph.svelte`): now 9 synthesised pipeline stages derived from `latest.bakeStatus` + `categorizeFailure(latest.bakeStatusMessage)`. The failure category controls where the red dot lands (`test=1`, `image=2`, `gate=3`, `healthcheck≈6`, `timeout=8`) so failures don't look like "5 empty slots + 1 red". Connector bars are `w-2 h-px gray-300`.
  - **Rank logic (`AppVelocityCard.svelte` + `apps/[name]/+page.svelte`)** — replaced deploy-timestamp-based ranking with **`version.created`-based release order**. A version pinned in staging no longer reads as "newer" than an unpinned version released later. Demo cluster: PROD (`f960d39`) now correctly shows `newest`, STAGING (`75945b5`, pinned) shows `−1 from newest`. The app-detail per-env rank chip uses the same `versionReleaseRank` lookup.
  - **Apps list** (`apps/+page.svelte`): stripped the search bar and per-env summary tiles per the design — only stat tiles + 2-up `AppVelocityCard` grid remain.
  - **Environments list** (`environments/+page.svelte`): rows pinned to `36px 1.5fr 180px 110px 60px` template so status / title / history-strip / version / age line up across env sections. Version and age use `justify-self-end`.
  - **Gantt** (`apps/[name]/+page.svelte`): switched lane header + lane rows to a shared grid template `80px minmax(0,1fr)` so the env-badge column and tick header align by definition (was flex+width before). Time range picker now offers `1h / 6h / 12h / 24h / 7d / 30d / all`.
  - **Activity page** (`activity/+page.svelte`): rebuilt to match the design — `Activity · N events · last 7 days` header with a 20-bucket 24h sparkline + total on the right; status-class filter chips (`All / Deploys / In progress / Failures`) on the left and env filter chips on the right; cluster headers with count chip; per-row format `[status circle] · [time] · [actor] [verb] [app] to [ENV badge] [version] · [status]` with `was <prev>` line-through on the trailing right; vertical timeline rail through the dots in each cluster.
  - **Activity rails** (`apps/[name]`, `envs/[name]`, `namespaces/[name]`, `ActivityRail.svelte`): replaced the `bg-gradient-to-b … to-transparent` spine with a solid `bg-gray-200 dark:bg-gray-700/80` line so it doesn't read as a fading "thin line".
  - **Per-row 24h sparkline** (`DeployVolumeSparkline.svelte`): added a `buckets` prop so callers can decouple bucket count from window length. Rollouts list passes `hours={24} buckets={12}` (2h buckets → wider, more visible bars). Bars switched to emerald with a 30% minimum height so they read at a glance.

- ✅ **Handoff redesign landed (7 pages):** implemented the design-handoff bundle (`/tmp/claude/kuberik_design/...`).
  - Rollouts list: per-row 6-dot **pipeline glyph** (`PipelineGlyph.svelte` — last 6 history outcomes coloured by `bakeStatus`) and per-row **24h hourly sparkline** (`DeployVolumeSparkline` extended with `hours` prop). Title column now carries the diagnostic line (failed / behind / baking / deploying); version+age merged into a single right-aligned column.
  - Apps list (`/apps`): replaced per-app panel with **Velocity Cards** grid (`AppVelocityCard.svelte`, `grid-cols-1 md:grid-cols-2`). Each card has header + per-env lane chart (stable per-version palette, current segment ringed by status colour), per-lane rank chip (**`newest`** in mint, **`−N`** in **neutral gray** — never amber), and a newest-first version legend.
  - Environments list (`/environments`): replaced matrix layout with **stacked env sections**. Each section has a tight header (env badge · counts · 24h sparkline · app count) and a per-app row with a 6-tick deploy history strip + one-line summary ("all recent succeeded" / "2/6 failed" / "currently deploying" / "stuck — see detail").
  - App detail (`/apps/[name]`): replaced promotion-flow + 5-col grid with the **two-pane workspace** (`lg:grid-cols-[1fr_320px]`). Left column has per-env action cards (status circle · env badge · namespace mono · rank chip · `View on GitHub` / `Change Version` / `Rollback` button row matching rollout-detail), with 3-col body (Version · State · Recent deploys 5-tick strip). Right rail keeps the existing activity timeline. Compact Gantt with range picker + version ladder lives below.
  - Env detail (`/envs/[name]`): added the **metrics strip** (Apps · Deploys 24h + spark · Median bake · Promotion rate) and a per-app inline **promotion chain** (env chips ordered by `compareEnvironmentNames`, current env mint-highlighted, joined by `ChevronRightOutline`, "only bound to X" fallback for single-env apps). No env-level chain.
  - Namespace detail (`/namespaces/[name]`): replaced correlation-timeline + 3-col card grid + deployment-timeline with a **mini dashboard**: 4 stat tiles (Rollouts · Healthy · Failing · Deploys 24h + spark) + `lg:grid-cols-[1fr_320px]` body (rollouts list left, activity rail right).
  - Activity (`/activity`): clusters now include **"In the last hour"** and **"Older"** in addition to Today / Yesterday / weekday. Row copy switched to actor-verb format: `[actor] [verb] [app] to [env]` with `previousVersion → currentVersion` chip on the right.

- ✅ Restored section breadcrumb as a static link (`Apps`, `Environments`, etc.) in the navbar — sidebar is the switcher, the navbar label is just a link.
- ✅ Sidebar is collapsible with a toggle at the bottom, state persisted to localStorage.
- ✅ Magnifying-glass search button removed; ⌘K kbd hint lives on the rollout breadcrumb selector.
- ✅ ⌘K palette rebuilt as a unified surface (`CommandPalette.svelte`) that searches across rollouts, apps, environments, namespaces, and top-level pages with kind-aware scoring and grouped sections.
- ✅ /apps/[name] promotion flow now uses Svelte Flow + dagre; auto-reflows LR ↔ TB based on viewport. **Not pannable, not zoomable** — like /rollouts/[ns]/[name]/environments, it fits-to-view only.
- ✅ Rollout detail layout converted from a side sub-sidebar to horizontal top tabs (Overview / History / Environments / Logs). Eliminates the double-sidebar that used to appear next to the global sidebar.
- ✅ /apps/[name] version lifecycle is now a proper Gantt. One lane per env, each deploy a colored bar that runs until the next deploy in that env (or 'now'). Same version uses the same palette colour across lanes so a version's promotion arc traces visually. Has a real time axis with hour/day/week ticks, a 'now' edge marker, and a version-colour legend below.
- ✅ Gantt surfaces version ordering: each bar shows the version name plus a `−N` chip when behind the newest. The legend below is now a "newest first" ladder showing every version with its `newest` / `−N` rank.
- ✅ Mobile rollout-detail tabs no longer render a horizontal scrollbar (`.no-scrollbar` utility hides chrome on overflow-x).
- ✅ Promotion-flow SvelteFlow now reacts to container resize via ResizeObserver + `useSvelteFlow().fitView()`. Component is wrapped in `SvelteFlowProvider` so the hook is reachable. Orientation flips LR ↔ TB based on container width, not just initial viewport. Background and edge labels restyled to match dashboard chrome.
- ✅ Command palette has scoped levels:
  - ⌘K opens the global multi-type view.
  - Clicking a section name in the navbar breadcrumb opens the palette **scoped** to that kind (rollouts / apps / environments). The scope appears as a removable chip next to the search icon; placeholder updates to match.
  - First ESC clears the scope back to global; second ESC closes. Backspace on an empty query also pops the scope.
- ✅ Home rollout-list page header aligned with /apps: title stacks above meta on mobile, meta is a single line of count chips and the deploy-volume sparkline. Removes the unique "Recent 24h deploys" link element that made the header feel different from the other lists.

## Working principles

- Always test mobile AND desktop before declaring something done.
- Check this document before adding any new visual element.
- When new feedback lands, append it here so it survives session compaction.
