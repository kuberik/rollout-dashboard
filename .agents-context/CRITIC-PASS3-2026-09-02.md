# Design pass 3 — two critiques and their disposition, 2026-09-02

Branch `polish/design-pass-2` at `b59d040`. Two read-only critics ran in parallel after the
day's eight commits: a dark/390 craft review (`ic-design-reviewer`) and a UI-only operator walk
(`ic-ux-critic`, real rollback + pin-clear through the UI, cluster restored). Both measured;
everything below that I list as "confirmed" I re-measured myself before dispatch.

Methodological note from the craft critic, worth keeping: the navbar theme toggle starts a
150ms `transition-colors`; `getComputedStyle` inside that window returns interpolated
`oklab(...)` values. Toggle, then RELOAD, then measure.

## Confirmed by my own measurement (390 dark / 1440 dark)

| finding | measurement |
|---|---|
| `/dependencies` at 390 shows 3 of 12 nodes | pane 34→341; `hello-api-app` ×3 at −145→30 (off left), world/multi ×6 at 401→861 (off right) |
| Card header truncates its title | `All apps` sw 63 / cw 56 → `All a…`; `/activity` 194/184; `/versions` 226/218 |
| App-page `Recent activity` text-on-text at 390 | `2.66.0-66` vs `02:03 AM` overlap 42×12px; two more rows 23px and 3px |
| `/` at 1440×900 half empty and truncating | left column 77→468, rail 77→924, page does not scroll, `+4 more` link present |
| three "see more" grammars on `/` | `View all rollouts`, `+4 more in the full rollouts list`, `view all ›` |

## Craft review — ranked

INCOHERENT
1. `/dependencies` 390 resting pan excludes the provider the banner names; zoom controls overlap DEV node by 5px. → **p3-graph**
2. `Card` title is the first thing to shrink; three pages truncate at 390. → **p3-card**
3. `ActivityRail` two-anchor row, both sides `shrink-0`. → **p3-activity**
4. Type scale: 9 declared roles, 35 combinations across 14 sizes; headline band has five spellings 16–20px; AlertPanel headline 16/700 off-role; 9px numerals. → **p3-card** (AlertPanel), **p3-activity** (9px), wave-2 census agent.

UNPOLISHED
5. Logs `Follow` toggle blue-600, chroma 1.30× the alarm fill; History toggles went gray-900 today. → **p3-logs**
6. `How it's going` is three different cards (320/320/340 wide; 12/12/12.5 dt; 16/16/17 dd; 3/3/2 rows; sparkline moved into header on app page). → wave 2
7. `Furthest behind` fix landed on `/apps` not `/envs/<name>`. → **p3-envs**
8. `/dependencies` `cluster <name>` inks reversed: 2.60:1 light, 3.03:1 dark, the only sub-4.5 text in the audit. → **p3-graph**
9. `/apps` marks the norm (green `All up to date`), deviation row chroma 0. → **p3-envs**
10. Logs tab: 17px head where siblings use 24px; zero cards; empty state centred in a 620px void; 390 tab strip unlabeled; `Pods` twice; `Cols`. → **p3-logs**
11. App-page station rows: 525px gap, 63% of card. → **p3-app**
12. `/` primary column 391px tall under an 818px rail while hiding 4 rollouts. → **p3-home**
13. Three "see more" grammars, two to the same URL. → **p3-home**
14. `/activity` pill rows 1px apart in type; selected pill 2px shorter; rollup restates the window. → **p3-activity**
15. `What changed` ×8 — interrogative trigger. → **p3-activity**

NITPICK: `9999px` ×4 on app page (→ p3-app); `3px` edge labels (→ p3-graph); `6px` button on rollout detail (→ p3-truth); `dev` + `DEV` chip in envs head (→ p3-envs); prose legend on the graph card (→ p3-graph); activity chart monochrome vs green list (→ p3-activity).

Praise: entry hop on `/apps/<name>`; `/envs/dev` at 390; `/rollouts` at 390 byte-clean; banner family consistent across four pages; container geometry holds on every route.

## Operator walk — ranked

