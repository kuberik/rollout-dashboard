#!/usr/bin/env node
/**
 * Type + radius census script for the rollout-dashboard frontend.
 *
 * Loads a fixed set of routes at 1440x900, dark theme, walks the rendered
 * DOM, and records every visible text element's computed font-size,
 * font-weight, font-family, plus its computed border-radius, with a CSS
 * path and the classes on the element.
 *
 * Usage:
 *   node scripts/type-census.mjs <output.json>
 *
 * Must be run with the sandbox disabled (loopback is blocked otherwise),
 * against a running dev server at https://127.0.0.1:5173.
 */
import { chromium } from '/home/luka/.claude/skills/gstack/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://127.0.0.1:5173';
const OUT = process.argv[2] || '/tmp/claude/pass3/type/census-before.json';

/**
 * ⭐ 2026-09-03 · THE DECLARED ROLES, MIRRORED FROM `app.css`'S TYPE-ROLE
 * BLOCK, SO THE CENSUS CAN TELL "USES A ROLE" FROM "HAPPENS TO MATCH ONE".
 *
 * Declared-ness is a CLASS-NAME question, not a computed-style question: an
 * element wearing `.chip`'s hand-spelled `font-size: 10px; font-weight: 600`
 * computes identically to `.t-chip` but is not USING the role — nobody
 * reading `.chip`'s rule can tell it is the same triad as `.t-label`'s
 * mono counterpart without this cross-reference existing somewhere. So an
 * element counts as declared only when one of its own class tokens is
 * literally one of the keys below; everything else is undeclared, however
 * closely its rendered numbers match a role, and is bucketed by its own
 * computed `size/weight/family` so a repeated hand-rolled spelling shows up
 * as a single line item instead of one anonymous element at a time.
 */
const DECLARED_ROLES = {
	't-display': { fontSize: '24px', fontWeight: '300', family: 'Montserrat' },
	't-display-id': { fontSize: '24px', fontWeight: '500', family: 'mono' },
	't-headline': { fontSize: '17px', fontWeight: '600', family: 'Montserrat' },
	't-figure': { fontSize: '16px', fontWeight: '600', family: 'sans' },
	't-body': { fontSize: '14px', fontWeight: '400', family: 'sans' },
	't-dense': { fontSize: '12.5px', fontWeight: '400', family: 'sans' },
	't-micro': { fontSize: '11px', fontWeight: '400', family: 'sans' },
	't-code': { fontSize: '13px', fontWeight: '500', family: 'mono' },
	't-code-sm': { fontSize: '11.5px', fontWeight: '400', family: 'mono' },
	't-button': { fontSize: '12px', fontWeight: '600', family: 'sans' },
	't-label': { fontSize: '10px', fontWeight: '600', family: 'Montserrat' },
	// ⭐ Third re-check, added alongside this pass's app.css declarations.
	't-card-title': { fontSize: '14px', fontWeight: '600', family: 'sans' },
	't-card-rollup': { fontSize: '12px', fontWeight: '500', family: 'sans' },
	't-chip': { fontSize: '10px', fontWeight: '600', family: 'mono' }
};

/** `font-family` computed strings are stacks (`"Menlo, Monaco, ..."`); this
 *  collapses one to the short label the table above and the printed report
 *  both use. */
function familyShort(fontFamily) {
	const f = fontFamily.toLowerCase();
	if (f.includes('montserrat')) return 'Montserrat';
	if (f.includes('mono') || f.includes('menlo') || f.includes('consolas')) return 'mono';
	return 'sans';
}

/** The literal `t-*` class name on the element, if it wears one — this is
 *  what makes it DECLARED, whatever its computed style says. */
function declaredRole(classes) {
	const tokens = (classes || '').split(/\s+/);
	for (const t of tokens) {
		if (Object.prototype.hasOwnProperty.call(DECLARED_ROLES, t)) return t;
	}
	return null;
}

/**
 * Build the declared/undeclared histogram across every route's census.
 * "File path" in this product means the DOM census's own `path` (a CSS
 * selector) plus the ROUTE it was found on — a browser-side census has no
 * way to resolve a Svelte SOURCE file, so route path is the closest
 * per-occurrence location this instrument can name, and it is exactly what
 * the next pass needs to go find the call site.
 */
