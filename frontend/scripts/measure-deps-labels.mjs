#!/usr/bin/env node
/**
 * D-20b — the label-placement measurement script, round 2.
 *
 * Round 1 placed edge labels with a real candidate+greedy algorithm and
 * still measured 9-22 violations at desktop widths — too many labelled
 * trunks for the gutter space, however good the placement. The coordinator's
 * round-2 decision: stop labelling edges at all. A held constraint now reads
 * at its CONSUMER node (`DependencyNode`'s own `heldConstraints` line) and
 * in the Held links rail; an edge carries only colour/weight, never text.
 * That makes "zero label collisions" true by construction — there is no
 * label geometry left to collide — so this script's job changes from
 * "measure how close to zero" to "prove there is nothing left to measure,
 * and that moving the text to the node didn't overflow it instead."
 *
 * Asserts, across a matrix of viewport widths, themes, demo scenarios and
 * (for the incident scenario) every `/api/demo/deps` step:
 *
 *   · ZERO edge labels exist, anywhere — the structural guarantee itself;
 *   · (defence in depth, now trivially true but still checked) any label
 *     that DID exist would sit inside the resting frame, >=4px clear of
 *     every other label/node/other-edge's real path, and chips never
 *     overlap the node name beside them;
 *   · the resting zoom is 1 at every width >=1024 (never below);
 *   · no node's own text overflows its box (`scrollWidth`/`scrollHeight`
 *     vs `clientWidth`/`clientHeight` on every text-bearing descendant) —
 *     the one way moving text onto the node could have broken something
 *     instead of fixing it.
 *
 * Usage: node scripts/measure-deps-labels.mjs <base-url> [out-dir]
 *   (base-url defaults to https://localhost:5235 — this worktree's own
 *   MOCK_API dev server, started separately. This script never starts or
 *   stops a server itself.)
 *
 * Exits non-zero and prints every violation found if any zero-condition is
 * not met. Also writes 2x2 screenshots (390/1440 x light/dark, 390 dark
 * first) plus 1024/1920 to --out (default ./deps-labels-shots).
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'https://localhost:5235';
const OUT = process.argv[3] ?? './deps-labels-shots';
mkdirSync(OUT, { recursive: true });

const WIDTHS = [360, 390, 1024, 1280, 1440, 1920];
const THEMES = ['dark', 'light']; // dark first, per the project's own rule
const SCENARIOS = ['calm', 'incident'];
// `/api/demo/deps?step=` — the stepped "nothing moves before its
// dependencies" story (deps-story.ts). Measured at a representative subset
// of widths (the extremes plus one mid) x both themes to keep the full
// matrix's runtime sane while still covering every step.
const DEPS_STEPS = ['ledger', 'payments', 'staging', 'regions'];
const DEPS_STEP_WIDTHS = [390, 1024, 1920];

async function measurePage(page) {
	return await page.evaluate(() => {
		const PAD = 4;
		const rect = (el) => {
			const r = el.getBoundingClientRect();
			return { l: r.left, r: r.right, t: r.top, b: r.bottom };
		};
		const clear = (a, b, pad) =>
			a.r + pad <= b.l || b.r + pad <= a.l || a.b + pad <= b.t || b.b + pad <= a.t;

		const pane = document.querySelector('.svelte-flow');
		const paneBox = pane ? rect(pane) : null;

		const labels = Array.from(
			document.querySelectorAll('.svelte-flow__edge-label, .svelte-flow__edge-text')
		)
			.map((e) => ({ text: e.textContent.trim(), box: rect(e) }))
			.filter((x) => x.text.length > 0);

		const nodes = Array.from(document.querySelectorAll('.svelte-flow__node')).map((e) => ({
			id: e.getAttribute('data-id'),
			box: rect(e)
		}));

		const violations = [];

		// 0. THE STRUCTURAL GUARANTEE ITSELF: no edge carries text, anywhere.
		for (const l of labels) {
			violations.push({ kind: 'edge-still-has-a-label', text: l.text });
		}

		// 1. (defence in depth) every label inside the resting view
		if (paneBox) {
			for (const l of labels) {
				if (
					l.box.l < paneBox.l - 0.5 ||
					l.box.r > paneBox.r + 0.5 ||
					l.box.t < paneBox.t - 0.5 ||
					l.box.b > paneBox.b + 0.5
				) {
					violations.push({ kind: 'label-outside-frame', text: l.text, box: l.box, frame: paneBox });
				}
			}
		}

		// 2. (defence in depth) label vs label
		for (let i = 0; i < labels.length; i++) {
			for (let j = i + 1; j < labels.length; j++) {
				if (!clear(labels[i].box, labels[j].box, PAD)) {
					violations.push({ kind: 'label-vs-label', a: labels[i].text, b: labels[j].text });
				}
			}
		}

		// 3. (defence in depth) label vs node
		for (const l of labels) {
			for (const n of nodes) {
				if (!clear(l.box, n.box, PAD)) {
					violations.push({ kind: 'label-vs-node', text: l.text, node: n.id });
				}
			}
		}

		// 4. env chip vs node name, ON A NODE ONLY (`.chip` is the Chip
		//    component's own root — NOT `.chip-env-dot`, its 6px identity
		//    dot, deliberately beside the name by design). `.ident` is
		//    DependencyNode's own name span, never the broader `.truncate`
		//    (which also matches a Chip's OWN internal label span and made
		//    every chip "collide" with its own text trivially).
		const chips = Array.from(document.querySelectorAll('.svelte-flow__node .chip')).map((e) =>
			rect(e)
		);
		const names = Array.from(document.querySelectorAll('.svelte-flow__node .ident')).map((e) => ({
			text: e.textContent.trim(),
			box: rect(e)
		}));
		for (const c of chips) {
			for (const n of names) {
				if (n.text.length === 0) continue;
				if (!clear(c, n.box, 0)) {
					violations.push({ kind: 'chip-vs-name', name: n.text });
				}
			}
		}

		// 5. NODE TEXT OVERFLOW — the one way moving the constraint line onto
		//    the node could break something instead of fixing it. A node
		//    sizes itself to its content (Svelte Flow measures the real DOM,
		//    dagre never estimates), so a genuine overflow means a CHILD
		//    forced a fixed/clipped size smaller than its own text.
		for (const n of document.querySelectorAll('.svelte-flow__node')) {
			for (const el of n.querySelectorAll('*')) {
				// `.sr-only` (RestGlyph's own "deploy succeeded" label for
				// the healthy 6px dot, among others) is DELIBERATELY
				// visually clipped to 1px — its scrollWidth exceeding that
				// 1px is the point, not a defect; skip it on class name
				// alone rather than reverse-engineer the clip pattern.
				if (el.classList.contains('sr-only')) continue;
				if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) {
					// `truncate`/`line-clamp` are deliberate ellipsis points
					// (the node name at LR widths, `title`-carrying spans) —
					// only flag an element that ISN'T one of those.
					const cs = getComputedStyle(el);
					if (cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none') continue;
					violations.push({
						kind: 'node-text-overflow',
						node: n.getAttribute('data-id'),
						text: el.textContent.trim().slice(0, 40)
					});
				}
			}
		}

		const viewport = document.querySelector('.svelte-flow__viewport');
		const zoomMatch = viewport?.style.transform?.match(/scale\(([\d.]+)\)/);
		const zoom = zoomMatch ? parseFloat(zoomMatch[1]) : null;

		return { violations, labelCount: labels.length, nodeCount: nodes.length, zoom };
	});
}

async function settle(page) {
	await page.waitForSelector('.svelte-flow__node', { timeout: 15000 }).catch(() => {});
	// The layout effect re-runs several times as dagre and packing converge
	// — settle well past that before measuring, not just past first paint.
	await page.waitForTimeout(2000);
}

async function run() {
	const browser = await chromium.launch({ args: ['--ignore-certificate-errors'] });
	const results = [];
	let firstDark390Shot = null;

	for (const scenario of SCENARIOS) {
		for (const width of WIDTHS) {
			for (const theme of THEMES) {
				const context = await browser.newContext({
					viewport: { width, height: 1000 },
					colorScheme: theme,
					ignoreHTTPSErrors: true
				});
				const page = await context.newPage();
				await page.goto(`${BASE}/api/demo/reset?scenario=${scenario}`);
				await page.goto(`${BASE}/dependencies`);
				await page.evaluate((t) => {
					try {
						localStorage.setItem('theme', t);
					} catch {
						/* private window / blocked storage — fall back to prefers-color-scheme only */
					}
					document.documentElement.classList.toggle('dark', t === 'dark');
				}, theme);
				await page.reload();
				await settle(page);

				const measured = await measurePage(page);
				results.push({ scenario, width, theme, step: null, ...measured });

				const tag = `${scenario}-${width}-${theme}`;
				const shotPath = join(OUT, `${tag}.png`);
				await page.screenshot({ path: shotPath, fullPage: false });
				if (scenario === 'calm' && width === 390 && theme === 'dark') {
					firstDark390Shot = shotPath;
				}

				// Step through the demo's own deps story, incident scenario
				// only (it owns the narrative), at a representative width
				// subset — see DEPS_STEP_WIDTHS's own doc.
				if (scenario === 'incident' && DEPS_STEP_WIDTHS.includes(width)) {
					for (const step of DEPS_STEPS) {
						await page.goto(`${BASE}/api/demo/deps?step=${step}`);
						await page.goto(`${BASE}/dependencies`);
						await settle(page);
						const stepMeasured = await measurePage(page);
						results.push({ scenario, width, theme, step, ...stepMeasured });
					}
				}

				await context.close();
			}
		}
	}

	await browser.close();

	console.log(`\n390 dark shot (look at this first): ${firstDark390Shot}\n`);

	let failed = false;
	for (const r of results) {
		const zeroOk = r.violations.length === 0;
		const zoomOk = r.width < 1024 || r.zoom === null || r.zoom >= 1 - 1e-6;
		const label = `${r.scenario}${r.step ? '/' + r.step : ''}`;
		const line = `${label.padEnd(18)} ${String(r.width).padEnd(5)} ${r.theme.padEnd(6)} labels=${String(r.labelCount).padEnd(3)} zoom=${r.zoom ?? 'n/a'} violations=${r.violations.length}`;
		console.log(line);
		if (!zeroOk) {
			failed = true;
			for (const v of r.violations) console.log('    VIOLATION', JSON.stringify(v));
		}
		if (!zoomOk) {
			failed = true;
			console.log(`    VIOLATION resting zoom ${r.zoom} < 1 at width ${r.width} (>=1024 must rest at 1)`);
		}
	}

	if (failed) {
		console.error('\nFAILED — see violations above.');
		process.exit(1);
	}
	console.log('\nAll zero-conditions hold across the matrix.');
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