BLOCKING
1. `/versions/<rev>` calls the one held build "fully rolled out" (`6 of 6`, `NEWEST … of 2`) — rel-66 and rel-67 share revision `9f10e49`, rel-67 held everywhere. → **p3-truth**
2. "This clears when the deploy in front of it lands" on four surfaces for a CONTRACT gate that never will (`blocking-story.ts:926`, rollout Overview `:685`, `/dependencies:199`). The Dependencies tab says the truth: "someone has to ship hello-api-app first". → **p3-truth** (function), **p3-graph** (`/dependencies` copy), pages adopt in wave 2
3. `Open hello-api-app` lands on an Overview that says "Up to date — no upgrades available" while holding three rollouts. → **p3-truth**
4. 390 dependency graph: `Zoom in` and `Fit` do nothing; `Zoom out` goes 0.85→0.25 in one press; no controls at 1440; 28px targets overlapping a node. → **p3-graph**

PAINFUL
5. `/apps`, `/environments` say "in DEV" for a block hitting all three; row says `DEV can still take 1 newer version`. → **p3-envs**
6. Four `How it's going` rails, four definitions (`Deploys · 7d` 49 vs 34; `24h` window swapped in silently; fleet vs per-app medians). → wave 2
7. `Typical to prod —` bare dash on app page, `— no full trip yet` on `/apps`. → **p3-app**
8. Rank chip `−N` is amber. **Not actioned**: the human chose orange for `behind` on 2026-09-01 ("shouldn't be blue… orange/yellow/amber", "white/black fill is an eye-sore"); amber = `stuck` only is the older rule the docs still carry. Wave 2 updates `DESIGN-INTENT.md`/`HANDOFF.md`.
9. `/rollouts` has no held signal. → **p3-home**
10. No elapsed time on Deploying; `checking · 0m of 0m`. → **p3-home**
11. `next: staging` on a pinned rollback; no pin on the in-motion card. → **p3-home**
12. Rollback invisible on `/activity` and the app rail. → **p3-activity**
13. Raw 60-char OCI tag on the pin banner and the graph node. → **p3-truth**, **p3-graph**
14. Rollout Dependencies tab: `3 of 4 blocked` over a graph that omits dev. → **p3-graph**
15. Force-deploy modal never names the contract. → **p3-modals**
16. `/envs/prod` "waiting on 2 gates" names nothing; `4/4 healthy` regressed from `running`. → **p3-envs**
17. Blocked app page has zero actions; provider hop is a 14px glyph. → **p3-app**
18. = craft 3. 19. `/apps` 390 `UP TO DATE / 0 of 3 up to date`. → **p3-envs**
20. Logs Tests view speaks about pods. → **p3-logs**
21. Clear-pin modal drops the environment. → **p3-modals**
22. "pauses in 43m" + "paused right now" in one screenshot, not reproduced. → **p3-modals** (predicate check)

COSMETIC: subtitle `release rel-67` while running rel-66 (→ p3-truth); `·064b655` missing space (→ p3-home); picker `35 days ago` vs `4d`, no rank in picker (→ p3-modals); holding-card gradient vs HANDOFF rule (→ p3-home); 390 home dead space (→ p3-home); rollback button skipping a newer sha silently (→ p3-truth).

Praise: rollout Dependencies tab both directions; six surfaces agreed live through a rollback; rollback modal; History `Rolled back` badge; force-deploy ceremony; empty states; `/rollouts` group headers and filters.

## Left by both critics
Real-device touch on the graph; command palette Enter (browse-daemon contention, not filed); the unblock event (nothing can publish `hello-api 1.67.0` — `build-and-push.sh` commit-count bug from 2026-08-31 still stands); failed/stuck states; Logs Tests view with real output; 1440 light on most routes (my combination).

## Re-check at `7da2170` (fresh `ic-design-reviewer`, 1440 light + 390 dark)

13 of 19 claimed fixes measured exactly as described; 5 partial (6 sub-claims refuted: the
held app page has no attributable pods so no `n/n running`; the log pane's top row clips at
1440 (`padding-top: 0`); `/` left column still 368px short of the rail; `Rolled back` pill
19px vs 20px neighbours; `3 of 6` was a misread of the brief); 1 unreachable (pin banner,
nothing pinned).

Ranked residue and wave-3 disposition:

