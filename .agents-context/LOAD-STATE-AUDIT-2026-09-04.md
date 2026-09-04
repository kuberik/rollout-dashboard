# Load-state audit — 2026-09-04 (ic-design-reviewer, read-only, dev server, 1440 + 390, light; dark spot-checked)

Instrument caveat: from `sm` up `<main>` is the scroller, so `document.scrollHeight` is 900 on every desktop route; CLS-style checks read zero. Every shift below is inside `main`. Re-verification scripts: `.agents-context/tools/loadaudit/` (`pair.mjs --url … --w 390 [--dark] [--delay ms]` writes A-loading/B-loaded shots + `pair.json`; `frame-diff.mjs`, `perendpoint.mjs`, `schedlate.mjs`, `navbar.mjs`, `logsbar.mjs`, `batch2.sh <width>`). They stub the vite HMR socket; if `pair.mjs` prints `document navigations between the two states: N > 0`, discard the run. `page.evaluate` with a string starting `() =>` returns undefined — pass real functions.

## Findings, ranked (a = no placeholder, b = placeholder with wrong geometry, c = late enrichment that moves things)

1. **Rollout detail Overview** (a). The right rail assembles top-down: `Recent events` starts at y=186 (1440) / 947 (390) and ends at 678 / 1663 (+492 / +716 px). Pipeline card grows 184→285 (390: 225→357) when managed-resources arrive; action row gains `Change Version` + `Rollback` when permissions arrive. The rollup prints **`2/2 done`** then `5/5 done` — a finished sentence that is false. Ten requests, re-render on each.
2. **/activity** (b). The live `All / In flight / Failed / Rolled back` pill row renders at y=97 then drops to 470 (390: 538) because the 325 px chart card and head band have no placeholder. Placeholder rows 52 px vs real ~40 px.
3. **Rollout detail tab strip** (a). Three tabs then four: `Logs` moves +147 px at 1440; at 390 the `flex-1` tabs re-width 114→86 so `History` moves −42 px and a finger over it lands on `Dependencies`. Sticky chrome must be arity-stable: reserve the `Dependencies` tab (disabled) or fix tab widths.
4. **Wrong gate kind until /schedules arrives** (c, breaks the truth rule). Three call sites say **`A check is not passing`** and then `reopens 1:00 PM` / `Outside the Business Hours Only deploy window`: `/` held card (no height change), `/dependencies` graph node (+14 px), rollout Dependencies tab node (+24 px). `/rollouts`, `/apps`, `/apps/<name>`, `/environments`, `/envs/prod` are text-identical under the same delay, so this is three call sites, not the model.
5. **Navbar** (c, every route). `Connect GitHub` inserts after `/api/auth/github/status`; Search moves −166 px (1440) / −113 px (390). Reserve the slot.
6. **/rollouts** (b). Skeleton omits the 44 px search input and the chip block (4 wrapped rows ≈130 px at 390); first card lands +115 (1440) / +249 (390). Skeleton draws bordered group containers the 390 page does not have; rows full-width vs 2-column 395×141 cards.
7. **/environments** (b). Grid x/width exact (200/606/1011 × 390) but y 97→317 (+220): head band (28) and the amber blocking banner (1201×142) have no placeholder. Cards 256→378.
8. **/** (b). Skeleton = 112 px bar + three 392-wide cards; page = 28 px head band + two 425-wide card columns + a 318-wide right rail with no placeholder at all. First card jumps up 52 px. 390: 4×112 blocks vs 95/72 px cards, first card −48 px, no `Held 4` section header placeholder.
9. **/revisions** (b). The full-width `Newest build in use` hero (1201×388) has no placeholder; both columns land +427 px.
10. **/apps** (b). Skeleton is one 1201-wide card; page is head band + amber banner (1201×142) + 865-wide list + 320-wide rail. At 390 the row skeleton's `hidden sm:block` cells collapse so the phone skeleton is partly invisible.
11. **Rollout /history and /revisions/<slug>** (a). A lone centred spinner, then a full composition (Timeline 1201×253 + Deployments 1201×373; slug page: 2×593×341 + 2×593×242). Two loading vocabularies for one object, one tab apart.
12. **Change Version step 2** (a + c). `Commits to revert` body is the literal `Loading commits...`; the gate row prints the raw id **`GHD-XM669`** then `AFTER STAGING`. Step 1 is clean (82 ms, no network, stable).
13. **/envs/prod** (b). 560 px placeholder band for a 122 px first card (origin +48, first block 134 px too tall), rail unrepresented.
14. **Logs toolbar** (c, nitpick). `Containers` inserts and moves `Source` −115 px, −16 px. Otherwise the Logs tab draws all its chrome at rest and only the pane fills — the model page.
15. **Change Version step 1→2** widens 512→896 px (x 464→272) — instant, not data-driven; nitpick.

Clean: command palette (populated at 18–20 ms), in-app navigation swaps to the destination skeleton at ~208 ms (does not hold the stale page), tab switches Overview→History/Logs one step ~203 ms, dark geometry byte-identical, polling never re-enters loading.

## Principles for the fix
1. A skeleton is a composition, not a texture: flip test between skeleton and page — nothing may move. Author it from the same container/grid/rail and the same Card primitive.
2. Reserve fixed chrome first (head band 28, search 44, chip block, section labels, card headers 47, tab strips, toolbars): free, and where the tap targets are.
3. Chrome is arity-stable: no member appears or disappears after first paint; conditional members render their slot (disabled / fixed width) from frame one. `flex-1` tabs are the worst case.
4. Never draw a rollup you cannot compute: `2/2 done`, `A check is not passing`, `GHD-XM669` are finished sentences that are wrong; a rollup over partial data renders as its placeholder chip; a gate's kind is unknown until known.
5. A card's placeholder is the card, header included (47 px header: icon square, title bar, rollup bar, then N body rows at the real row height).
6. The rail is part of the layout; a two-column page whose skeleton is one or three columns is a different design.
7. The blocking banner gets a placeholder when the block state is already known from `/api/rollouts` (it usually is); otherwise its insertion is the only thing allowed to move.
8. Content may fill in, never move: late enrichment paints inside fixed geometry; genuinely unknowable height goes in a bottom-anchored or internally scrolling region.
9. No spinner per card; one loading vocabulary per object.
10. One request set, one paint — or an explicit staging order where only reserved slots fill.

## Left unmeasured
Dark at 1440 for most routes; a production build over a real network (dev server module loading swamps CDP throttling); error/empty branches; the mobile tab bar height during load; `/namespaces/<name>` and `?deploy=` / `?release=` deep links that scroll after data.