function summarize(allResults) {
	const declared = {}; // role -> { count, routes: Set }
	const undeclared = {}; // "size/weight/family" -> { count, routes: Set, samples: [{route, path, text}] }

	for (const [routeName, result] of Object.entries(allResults)) {
		if (!result.elements) continue;
		for (const el of result.elements) {
			const role = declaredRole(el.classes);
			if (role) {
				declared[role] ??= { count: 0, routes: new Set() };
				declared[role].count++;
				declared[role].routes.add(routeName);
				continue;
			}
			const family = familyShort(el.fontFamily);
			const key = `${el.fontSize}/${el.fontWeight}/${family}`;
			undeclared[key] ??= { count: 0, routes: new Set(), samples: [] };
			undeclared[key].count++;
			undeclared[key].routes.add(routeName);
			if (undeclared[key].samples.length < 5) {
				undeclared[key].samples.push({ route: routeName, path: el.path, text: el.text });
			}
		}
	}
	return { declared, undeclared };
}

function printSummary({ declared, undeclared }) {
	console.error('\n── DECLARED ROLES ──────────────────────────────────────');
	const declaredRows = Object.entries(declared).sort((a, b) => b[1].count - a[1].count);
	for (const [role, v] of declaredRows) {
		console.error(`  ${role.padEnd(16)} x${v.count} on ${v.routes.size} routes`);
	}
	const totalDeclared = declaredRows.reduce((s, [, v]) => s + v.count, 0);

	console.error('\n── UNDECLARED (size/weight/family) ─────────────────────');
	const undeclaredRows = Object.entries(undeclared).sort((a, b) => b[1].count - a[1].count);
	for (const [key, v] of undeclaredRows) {
		console.error(`  ${key.padEnd(20)} x${v.count} on ${v.routes.size} routes`);
		const topPaths = v.samples.map((s) => `${s.route}: ${s.path}`).slice(0, 3);
		for (const p of topPaths) console.error(`      · ${p}`);
	}
	const totalUndeclared = undeclaredRows.reduce((s, [, v]) => s + v.count, 0);

	console.error(
		`\nTOTAL: ${totalDeclared} declared, ${totalUndeclared} undeclared (${
			declaredRows.length
		} declared roles, ${undeclaredRows.length} undeclared buckets)\n`
	);
}

const ROUTES = [
	{ path: '/', name: 'home' },
	{ path: '/rollouts', name: 'rollouts' },
	{ path: '/apps', name: 'apps' },
	{ path: '/apps/hello-frontend-app', name: 'app-detail' },
	{ path: '/environments', name: 'environments' },
	{ path: '/envs/dev', name: 'env-dev' },
	{ path: '/versions', name: 'versions' },
	{
		path: '/versions/github.com/littlechimera/kuberik-testing/9f10e494d560',
		name: 'version-detail'
	},
	{ path: '/activity', name: 'activity' },
	{ path: '/dependencies', name: 'dependencies' },
	{
		path: '/rollouts/prod/hello-dep-prod/hello-frontend-app',
		name: 'rollout-detail-overview'
	},
	{
		path: '/rollouts/prod/hello-dep-prod/hello-frontend-app/history',
		name: 'rollout-detail-history'
	},
	{
		path: '/rollouts/prod/hello-dep-prod/hello-frontend-app/dependencies',
		name: 'rollout-detail-dependencies'
	},
	{
		path: '/rollouts/prod/hello-dep-prod/hello-frontend-app/logs',
		name: 'rollout-detail-logs',
		waitStrategy: 'load-and-wait'
	}
];