1. INCOHERENT — the held-rollout disc is drawn four ways (20/24/32/36px; green-100 vs
   gray-100; pause vs rollback vs check; a red `HELD` chip on `/rollouts` only; all 15
   discs green on `/` and `/rollouts`). → **p4-disc**
2. INCOHERENT — one gray-900 fill means "selected window", "selected filter" and
   "rolled back" on `/activity`. → **p4-activity** (status loses the fill; selection keeps it)
3. `/rollouts` fixed 460px columns: 77% / 38% width used. → **p4-disc**
4. `/environments` 42% empty, three near-identical cards; version page 39% empty with 86px
   rag. → **p4-disc** (environments), **p4-versions**
5. Two-column pages never balance (Δ 368–583px). → **p4-activity** (rail cap)
6. `/activity` rows half empty at 1440 (median 49% gap). → **p4-activity**
7. Banner keeps a 50px amber `shadow-2xl`. → **p4-chrome**
8. Log pane clips its top row at 1440; three facts printed three times. → **p4-chrome**
9. 390: banner is 28% of the phone; card header 47→65/85px when the rollup wraps. → **p4-chrome**
10. Header 45 vs 47 on the reference page; headerless boxes there; `Source` has no rollup. → **p4-chrome**
11. 390 `/rollouts` zero-count filter chips; `updated` orphan; `/activity` separator wrap. → **p4-disc**, **p4-activity**
12. Version page: eight-line hero on the ground, 41,000px² bar restating `3 of 6` four times. → **p4-versions**

Verdict quoted: "a designer would put their name on `/`, rollout detail, `/dependencies` and
`/activity` at 1440. They would not yet sign `/environments`, `/versions/<sha>`, or any page
at 390."

## Second re-check at `660de38` (390 light + 1440 dark), 2026-09-03 00:10

6 of 10 wave-3 claims hold exactly; the AlertPanel, chip vocabulary (h20/r4/bw1/10-600 on nine
routes) and the four reference headers at 47px are confirmed. Ranked residue → wave 4:

1. INCOHERENT — `/namespaces/<name>` still draws a 36px green disc for a rollout every other
   page draws 28px orange; its rollup says `all 2 deployed cleanly`. → **p5-lists**
2. INCOHERENT — the `HELD` chip is red on the rollout Overview and Dependencies tab; held is
   orange everywhere else. → **p5-chrome** (Overview), **p5-graph** (tab)
3. INCOHERENT — the graph ships to 390 at scale 0.52: 39 labels at 5–7 effective px, 52% of
   the drawing off the right edge, 152px void above (page) / below (tab). The type census
   cannot see it (font-size is pre-transform). → **p5-graph**
4. INCOHERENT — `/rollouts` auto-fit inflates a one-rollout namespace to a 1201px card with
   15.8% ink; RolloutGrid's own note predicted it. → **p5-lists** (track cap 460)
5. `/activity` rows: version pair flushed 600–800px from its sentence. → **p5-activity**
6. `Recent activity` header 61px (link box 35.6px in a 47px band) on four pages. → **p5-activity** (Card)
7. Names truncate first: `hello-fronte…` on `/environments`, `hell…` ×2 on Resources at 390,
   3px ellipsis on `/`. → **p5-lists**
8. `/rollouts` orphans `updated` at 1440 only. → **p5-lists**
9. Log pane bisects a row (14 of 29px); rollup three times. → **p5-chrome**
10. `1 rule` breaks onto two lines at 390. → **p5-chrome**
11. `Recent Events` empty rollup slot. → **p5-chrome**
12. `/environments` 390 legend describes the desktop order. → **p5-lists**
13. Revision cards height-matched and 32% unfilled. → **p5-chrome**
14. `/apps` 390 prints 12 tracked labels over self-naming cells. → **p5-lists**
15–20. Descriptor at 24px beside a 24px name; filter groups 2px apart; 6 vs 9 bar segments;
   one 6px radius; six one-page warm inks; `Two things are holding PROD`. → lanes above; the
   colour fold (19) deferred.

LEFT by the critic: hover/focus/active states; command palette at 390; open RulePopover at 390;
every modal at both widths; long-name fixtures; widths between 390 and 1440; motion.

