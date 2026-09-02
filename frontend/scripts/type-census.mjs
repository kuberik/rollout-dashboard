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
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