// The in-page census function. Runs inside the browser context.
function censusPage() {
	function isVisible(el) {
		const style = window.getComputedStyle(el);
		if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
			return false;
		}
		const rect = el.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return false;
		return true;
	}

	function isExcluded(el) {
		// sr-only text
		if (el.classList && el.classList.contains('sr-only')) return true;
		let p = el.parentElement;
		while (p) {
			if (p.classList && p.classList.contains('sr-only')) return true;
			if (p.tagName === 'STYLE' || p.tagName === 'SCRIPT') return true;
			// closed <details>
			if (p.tagName === 'DETAILS' && !p.open) return true;
			p = p.parentElement;
		}
		if (el.tagName === 'STYLE' || el.tagName === 'SCRIPT') return true;
		return false;
	}

	function cssPath(el) {
		const parts = [];
		let node = el;
		let depth = 0;
		while (node && node.nodeType === 1 && depth < 8) {
			let selector = node.tagName.toLowerCase();
			if (node.id) {
				selector += `#${node.id}`;
				parts.unshift(selector);
				break;
			}
			const siblings = node.parentElement
				? Array.from(node.parentElement.children).filter((c) => c.tagName === node.tagName)
				: [];
			if (siblings.length > 1) {
				const idx = siblings.indexOf(node) + 1;
				selector += `:nth-of-type(${idx})`;
			}
			parts.unshift(selector);
			node = node.parentElement;
			depth++;
		}
		return parts.join(' > ');
	}

	// Walk all elements; for each, look at its OWN direct text (non-whitespace)
	// via child text nodes, so we report the element that actually paints
	// the text (not every ancestor).
	const results = [];
	const all = document.body.querySelectorAll('*');
	for (const el of all) {
		if (isExcluded(el)) continue;
		// Does this element have direct text-node children with content?
		let hasDirectText = false;
		for (const child of el.childNodes) {
			if (child.nodeType === 3 && child.textContent.trim().length > 0) {
				hasDirectText = true;
				break;
			}
		}
		if (!hasDirectText) continue;
		if (!isVisible(el)) continue;

		const style = window.getComputedStyle(el);
		const text = el.textContent.trim().slice(0, 60);
		results.push({
			path: cssPath(el),
			tag: el.tagName.toLowerCase(),
			classes: el.className && typeof el.className === 'string' ? el.className : '',
			text,
			fontSize: style.fontSize,
			fontWeight: style.fontWeight,
			fontFamily: style.fontFamily,
			borderRadius: style.borderRadius,
			borderTopLeftRadius: style.borderTopLeftRadius
		});
	}
	return results;
}

async function run() {
	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({
		viewport: { width: 1440, height: 900 },
		ignoreHTTPSErrors: true
	});
	const page = await context.newPage();

	const allResults = {};

	// First load home page and switch to dark theme, then reload as instructed.
	await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
	const themeBtn = await page.$('button[aria-label^="Switch to"]');
	if (themeBtn) {
		const label = await themeBtn.getAttribute('aria-label');
		if (label && label.includes('dark theme')) {
			// Currently light; clicking switches to dark.
			await themeBtn.click();
		}
	}
	// Verify dark mode is set (persisted via localStorage/class), then reload.
	await page.reload({ waitUntil: 'networkidle' });
	const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
	if (!isDark) {
		console.error('WARNING: dark theme did not persist after reload');
	}

	for (const route of ROUTES) {
		const url = `${BASE}${route.path}`;
		try {
			if (route.waitStrategy === 'load-and-wait') {
				await page.goto(url, { waitUntil: 'load', timeout: 30000 });
				await page.waitForTimeout(3000);
			} else {
				await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
			}
		} catch (err) {
			console.error(`Failed to load ${url}: ${err.message}`);
			allResults[route.name] = { error: err.message, path: route.path };
			continue;
		}

		// re-assert dark mode per navigation (SPA nav shouldn't lose it, but be safe)
		const darkNow = await page.evaluate(() =>
			document.documentElement.classList.contains('dark')
		);
		if (!darkNow) {
			await page.evaluate(() => document.documentElement.classList.add('dark'));
		}

		await page.waitForTimeout(300);

		const census = await page.evaluate(censusPage);
		allResults[route.name] = { path: route.path, elements: census };
		console.error(`${route.name}: ${census.length} elements`);
	}

	await browser.close();

	fs.mkdirSync(path.dirname(OUT), { recursive: true });
	fs.writeFileSync(OUT, JSON.stringify(allResults, null, 2));
	console.error(`Wrote ${OUT}`);

	const summary = summarize(allResults);
	printSummary(summary);
	const summaryOut = OUT.replace(/\.json$/, '-summary.json');
	fs.writeFileSync(
		summaryOut,
		JSON.stringify(
			{
				declared: Object.fromEntries(
					Object.entries(summary.declared).map(([k, v]) => [
						k,
						{ count: v.count, routes: [...v.routes] }
					])
				),
				undeclared: Object.fromEntries(
					Object.entries(summary.undeclared).map(([k, v]) => [
						k,
						{ count: v.count, routes: [...v.routes], samples: v.samples }
					])
				)
			},
			null,
			2
		)
	);
	console.error(`Wrote ${summaryOut}`);
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