## Wave 4 landed at `dbd317e` (2026-09-03 01:20)
All 20 second-re-check findings actioned except the colour fold (19) and the 6-vs-9 bar
segments (17, documented as deliberate in CoverageBar). Notable: the graph at 390 is a
single-file vertical layout inside the SAME GraphCanvas component (the list renderer an agent
first built was reverted — one component is a recorded human decision), with contract hops
routed in a right gutter by ContractHopEdge; /rollouts tracks are minmax(360, 460) left-packed
(the ≥95% width census had rewarded a 1201px card); held is orange on every surface including
/namespaces and the Overview/Dependencies chips; every blocking headline names the provider
and requirement when the gate is a contract, single or multi-gate.

## Mid-width craft review (640/768/1024/1280 + interaction states) at `dbd317e`, 2026-09-03 01:40
One habit on five pages: a fixed side column held rigid while the `1fr` identifier column
starves — the 175px sidebar arriving at `sm` takes 28% of content and no grid responds
(/apps banner 443px tall at 640 with an 11-line body beside a 196px link; /rollouts 30
truncations at 640; /versions/<sha> four card titles to `Thi…`; rollout detail rail at `lg`
gives main 417px; /envs/prod worse at 1280 than 1200 with an empty 152px column). Six
focus-ring colours (outline inherits currentColor), none on .tap-link/.rev-sha/summary; 145
sub-32px controls on /activity at 390; graph at 7.1px type between 1024 and 1280; Flowbite
orange checkboxes in the Logs menus; the Change Version modal 2.3% ink. → **wave 5**:
p6-breakpoints (container queries, rail flips, Card title wraps), p6-focus (one --focus-ring,
32px touch, logs menus), p6-graph (scale floor 0.85, palette rows), p6-modal (one-column
picker, Health Checks body, popover clamp). Praise: zero hover-only controls, zero document
overflow at any width, the command palette.

## Operator walk at `dbd317e` (phone first), 2026-09-03 01:50
BLOCKING: (1) `Connect GitHub` in the Change Version modal navigates the page to a raw 503
JSON body, destroying a half-filled rollback; (2) the revision page says `Not here yet — PROD`
for a revision that IS running in prod under rel-66 (counts by newest tag, not by revision);
(3) the prod force-deploy dialog asserts `No commit changes detected` for the release whose
`requires.api` moved, while the dev dialog admits GitHub is unreachable; (4) a pinned rollout
shows the identical pinned panel twice (blue + amber) above a third rollback panel — the whole
first phone screen. PAINFUL: `/` files held rollouts under `Trailing — healthy, but behind`;
`Nobody has to approve anything —` leads the contract verdict; Logs at 390 shows zero message
text with Wrap off by default; AlertPanel CTA overprints `› 1 rule` at 390; `/apps` row says
`DEV has 1 newer version held` under `all 3 environments`; head rollups reassure over the
alert; app page reads at rest mid-deploy; `next: staging` for a build staging has; /activity
un-labels rollbacks as versionHistoryLimit evicts entries; Dependencies counts services (1)
over a graph of rollouts (3); /environments dev card omits the rule and env names are not
links; `HELD by a gate` beside a pin notice; Clear Pin copy weaker from the app page; medians
flip mid-deploy; `0 deploys in all time` under a FAILED filter; filters absent from the URL;
cold load is a blank white page in dark mode; no `role=dialog`, unnamed toggles. → p6-truth
(5, 6, 12, 18), p6-pages (9, 10, 11, 15, 17); queued as follow-ups to running lanes: 1, 3, 22,
23 → p6-modal; 2 → versions (after p6-breakpoints); 4, 16 → Overview (after p6-breakpoints);
7, 13, 19, 22 → p6-focus; 8 → verify after p6-breakpoints; 14 → p6-graph; 20, 21 → later.
Praise: task 1 is one tap on a phone to the sentence naming hello-api-app and ^1.67.0; task 2
zero clicks; the force-deploy dialog; Clear Pin copy; live updates in ~3s; the graph at 390.
Cluster residue: two history entries on hello-world-dev/hello-world-app (rollback drill +
restore), which evicted the two oldest under versionHistoryLimit 5.

## Wave 5 landed at `ef4b051` (2026-09-03 02:55) — 50 commits since `b59d040`
Every mid-width finding and every operator-walk finding actioned except filter state
persistence beyond URL params. Layouts flip on container queries (banner action, Card title
wrap, /rollouts groups, revision grid, Overview and /envs rails, pipeline step detail);
32px touch targets via pointer:coarse hit-slop; one --focus-ring-color token; Logs menus
neutral; the version picker is one column until a pick; Health Checks and Recent Events have
bodies; popovers render in flow at 390; the graph floors at 0.85 and anchors the blocked
pair; palette rows lead with the namespace; the provider's Dependencies tab counts rollouts;
/ has a Held group; the contract verdict says a person must ship; medians ignore in-flight
deploys; /apps leads with the exception and its row names all three environments; the app
page says 'deploying · 37s'; station discs match the lists; /environments dev card and links;
Clear Pin names the gate from every entry; the first frame of a cold load is the persisted
theme; the version dialog never leaves the page and never asserts what GitHub cannot say;
every modal is role=dialog; a pinned rollout shows one panel and HELD names pin and gate; the
revision page counts places by revision ('6 of 6 · 3 on 2.66.0-66; 2.67.0-67 held'); filters
live in the URL; History states its retention window; logs on a phone show the message.

Open: the Logs pod-filter checkbox does not narrow the rendered rows (virtualizer count
sync; pre-existing) → next; the app page's station discs are 32px against the 28px token;
cluster residue: hello-world-app dev is on 0afab6f unpinned until Business Hours Only
reopens at 13:00, then automation returns it to 064b655.

## Third craft re-check at `ef4b051` (1440 light / 390 dark / 768 light), 2026-09-03 03:20
Eight of ten wave-5 claims verified (Held group, verdict once, revision recount, Logs at 390,
dialog attributes, URL filters, retention note, dark first frame). Refuted: the pointer:coarse
hit-slop never engaged in a 390 window without touch emulation (195/195 under 32px on
/activity; /rollouts 0/32 because its rows are whole-row tap zones); the graph's 0.85 floor
clips the prod column at 1024 (blocked pair's right end 47px outside). Ranked residue →
**wave 6**: (1) /rollouts pins 460px tracks — cards and the group rule must share a right
edge; (2) "held" spelled five ways on six pages — one HELD atom on every list row; (3) banner
glyph varies by page, not gate kind (calendar on /envs/prod lies); (4) /environments two body
templates; (5) `Held 4` on / vs `Trailing 4` on /rollouts — one taxonomy; (6) per-page tap
model — slop below sm regardless of pointer, whole-row zones everywhere; (7) 17 undeclared
type roles, the card title/rollup among them → t-card-title/t-card-rollup/t-chip; (8) graph
fit beats floor; (9) /namespaces has no banner, no tiles; (10) dialog left pane 65% empty,
two switch sizes; (11) Recent activity rollup on one page of five; (12) header slot holds
buttons/bars on three cards; (13–23) rag, mid-token identifiers, /versions row alignment,
cold-load shell still gated on the API, History chart for one dot, two GitHub icons, pill
heights, hero bar contradicting `held in 3 places`, three GitHub-absence copies, disc 28/32/40,
`»` as icon and bullet. Lanes: p7-lists, p7-chrome, p7-touch, p7-graph-type, p7-shell,
p7-podfilter. Verdict quoted: signs the Overview, app page, /envs/prod and the revision page;
not the seams between pages.

## Wave 6 landed at `2311817` (2026-09-03 04:10) — 57 commits since `b59d040`
/rollouts cards end where their group header ends (solo ≤460, multi fill); one HELD atom on
every list row; / and /rollouts share one taxonomy (Needs you · In motion · Held · Trailing ·
Steady); /environments one body template; banner glyph keyed to gate kind; every rail states
'N deploys'; card header slots hold no buttons or bars; touch slop max(100%+12px, 32px) below
sm regardless of pointer, timeline dots with 32px hit circles, identifiers wrap only at '-';
History chart fits its data; graph subset-fit engages below the floor and falls back to the
column layout below 0.75; t-card-title / t-card-rollup / t-chip declared and adopted;
/namespaces gets How it's going and a counted rail; the version picker's pane fits its list;
the Logs pod filter narrows rows (virtualizer count race). Cold-load shell finding did not
reproduce (a Vite full reload from concurrent edits). Left for the finish lane: `»` as bullet
in GateRecord, EventsCard identifiers, one-off type roles in environments/+page and
GateRecord, /versions row alignment, the hero bar under 'held in 3 places'.

## Fourth craft re-check + third operator walk at `2311817`/`fe44de4`, 2026-09-03 05:00
Craft: /rollouts, the Overview, /activity, /dependencies signed; icons 26–143 per page, one 8px
card radius, 47px headers on 17 of 19 routes. Its lead ask — `.btn` rows on /apps and
/environments ("offer the action") — is NOT actioned: the human rejected navigation dressed as
action on 2026-09-01 ("investigate button / choose version that act as if they're doing
something smart but are just navigating"). Actioned → wave 7: /activity env filter has no
selected fill (p8-touch); pin banner blue vs held amber — rule: blocked-by-rule amber, a state
a person chose blue (p8-panel); HELD chip missing on /apps and /envs rows (p8-touch); blurred
amber blob back in AlertPanel (p8-panel); rail header 65px at 320 → the count is the link
(p8-panel); rollup hard-right at every width (p8-panel); /namespaces How it's going rollup
(p8-touch); dialog empty commits region 279px + sliced last row (p8-panel); true-reach touch
targets: Details trigger, pills' right slop, a.chip-value clipping (p8-touch); / In motion
group rule, adverse row truncating at 1024, revision card 52% fill, zero-count pills differ
by width (p8-groups); spacing scale is really 2/4/6/8/10/12/16/24 (doc).
Walk: BLOCKING B1 graph node says `A check is not passing` for a schedule gate (p8-truth2);
B2 every `Open hello-api-app` lands on a page that says nothing waits on it (p8-truth2 app
page, p8-panel Overview); B3 prod rollback: no typed confirm, blue button, disabled pin toggle
reads off, truncated header, no distance (p8-panel); B4 /versions hero 6/6 over a 3/6-looking
bar (p8-truth2). PAINFUL P5 390 banner disclosure under the CTA (p8-panel); P6 held cards
never say why (p8-groups); P7 activity empty state points at a removed control (p8-touch);
P8 palette unfocused at 390, Escape focus (p8-nav); P9 four spellings each for held / the rule
/ the unpin action (p8-nav + lanes); P10 /apps and /environments card copy names only the pin
(p8-touch, p8-truth2); P11 `Recorded note` prints controller defaults as human notes
(p8-truth2); P12 focus resets to BODY on navigation (p8-nav); P13 /envs/prod drops a rollout
silently (p8-touch); P14 four GitHub-absence copies (lanes); P15 tap targets (p8-touch).
Cosmetic: 'until 8h 33m', prod schedule banner while up to date (p8-truth2); cluster param
bakes a URL, not-found repo copy (p8-groups); two denominators on the in-motion card; Today 5
vs at least 4; duplicated sr-only status. Praise: force-deploy dialog, API-down self-heal at
+28s, slow-load honesty, live deploy reporting on six surfaces, combined cause strings,
Clear Pin copy, History retention honesty. Cluster residue: two more history entries on
hello-world-dev/hello-world-app; deploy-message annotation cleared.

## Wave 7 landed at `9e21437` (2026-09-03 05:30) — 65 commits since `b59d040`
Amber = blocked by a rule, blue = a state a person chose (recorded); the blob is gone; 390
banner disclosure gets the full width with the action under it; production changes are typed
in both directions with a red confirm, a distance and the pin as a sentence; the provider's
Overview and app page both say who waits on it; the graph node names the schedule gate; the
/activity env filter fills gray-900 when selected; HELD on /apps and /envs rows; /namespaces
rollup; true-reach touch targets incl. Details triggers and joined-chip links; held cards
state their cause; solo groups on / shrink-wrap; adverse rows never truncate 640–1440; zero-
count pills visible and muted at every width; cluster filter uses a display name; revision
cards match heights only within 25%; repo-not-found copy; palette focused on open at 390 with
a navbar Search button; navigation focuses main; 'Clear pin' everywhere (pin-copy.ts);
History separates a blank note from the system description; the schedule sentence is a
sentence; /versions hero bar paints held places orange with a caption; rail headers 47px on
every page. Not actioned: `.btn` action rows on /apps and /environments (human decision).

## Fifth craft re-check at `9e21437`, 2026-09-03 06:00 → wave 8
Eleven of twelve wave-7 claims hold. BLOCKING REGRESSION: the Change Version confirm pane
is capped at 148px (last pass's F6 max-height), so at ≥768 the gates, typed field, Cancel and
the red confirm are clipped and unclickable (`sh 514 / ch 148`, elementFromPoint at the
button returns the grid) → p9-dialog first. Then: one schedule gate is amber on dev and blue
on prod/staging — hue was keyed on the queue, not the kind; a non-blocking schedule notice
becomes a meta row, not a second banner (p9-banner); two stacked banners on the dev frontend
Overview with empty right slots → one panel with the rule-count chip (p9-banner); Available
Version Upgrades collapses when up to date (p9-banner); /versions hero bar's orange half has
no legend and the rollup says 6 of 6 running while the title says 3 held (p9-lists);
/namespaces rows are 57% hole with 16 icons (p9-lists); names truncate on the stuck/held rows
of /environments, /versions, /namespaces and the graph node's sentence clips (p9-lists); the
activity rail is 1.9× the subject on three pages (p9-lists); /envs/prod rows carry a 168px
hole (p9-lists); half the text wears no role because t-chip sits on the wrapper, plus 111
default-16px leaves (p9-type); / has no display figure (p9-type); seven controls under 32px
true reach (p9-touch); Ctrl+K-opened palette drops focus on Escape (p9-dialog).

## Fourth operator walk (new-engineer persona) at `9e21437`, 2026-09-03 06:05 → wave 8 follow-ups
Cold read of /: 3 of 5 beliefs true; false: "will not move on their own" for a window that
reopens at 13:00; `Deploys · 7d 50` and `Failed 0` are floors from a 5-entry history; `Typical
to prod 6m` is n=1. BLOCKING: B1 /apps says `DEV is stuck — nothing is holding it on purpose`
with a schedule gate shut (HELD and STUCK chips on one card; "31m" is time since last deploy)
→ p9-truth3; B2 /rollouts shows an operator's pin as HELD and never says "pin" → p9-truth3;
B3 Deploy/Roll back give no feedback for 5–8s with the button still armed → p9-dialog +
p9-banner; B4 /versions hero `6 of 6` beside a 3/6-looking bar with no orange legend →
p9-lists (count by revision stays the decision; the card must not disagree with itself);
B5 Held header contradicts the tooltip's "This clears on its own" → p9-type. PAINFUL: P1 every
deploy count is a floor (History hedges, Home does not) → p9-lists; P2 reopen time unlabelled
(`9/3/2026, 1:00:00 PM` vs `9 AM - 5 PM EST`) → p9-banner; P3 vocabulary census 14/9/7/9
spellings for held / the rule / newest / deploying → wave 9 lane; P4 eleven misreadable
sentences (CLEARS label over a state sentence; `1 version ahead` at the station's indent;
three-day-old rollback as a standing alert; `HELD 2.67.0-67` under hello-api-app's name; `4
healthy · 2 rolled back · 80% of last 5`; `of 33`) → lanes; P5 /activity never shows the
recorded note, pin/clear-pin absent from History, note optional on rollback → p9-touch,
p9-truth3, p9-dialog; P6 Roll back styled like Deploy; list rows no affordance → p9-dialog;
P7 the key sentence lives in an 18px hover tooltip → p9-banner; P8 app page has no actions →
wave 9 (real Deploy per station is an action, not navigation); P9 hello-world-manifests
dropped silently from /apps and /environments → p9-lists; P10 ten disagreeing number pairs →
lanes; P11 Overview swallows the commits 401 → p9-banner; P12 PROD identity amber beside
held amber → not actioned (identity hues are in the closed budget); P13 palette has no verbs
→ not actioned. Praise: the in-flight Home card, rollback and Clear Pin copy, the Dependencies
tab, History's honesty, live updates everywhere. Residue: hello-world-dev/hello-world-app
back on 064b655 (cleaner than found), three history entries prefixed `pass9 walk:`.

## Wave 8 landed at `ca611aa` (2026-09-03 07:25) — 78 commits since `b59d040`
Five lanes were cut off by a rate limit mid-edit; their on-disk work was measured, committed
per lane, and resumed to finish. Landed: the dialog's confirm pane is never clipped (footer
outside the scroller, test-locked), pending state and no double-submit, required and
correctly-verbed note on rollbacks and production changes, red rollback confirm, row
affordances, one dialog element per step; hue follows gate kind with a non-blocking schedule
as a meta row; one panel per rollout with the right slot filled; dated rollback notice;
labelled reopen time with the schedule's zone; '1 newer · held by the pin'; 'Deploy
requested — starting'; a schedule hold is held not stuck; PINNED on /rollouts with Clear pin;
/ opens with a display figure; Held header no longer says 'will not move on their own';
census credits inherited roles (t-chip, t-code-sm); names never yield on five pages; omitted
rollouts disclosed; '≥ N' counts; env card rollups one grammar; /namespaces rows with chain,
ticks and gate text; rails within 10% of the subject; GateRecord and BlockReason get NOW /
CLEARS rows; /activity shows the recorded note; timeline hit boxes per side; History counts
each deploy once with the pin state in the head; Resources believes Flux; the tab bar yields
to dialogs. Human feedback this morning: GitHub connect on a phone (label at 390, same-tab
navigation, honest 'Not configured' chip), NO two-tone split on the revision bars (reverted
to one fill — second time this rule was set), and the dialog step-two ghost (not reproducible
after the clip fix; one dialog element at 40–800ms after a pick). Cluster residue: an agent
force-deployed rel-67 to dev hello-frontend-app during a dialog test; rolled back to
2.66.0-66 through the UI and unpinned — dev is held by the contract again.

## Vocabulary pass at `07295b2` → landed 2026-09-03 08:10 — 81 commits since `b59d040`
One word per concept, recorded in lib/CLAUDE.md and locked by vocabulary.test.ts: held /
rule (+kind: contract, deploy window, approval, health check; never gate) / newest and N
behind / deploy and promote (ship kept for a provider publishing). /versions → /revisions with
a 308. Measured zero hits for gate, blocked, paused, can't-go-further on nine routes.
Remaining open: real Deploy actions per station on the app page; the unblock event (nothing
can publish hello-api 1.67.0); a failure-state walk once a failing deploy can be staged.

## Peer sweep round, iteration 2 → landed at `73cba59` on main (2026-09-03 18:05)
kuberik-46 ran design + UX sweeps (all routes, four combos + 1024/1280) and handed me the
correctness items; four lanes plus a scanner fix: pinned is its own state on every list with
the PINNED chip and cause ('pinned to <sha> by <who>'), / and /rollouts agree (Held 4),
/environments and /envs count 'N pinned' and keep rollup ink neutral beside held/pinned, Clear
pin names the build it lets through, the environments order clause matches its CTA; the home
rollup reads '11 of 15 newest · 4 held' in neutral ink; rail rows are one sentence at every
width (gap ≤ 7.5% from 640 to 1680); the revision page states one fact per line ('6 of 6
places run this revision · 3 hold a newer build', service rows name held AND running, rules
grouped per environment, every time with its verb), the Overview subtitle appends '· running
<sha>', History keeps ?range=/?kind=, a one-deploy timeline is a row; Logs head states the
data's freshness with a hollow dot when stale, Follow converges to the newest line, 'N errors'
filters. The message scanner went blind after an apostrophe inside a markup comment — fixed,
15 LogsViewer strings censused for the first time. Lessons: verify 1024–1600 too (a /rollouts
search-box squeeze lived only at 1210–1530); one lane pinned a rollout by POSTing the API
directly when the dialog's same-version gate blocked the UI path — the gate was my d2145eb's
regression, kuberik-46 is fixing it. Cluster: hello-multi-app dev carries a pin nobody owns
('c98bfab by admin@example.com') — flagged to the human.

## Scroll model (human request, 2026-09-03 evening)
"Make it standard how other apps do it; the bottom navigation bar should stay put." The
h-screen shell with an inner-scrolling <main> is retired: the document scrolls, navbar sticky,
tab bar fixed with safe-area padding, sidebar sticky under the navbar, dialogs lock the page,
Back restores the offset, only the Logs pane / picker / palette keep bounded inner scrollers.
Measured in a phone-emulated browser at 390 and at 1440.
