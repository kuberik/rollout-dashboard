// truth.mjs: the truth gate. Every list page prints facts about a rollout (state, steps, age, failure cause, place, the wait clock); the page those rows link to prints the same facts.
// This script loads each list page's data-truth-* attributes and rendered rows and compares them with the linked tab, the sibling pages and the app's own models.
//
// usage (from frontend/):  node scripts/truth.mjs [base] [pages] [states]      or      npm run truth -- [base] [pages] [states]
//   base    URL of a running dashboard (default https://127.0.0.1:5173). Start one with the incident fixture: MOCK_API=1 MOCK_SCENARIO=home-incident npm run dev
//   pages   comma list of rollouts,changes,environments,apps,inbox (default: all five)
//   states  comma list of incident,calm,quiet (default: incident,calm,quiet). Each state runs in its own browser context, so the sticky
//           ?calm / ?quiet scenario cookie of one state never leaks into the next.
// env: FROZEN=1   compare ages against the fixture's capturedAt instead of the clock. Only for a capture that really is frozen; the mock dates every response
//                 relative to the request, so the default is the live clock.
//      NO_FLEET=1, NO_ENVD=1, NO_CHGD=1, NO_MULTI=1, NO_WAITCLOCK=1, NO_V2=1   skip a check group; FLEET_ONLY=1 isolates the fleet checks; V2_ONLY=1 runs only the v2 group (pins, behind, words)
// exit code: 1 on any mismatch, with one line per mismatch.
// contract: see the header of src/lib/components/new/data.ts.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
if (process.env.V2_ONLY) Object.assign(process.env, { FLEET_ONLY: '1', NO_FLEET: '1', NO_ENVD: '1', NO_CHGD: '1', NO_MULTI: '1', NO_WAITCLOCK: '1' });
const base = process.argv[2] || 'https://127.0.0.1:5173';
const pages = (process.argv[3] || 'rollouts,changes,environments,apps,inbox').split(',');
const states = (process.argv[4] || 'incident,calm,quiet').split(',');
/* FROZEN=1: ages count from the fixture's capturedAt. Default: the live clock. The mock dates every response relative to the moment it is asked, so a list's ISO instants and a tab's "N m ago" agree only as of the list's own load (listLoadedAt). */
const FIXTURE_NOW = process.env.FROZEN
	? Date.parse(
			JSON.parse(
				readFileSync(
					fileURLToPath(
						new URL('../src/lib/view-models/home/fixtures/incident-input.json', import.meta.url)
					),
					'utf8'
				)
			).capturedAt
		)
	: null;
let listLoadedAt = Date.now();
const nowFor = () => FIXTURE_NOW ?? listLoadedAt;
const browser = await chromium.launch();
/* one browser context per scenario: ?calm / ?quiet write a sticky cookie, so a state never shares a context (or a scraped tab) with another */
let ctx,
	curState = 'incident';
async function useState(state) {
	if (ctx) await ctx.close();
	curState = state;
	ctx = await browser.newContext({
		ignoreHTTPSErrors: true,
		viewport: { width: 1440, height: 900 }
	});
}
await useState('incident');
/* preflight (always, whatever the states: a calm-only run on a server without the fixture must fail loudly too): the incident fixture must be loaded. A server without it has no approval waits, so every fleet check would pass on "approval counts = 0". */
{
	const pp = await ctx.newPage();
	let n = 0;
	try {
		await pp.goto(`${base}/rollouts`, { waitUntil: 'load', timeout: 60000 });
		await pp
			.waitForFunction(
				() => (document.querySelector('main')?.innerText || '').trim().length > 40,
				null,
				{ timeout: 60000 }
			)
			.catch(() => {});
		n = await pp.evaluate(async () => {
			const D = await import('/src/lib/components/new/data.ts');
			return D.rollouts('incident').rows.filter((r) => r.group === 'approval').length;
		});
	} catch (e) {
		console.log(
			`truth: cannot read ${base}/rollouts (${String(e.message).split('\n')[0].slice(0, 100)}). Start a dashboard with: MOCK_API=1 MOCK_SCENARIO=home-incident npm run dev`
		);
		process.exit(1);
	}
	if (!n) {
		console.log(
			`truth: the home-incident fixture is not loaded at ${base} (no approval waits in the incident state). Start the dashboard with: MOCK_API=1 MOCK_SCENARIO=home-incident npm run dev`
		);
		process.exit(1);
	}
	await pp.close();
}
const problems = [];
const bad = (where, msg) => problems.push(`${where}: ${msg}`);

/* ── tab scraper (cached per path) ── */
const tabCache = new Map(); /* keyed by scenario + path */
async function tab(path, tries = 2) {
	const ck = `${curState}|${path}`;
	if (tabCache.has(ck)) return tabCache.get(ck);
	const p = await ctx.newPage();
	let out = { error: 'load' };
	const loadedAt = Date.now();
	try {
		await p.goto(base + path, { waitUntil: 'load' });
		await p
			.waitForFunction(
				() =>
					document.querySelector('.dpc-desktop nav li') ||
					/not found|404/i.test(document.body.innerText),
				null,
				{ timeout: 15000 }
			)
			.catch(() => {});
		await p.waitForTimeout(500);
		out = await p.evaluate(() => {
			const main = document.querySelector('main');
			const text = main?.innerText ?? '';
			const head = main?.querySelector('h1')?.parentElement?.parentElement?.innerText ?? '';
			const lines = head
				.split('\n')
				.map((s) => s.trim())
				.filter(Boolean);
			const pill =
				lines.find((l) =>
					/^(DEPLOYED|DEPLOYING|FAILED|CHECKING|HELD|PAUSED|ROLLED BACK|[A-Z ]{4,})$/.test(l)
				) ?? '';
			const i0 = lines.indexOf('/');
			const build = i0 >= 0 ? (lines[i0 + 1] ?? '') : '';
			const age = (lines.find((l) => /^\d+\s?(s|m|h|d|w|mo|y)\s+ago$/.test(l)) ?? '').trim();
			const steps = [...document.querySelectorAll('.dpc-desktop nav li button')].map((b) => {
				const s = b.querySelector('span.truncate');
				const chip = b.querySelector('.chip')?.textContent.trim() ?? '';
				const danger = s.className.includes('danger');
				const state = danger
					? 'fail'
					: !chip
						? 'done'
						: /progress|running|checking|deploying/i.test(chip)
							? 'active'
							: 'todo';
				return `${s.textContent.trim()}:${state}`;
			});
			/* the tab header does not print the namespace line: read it from the URL's own path segment, fall back to a line */
			const ns =
				(/^\/rollouts\/[^/]+\/([^/]+)\//.exec(location.pathname) ?? [])[1] ??
				lines.find((l) =>
					/^[a-z0-9-]+-(dev|test|staging|prod|production)(-[a-z0-9-]+)?$/.test(l)
				) ??
				'';
			return { text, pill, build, age, steps, ns, lines };
		});
	} catch (e) {
		out = { error: String(e.message).slice(0, 80) };
	}
	await p.close();
	out.loadedAt = loadedAt;
	if (tries > 1 && (out.error || !out.steps || !out.steps.length))
		return tab(path, tries - 1); /* a tab that renders nothing is a load hiccup: look once more */
	tabCache.set(ck, out);
	return out;
}
const ageSecs = (s) => {
	const m = /^(\d+)\s?(s|m|h|d|w|mo|y)/.exec(s);
	if (!m) return null;
	return +m[1] * { s: 1, m: 60, h: 3600, d: 86400, w: 604800, mo: 2592000, y: 31536000 }[m[2]];
};
const unitSecs = (s) => {
	const m = /^(\d+)\s?(s|m|h|d|w|mo|y)/.exec(s);
	return m ? { s: 1, m: 60, h: 3600, d: 86400, w: 604800, mo: 2592000, y: 31536000 }[m[2]] : 0;
};
const PILL = {
	failed: ['FAILED'],
	deploying: ['DEPLOYING'],
	checking: ['DEPLOYING', 'CHECKING', 'DEPLOYED'],
	healthy: ['DEPLOYED'],
	'awaiting-approval': ['DEPLOYED', 'CHECKING', 'DEPLOYING'],
	'held-by-rule': ['DEPLOYED']
};

function compare(where, a, t, pageName) {
	if (t.error) return bad(where, `tab did not load (${t.error})`);
	const st = a.state;
	if (st) {
		if (st in PILL && !PILL[st].includes(t.pill))
			bad(where, `state ${st} but tab pill is "${t.pill}"`);
		if (st === 'awaiting-approval' && !/waiting on an approval|approval/i.test(t.text))
			bad(where, 'state awaiting-approval but tab shows no approval wait');
		if (st === 'held-by-rule' && !/held|gate|rule|waiting/i.test(t.text))
			bad(where, 'state held-by-rule but tab shows no hold');
		if (st === 'failed' && !/Deployment failed/i.test(t.text))
			bad(where, 'state failed but tab has no "Deployment failed"');
		if (st !== 'failed' && /Deployment failed/i.test(t.text))
			bad(where, `state ${st} but tab says "Deployment failed"`);
	}
	if (a.steps) {
		const ds = a.steps.split('|').map((x) => x.split(':'));
		const tabNames = t.steps.map((x) => x.split(':')[0]),
			tabState = t.steps.map((x) => x.split(':')[1]);
		if (ds.map((x) => x[0]).join('|') !== tabNames.join('|'))
			bad(
				where,
				`step names data "${ds.map((x) => x[0]).join('|')}" vs tab "${tabNames.join('|')}"`
			);
		else if (ds.map((x) => x[1]).join('|') !== tabState.join('|'))
			bad(where, `steps data "${a.steps}" vs tab "${t.steps.join('|')}"`);
	}
	if (a.build && t.build && a.build !== t.build)
		bad(where, `build ${a.build} vs tab title ${t.build}`);
	if (a.age && pageName !== 'changes' && pageName !== 'inbox' && t.age) {
		const d = (nowFor(t) - Date.parse(a.age)) / 1000,
			tab = ageSecs(t.age);
		if (
			Number.isFinite(d) &&
			tab != null &&
			Math.abs(d - tab) > Math.max(unitSecs(t.age) * 1.5, 120)
		)
			bad(where, `age data ${Math.round(d)}s vs tab "${t.age}"`);
	}
	if (a.since && st === 'failed' && pageName !== 'changes' && pageName !== 'inbox') {
		const m = /·\s*(\d+\s?(?:s|m|h|d|w|mo|y))\s+ago/.exec(t.text.split('Deployment pipeline')[0]);
		const d = (nowFor(t) - Date.parse(a.since)) / 1000;
		if (m && Math.abs(d - ageSecs(m[1])) > Math.max(unitSecs(m[1]) * 1.5, 120))
			bad(where, `failing-since data ${Math.round(d)}s vs tab "${m[1]} ago"`);
	}
	if (a.cause && st === 'failed') {
		const norm = (s) => s.replace(/\s+/g, ' ');
		/* #75: the tab leads with the figure ("8.9%" / "error rate") and then "<check>: over a 1% budget". The row's one-line cause "<check>: error rate 8.9% over a 1% budget"
		   is checked in two parts: the figure with its label, and the check's name with the threshold tail. A "for 3m" breach duration is not printed by the tab (it prints the check's own age). */
		const tabText = norm(t.text).replace(/\bover an? (\d[\d.]*%) budget/g, 'over $1');
		const m = /^(.*?): (.*?)(\d+(?:\.\d+)?%)\s*(.*)$/.exec(norm(a.cause));
		if (!m) {
			if (!norm(t.text).includes(norm(a.cause)))
				bad(where, `failing cause "${a.cause}" not on the tab`);
		} else {
			const [, check, label, figure, rest] = m;
			const tail = rest
				.replace(/\bover an? (\d[\d.]*%) budget/g, 'over $1')
				.replace(/\s+for \d+\s?(s|m|h|d)\b/, '')
				.trim();
			if (!tabText.includes(`${figure} ${label.trim()}`.trim()))
				bad(where, `failing figure "${figure} ${label.trim()}" not on the tab`);
			if (!tabText.includes(`${check}: ${tail}`))
				bad(where, `failing check tail "${check}: ${tail}" not on the tab`);
		}
	}
	if (a.place) {
		const ns = t.ns,
			p = a.place;
		let ok = true;
		if (p === 'production') ok = /-(prod|production)$/.test(ns);
		else if (/^\d+ prod regions$/.test(p)) ok = /prod/.test(ns);
		else if (['dev', 'test', 'staging'].includes(p)) ok = new RegExp(`-${p}(-|$)`).test(ns);
		else ok = ns.endsWith(`-${p}`) || ns.includes(`-${p}`);
		if (!ok) bad(where, `place "${p}" vs tab namespace "${ns}"`);
	}
}

/* ── rendered-text checks of /rollouts against the tabs and the sibling pages ── */
const subCache = new Map();
const tabText = async (path) =>
	/\/(gates|history)$/.test(path)
		? (subCache.get(`${curState}|${path}`) ??
			(subCache.set(`${curState}|${path}`, await textOf(path)),
			subCache.get(`${curState}|${path}`)))
		: ((await tab(path)).text ?? '');
async function textOf(path, tries = 3) {
	try {
		return await textOf1(path);
	} catch {
		if (tries > 1) return textOf(path, tries - 1);
		return '';
	}
}
async function textOf1(path) {
	const q = await ctx.newPage();
	await q.goto(base + path, { waitUntil: 'load' });
	await q
		.waitForFunction(
			() => (document.querySelector('main')?.innerText || '').trim().length > 80,
			null,
			{ timeout: 30000 }
		)
		.catch(() => {});
	await q.waitForTimeout(1800);
	const t = await q.evaluate(() => document.querySelector('main')?.innerText ?? '');
	await q.close();
	return t;
}
async function rolloutsText(p, where0, url) {
	/* the page is banner -> Attention (compact cards) -> "All rollouts" list card (groups In flight / Waiting / Held / At rest, strand rows). Intent unchanged: every fact a row prints
	   agrees with the rollout tab it links to, and every count on the page agrees with the rows it stands for. */
	await p.waitForSelector('main', { timeout: 20000 }).catch(() => {});
	const data = await p.evaluate(() => {
		const main = (document.querySelector('main') ?? document.body).innerText;
		const chipOf = (l) => {
			const c = l.querySelector('.lr-id .chip');
			const e = c?.matches('[data-env]') ? c : c?.querySelector('[data-env]');
			return (e?.getAttribute('data-env') ?? c?.textContent ?? '').trim();
		};
		const row = (l) => ({
			key: l.dataset.key ?? '',
			app: l.dataset.truthApp,
			href: l.dataset.truthHref,
			state: l.dataset.truthState,
			place: l.dataset.truthPlace,
			group: l.dataset.truthGroup,
			text: l.innerText.replace(/\s+/g, ' ').trim(),
			wb: l.dataset.truthWaitBuild ?? '',
			age: l.querySelector('.lr-age')?.textContent.trim() ?? '',
			chip: chipOf(l),
			word: l.querySelector('[data-state-word]')?.textContent.trim() ?? '',
			sentence: l.querySelector('.lr-sn')?.textContent.replace(/\s+/g, ' ').trim() ?? '',
			strand: l.querySelectorAll('[data-strand] [data-node]').length
		});
		const li = [...document.querySelectorAll('li[data-truth-kind=rollout]')].map(row);
		const rest = [...document.querySelectorAll('li[data-truth-kind=rest]')].map((l) => ({
			app: l.dataset.truthApp,
			href: l.dataset.truthHref,
			text: l.innerText.replace(/\s+/g, ' ').trim()
		}));
		const att = [...document.querySelectorAll('[data-truth-kind=attention]')].map((e) => ({
			app: e.dataset.truthApp,
			href: e.dataset.truthHref,
			group: e.dataset.truthGroup,
			state: e.dataset.truthState,
			approve: !!e.querySelector('[data-action=approve], button.btn-primary, a.btn-primary'),
			word: e.querySelector('[data-word]')?.textContent.trim() ?? ''
		}));
		const banner = document.querySelector('[data-truth-kind=banner]');
		const groups = [...document.querySelectorAll('#all-rollouts [data-group]')].map((g) => ({
			name: g.dataset.group,
			n: +(g.querySelector('.lc-gn')?.textContent ?? NaN),
			rows: g.querySelectorAll('ul.lc-rows > li').length,
			apps: +(/(\d+) apps/.exec(g.querySelector('.lc-gr')?.textContent ?? '')?.[1] ?? NaN),
			order: [...g.querySelectorAll('li')].map((l) => l.dataset.key ?? l.dataset.truthHref)
		}));
		const rollup = (sel) =>
			(document.querySelector(`${sel} [data-rollup]`)?.textContent ?? '')
				.replace(/\s+/g, ' ')
				.trim();
		return {
			main,
			li,
			rest,
			att,
			banner: banner
				? {
						app: banner.dataset.truthApp,
						href: banner.dataset.truthHref,
						group: banner.dataset.truthGroup,
						rollback: !!banner.querySelector('[data-action=rollback]')
					}
				: null,
			groups,
			attRollup: rollup('#attention'),
			allRollup: rollup('#all-rollouts'),
			titles: [...document.querySelectorAll('main h2')].map((h) => h.textContent.trim())
		};
	});
	/* units: no bare fractions, no bare counts */
	for (const m of data.main.matchAll(/\b\d+\/\d+\b(?! steps)/g))
		bad(where0, `bare fraction "${m[0]}" on the page`);
	for (const m of data.main.matchAll(
		/(?<!\b[Ss]tep )\b\d+ of \d+\b(?!\s+(places?|steps|waiting regions|regions|prod regions))/g
	))
		bad(where0, `fraction without unit "${m[0]}"`);
	const needs = await textOf('/' + (url.includes('?') ? url.slice(url.indexOf('?')) : ''));
	for (const r of data.li) {
		const tag = `${where0} ${r.app} ${r.place} (${r.state})`;
		const href = r.href?.split('?')[0];
		const t = href && (await tabText(href));
		/* waiting build + its age: a gated row's age is the build the tab lists as waiting, since it waits */
		if ((r.state === 'awaiting-approval' || r.state === 'held-by-rule') && t && r.wb) {
			const g = await tabText(href + '/gates');
			if (r.state === 'held-by-rule') {
				const after = g.slice(Math.max(0, g.indexOf('Held builds')));
				if (!after.slice(0, 220).includes(r.wb))
					bad(
						tag,
						`waiting build ${r.wb} is not the build the Gates tab holds here ("${after.slice(0, 60).replace(/\n/g, ' ')}")`
					);
			} else if (!g.includes(r.wb) && !t.includes(r.wb))
				bad(tag, `waiting build ${r.wb} is on neither the Overview nor the Gates tab`);
			/* the row's age column is the HOLD clock (one clock per wait, checked in waitClockChecks / fleetChecks), never the waiting build's age: that age is printed, labelled, on the tab's Newer builds list and is not compared with the row */
		}
		/* every row names its state in the product's words, and a strand */
		if (!r.word) bad(tag, 'row has no state word');
		if (
			r.state === 'awaiting-approval' &&
			r.word &&
			!/^(Needs your approval|Waiting for approval)$/.test(r.word)
		)
			bad(tag, `approval row word is "${r.word}"`);
		if (
			r.state === 'awaiting-approval' &&
			!/^(check still running)?$/.test(r.sentence.slice(r.word.length).trim())
		)
			bad(
				tag,
				`approval row sentence "${r.sentence}" says more than its state word (the wait is said once, in the age column) or "check still running"`
			);
		if (r.state === 'awaiting-approval' && /\bfor \d+\s?(s|m|h|d|w|mo)\b/.test(r.sentence))
			bad(
				tag,
				`approval row sentence "${r.sentence}" repeats the wait clock the age column already prints`
			);
		if ((r.state === 'awaiting-approval' || r.state === 'held-by-rule') && !r.age)
			bad(tag, 'a waiting row prints no .lr-age (the hold clock)');
		if (r.state === 'held-by-rule' && !/^(Waits on |Held by )/.test(r.word))
			bad(tag, `held row word is "${r.word}"`);
		if (!r.strand && t) bad(tag, 'row draws no strand');
		/* the tab's pill says CHECKING => the row says Checking */
		if (
			t &&
			/^CHECKING$/m.test(
				t
					.split('\n')
					.map((x) => x.trim())
					.find((x) => /^(DEPLOYED|DEPLOYING|FAILED|CHECKING|HELD)$/.test(x)) ?? ''
			) &&
			!/Checking/.test(r.text) &&
			r.state !== 'failed' &&
			r.state !== 'awaiting-approval'
		)
			bad(tag, 'the tab pill is CHECKING but the row never says Checking');
	}
	await extra(where0, data, needs);
}

/* ── further checks (each names itself in its message) ── */
const secs = (t) => {
	const m = /(\d+)\s?(s|m|h|d|w|mo|y)\b/.exec(t ?? '');
	return m
		? +m[1] * { s: 1, m: 60, h: 3600, d: 86400, w: 604800, mo: 2592000, y: 31536000 }[m[2]]
		: null;
};
async function extra(where0, data, needs) {
	for (const r of data.li) {
		const tag = `${where0} ${r.app} ${r.place} (${r.state})`;
		const href = r.href?.split('?')[0];
		const t = href ? await tabText(href) : '';
		/* (a) place chip = the tab's environment name per region (check:place-per-region) */
		const ns = (/^\/rollouts\/[^/]+\/([^/]+)\//.exec(href ?? '') ?? [])[1] ?? '';
		const chip = r.chip;
		if (chip && ns) {
			if (/^prod-/.test(chip)) {
				if (!ns.endsWith(chip))
					bad(tag, `place-per-region: chip "${chip}" vs tab namespace "${ns}"`);
			} else if (chip === 'prod') {
				const pl = r.place ?? '';
				if (
					!/-prod(-|$)/.test(ns) ||
					(pl && !/^(production|\d+ prod regions)$/.test(pl) && !ns.endsWith('-' + pl))
				)
					bad(tag, `place-per-region: tier chip "prod" + place "${pl}" vs tab namespace "${ns}"`);
			} else if (chip === 'production') {
				if (!/-(prod|production)$/.test(ns))
					bad(tag, `place-per-region: chip "production" vs tab namespace "${ns}"`);
			} else if (/^\d+ prod regions$/.test(chip)) {
				if (!/-prod/.test(ns))
					bad(tag, `place-per-region: chip "${chip}" vs tab namespace "${ns}"`);
			} else if (['dev', 'test', 'staging'].includes(chip)) {
				if (!new RegExp(`-${chip}(-|$)`).test(ns) && !(chip === 'dev' && ns === 'default'))
					bad(tag, `place-per-region: chip "${chip}" vs tab namespace "${ns}"`);
			} else bad(tag, `place-per-region: chip "${chip}" is not a tab environment name`);
		}
		if (/Release commit for build/.test(t))
			bad(
				tag,
				'one-title-per-sha: a tab prints "Release commit for build …" (boilerplate) for a build with a known change'
			);
	}
	/* (i) counts: every count on the page agrees with the rows it stands for (check:counts) */
	const by = (g) => data.li.filter((r) => r.group === g);
	const G = Object.fromEntries(data.groups.map((g) => [g.name, g]));
	const EXPECT = ['In flight', 'Waiting', 'Held', 'At rest'];
	for (const g of data.groups)
		if (!EXPECT.includes(g.name))
			bad(where0, `group word "${g.name}" is not one of ${EXPECT.join(' / ')}`);
	for (const g of data.groups)
		if (g.n !== g.rows) bad(where0, `counts: group ${g.name} says ${g.n}, lists ${g.rows} rows`);
	if (by('moving').length !== (G['In flight']?.rows ?? 0))
		bad(
			where0,
			`counts: ${by('moving').length} moving rows vs In flight ${G['In flight']?.rows ?? 0}`
		);
	if (by('approval').length !== (G['Waiting']?.rows ?? 0))
		bad(
			where0,
			`counts: ${by('approval').length} approval rows vs Waiting ${G['Waiting']?.rows ?? 0}`
		);
	if (by('held').length !== (G['Held']?.rows ?? 0))
		bad(where0, `counts: ${by('held').length} held rows vs Held ${G['Held']?.rows ?? 0}`);
	if (data.rest.length !== (G['At rest']?.rows ?? 0))
		bad(where0, `counts: ${data.rest.length} rest rows vs At rest ${G['At rest']?.rows ?? 0}`);
	if (G['At rest'] && G['At rest'].apps !== new Set(data.rest.map((r) => r.app)).size)
		bad(
			where0,
			`counts: At rest says ${G['At rest'].apps} apps, its rows are ${new Set(data.rest.map((r) => r.app)).size}`
		);
	const num = (re, s) => +(re.exec(s)?.[1] ?? 0);
	const ar = data.allRollup;
	for (const [word, n] of [
		['moving', G['In flight']?.rows ?? 0],
		['waiting', G['Waiting']?.rows ?? 0],
		['held', G['Held']?.rows ?? 0],
		['at rest', G['At rest']?.rows ?? 0]
	]) {
		const m = num(new RegExp(`(\\d+) ${word}`), ar);
		if (m !== n) bad(where0, `counts: All rollouts rollup says ${m} ${word}, the list has ${n}`);
	}
	/* Attention + banner: "N failing" = the banner's rollout + the failing cards; "N to approve" = the approval cards; each rollout once on the page */
	const failedCards = data.att.filter((a) => a.group === 'failed').length,
		yoursCards = data.att.filter((a) => a.group === 'approval').length;
	const failing = failedCards + (data.banner ? 1 : 0);
	if (num(/(\d+) failing/, data.attRollup) !== (data.attRollup ? failing : 0) && (data.att.length || data.banner))
		bad(
			where0,
			`counts: Attention says "${data.attRollup}", banner + cards are ${failing} failing / ${yoursCards} to approve`
		);
	if (num(/(\d+) to approve/, data.attRollup) !== yoursCards)
		bad(where0, `counts: Attention says "${data.attRollup}", ${yoursCards} approval cards`);
	if (data.banner && data.banner.group !== 'failed')
		bad(where0, 'the banner is not a failing rollout');
	const hrefs = [
		...(data.banner ? [data.banner.href] : []),
		...data.att.map((a) => a.href),
		...data.li.map((r) => r.href)
	];
	if (new Set(hrefs).size !== hrefs.length)
		bad(where0, 'counts: a rollout is on the page twice (banner / Attention / list)');
	if (data.att.some((a) => a.group === 'approval' && !a.approve))
		bad(where0, 'an approval card has no Approve');
	if (yoursCards && !(needs.match(/Approve\b|Review approval/g) ?? []).length)
		bad(where0, `counts: ${yoursCards} to approve but Home offers no Approve`);
	if (data.banner && !data.banner.rollback)
		console.log(`${where0}: banner offers no Roll back (the viewer cannot undo it)`);
}

/* mix: there is no Holding card and no Held view; the old ?state=held link lands on the Held section (#held) of the All rollouts list. Each held row names its cause (fact line) and the cause is on its Gates tab; the section's count = its rows. */
async function heldView() {
	const where0 = 'rollouts[held-view]';
	const p = await ctx.newPage();
	await p.goto(`${base}/rollouts?state=held`, { waitUntil: 'load' });
	await p.waitForSelector('#held li[data-truth-kind=rollout]', { timeout: 30000 }).catch(() => {});
	await p
		.waitForURL(/#held$/, { timeout: 10000 })
		.catch(() => {}); /* the old link redirects: read the page only after it has landed */
	await p.waitForTimeout(1200);
	const d = await p.evaluate(() => ({
		rows: [...document.querySelectorAll('#held li[data-truth-kind=rollout]')].map((l) => ({
			href: l.dataset.truthHref,
			group: l.dataset.truthGroup,
			fact: l.querySelector('[data-state-word]')?.textContent.replace(/\s+/g, ' ').trim() ?? ''
		})),
		all: [...document.querySelectorAll('li[data-truth-kind=rollout]')].filter(
			(l) => l.dataset.truthGroup === 'held'
		).length,
		head: document.querySelector('#held .lc-gn')?.textContent.trim() ?? '',
		url: location.search + location.hash,
		top: Math.round(document.getElementById('held')?.getBoundingClientRect().top ?? NaN)
	}));
	await p.close();
	if (!d.rows.length) return bad(where0, 'the old Held link lands on no held rows');
	console.log(`${where0}: ${d.rows.length} held rows`);
	if (!/#held$/.test(d.url) || /state=/.test(d.url))
		bad(
			where0,
			`the old ?state=held link should land on #held with ?state dropped, got "${d.url}"`
		);
	if (!(d.top >= 0 && d.top < 200))
		bad(where0, `the Held section is not in view after the redirect (top ${d.top}px)`);
	if (d.all !== d.rows.length)
		bad(where0, `${d.all} held rollouts listed vs ${d.rows.length} in the Held section`);
	const n = +(/(\d+)$/.exec(d.head)?.[1] ?? NaN);
	if (n !== d.rows.length)
		bad(where0, `counts: Held section says "${d.head}" vs ${d.rows.length} rows`);
	for (const r of d.rows) {
		const tag = `${where0} ${r.href}`;
		const who = /^Waits on (.+?)( in \S+)?$/.exec(r.fact)?.[1];
		const g = await tabText(r.href.split('?')[0] + '/gates');
		if (!g) {
			bad(tag, `${r.href}/gates did not load`);
			continue;
		}
		if (who && !g.toLowerCase().includes(who.toLowerCase()))
			bad(tag, `${r.href}/gates does not name "${who}"`);
		if (!/held/i.test(g)) bad(tag, `${r.href}/gates shows no held build`);
	}
}
if (!process.env.FLEET_ONLY && pages.includes('rollouts') && states.includes('incident'))
	await heldView();

/* ── /environments truth contract. Each PLACE is counted once: every tier tile's data-truth-* counts against envsModel (the same un-flipped model the page draws), the tile's
   buckets add up to its places, the state line SAYS the failing count, the tiles' failing total equals fleetCounts, and Production's region cells carry the model's regions. Returns the number of tiles. ── */
async function environmentsCards(p, where0, state) {
	const r = await p
		.evaluate(async (st) => {
			const D = await import('/src/lib/components/new/data.ts');
			const M = await import('/src/lib/components/new/envs-model.ts');
			const model = M.envsModel(st);
			const exp = Object.fromEntries(
				model.tiers.map((t) => [
					t.key,
					{ places: t.places, failing: t.failing, waiting: t.waiting, moving: t.moving }
				])
			);
			const num = (v) => (v == null || v === '' ? NaN : +v);
			const tiles = [...document.querySelectorAll('[data-truth-kind="env-tile"]')].map((l) => {
				const d = l.dataset;
				return {
					tier: d.truthTier,
					places: num(d.truthPlaces),
					failing: num(d.truthFailing),
					waiting: num(d.truthWaiting),
					moving: num(d.truthMoving),
					lead: (l.querySelector('[data-truth="state-lead"]')?.textContent ?? '')
						.replace(/\s+/g, ' ')
						.trim(),
					regions: l.querySelectorAll('[data-truth-kind="region"]').length
				};
			});
			const adverse = (model.base && model.base.mark !== 'newest' ? 1 : 0) + model.busy.length;
			return {
				exp,
				tiles,
				adverse,
				fc: D.fleetCounts(st).places,
				failingTotal: model.tiers.reduce((n, t) => n + t.failing, 0)
			};
		}, state)
		.catch((e) => ({ error: String(e.message).slice(0, 140) }));
	if (r.error) {
		bad(where0, `env-tiles probe failed (${r.error})`);
		return 0;
	}
	if (!r.tiles.length) {
		bad(where0, 'no env tiles');
		return 0;
	}
	for (const c of r.tiles) {
		const tag = `${where0} tile ${c.tier}`,
			e = r.exp[c.tier];
		if (!e) {
			bad(tag, 'tile is not a model tier');
			continue;
		}
		if (c.failing + c.waiting + c.moving > c.places)
			bad(
				tag,
				`buckets add up to ${c.failing + c.waiting + c.moving}, tile says ${c.places} places`
			);
		for (const k of ['places', 'failing', 'waiting', 'moving'])
			if (c[k] !== e[k]) bad(tag, `${k} tile ${c[k]} vs envsModel ${e[k]}`);
		if (c.failing && !new RegExp(`^${c.failing} failing`).test(c.lead))
			bad(tag, `state line "${c.lead}" does not lead with ${c.failing} failing`);
		if (!c.failing && c.waiting && !new RegExp(`^${c.waiting} waiting`).test(c.lead))
			bad(tag, `state line "${c.lead}" does not lead with ${c.waiting} waiting`);
		if (c.tier === 'prod' && c.regions !== r.adverse)
			bad(tag, `${c.regions} region cells vs ${r.adverse} adverse regions in the model`);
	}
	const tf = r.tiles.reduce((n, t) => n + t.failing, 0);
	if (tf !== r.fc.failing && r.failingTotal !== r.fc.failing)
		bad(where0, `tiles' failing ${tf} vs fleetCounts ${r.fc.failing}`);
	console.log(`${where0}: ${r.tiles.length} env tiles checked`);
	return r.tiles.length;
}

for (const state of process.env.FLEET_ONLY ? [] : states) {
	await useState(state);
	for (const pg of pages) {
		const PATH = {
			rollouts: '/rollouts',
			changes: '/changes',
			environments: '/environments',
			apps: '/apps',
			inbox: '/'
		};
		/* the scenario is a cookie that outlives the page: an incident pass must say so after a calm one */
		const url = `${base}${PATH[pg] ?? '/' + pg}${state === 'calm' ? '?calm=1' : state === 'quiet' ? '?quiet=1' : '?scenario=incident'}`;
		const where0 = `${pg}[${state}]`;
		const p = await ctx.newPage();
		await p.goto(url, { waitUntil: 'load' });
		listLoadedAt = Date.now();
		await p
			.waitForFunction(
				() => (document.querySelector('main')?.innerText || '').trim().length > 40,
				null,
				{ timeout: 60000 }
			)
			.catch(() => {});
		await p
			.waitForSelector('[data-truth-state]', {
				timeout: state === 'incident' ? 60000 : 20000
			}) /* incident pages always have rows; a slow live fleet answer is not an empty page */
			.catch(() => {}); /* lists fill in after the mock API answers */
		await p.waitForTimeout(1500);
		if (pg === 'rollouts') {
			/* open At rest and every "Show all N" header fold so the folded rows are checked too */
			await p
				.locator('[data-rest-fold]')
				.first()
				.click({ timeout: 1500 })
				.catch(() => {});
			for (const b of await p.locator('[data-show-all][aria-expanded=false]').all())
				await b.click({ timeout: 1500 }).catch(() => {});
			await p.waitForTimeout(400);
		}
		const items = await p.evaluate(() =>
			[...document.querySelectorAll('[data-truth-state]')].map((el) => {
				const a =
					el.closest('a') ??
					el.querySelector('a[href^="/rollouts/"]') ??
					(el.tagName === 'A' ? el : null);
				const href = el.dataset.truthHref || a?.getAttribute('href') || '';
				const d = el.dataset;
				return {
					href,
					kind: el.dataset.truthKind || '',
					label: (el.innerText || '').trim().split('\n')[0].slice(0, 40),
					a: {
						state: d.truthState,
						steps: d.truthSteps,
						age: d.truthAge,
						since: d.truthSince,
						cause: d.truthCause,
						build: d.truthBuild,
						place: d.truthPlace
					}
				};
			})
		);
		if (pg === 'rollouts') await rolloutsText(p, where0, url);
		const nCards = pg === 'environments' ? await environmentsCards(p, where0, state) : 0;
		await p.close();
		const rows = items
			.filter((i) => /^\/rollouts\/[^/]+\/[^/]+\/[^/]+/.test(i.href))
			.filter(
				(i) => !(pg === 'rollouts' && state !== 'incident' && i.kind === 'rest')
			); /* ?calm masks a place's CURRENT state, not its tab: a masked-healthy At rest row links a tab that still says failed */
		if (!rows.length && nCards) {
			console.log(`${where0}: ${nCards} env cards, no exception links (skipped row compare)`);
			continue;
		}
		if (!rows.length && pg === 'changes' && state !== 'incident')
			continue; /* a calm Changes page has no banner or Attention card, so no rollout link to check */
		if (!rows.length && pg === 'inbox' && state !== 'incident') {
			console.log(`${where0}: ${state} Home asks nothing (no attention cards, by design)`);
			continue;
		}
		if (!rows.length) {
			bad(
				where0,
				`no rows found (${items.length} elements with data-truth-state, none linking a rollout tab)`
			);
			continue;
		}
		console.log(`${where0}: ${rows.length} rollout links`);
		for (const r of rows)
			compare(
				`${where0} ${r.label || r.href} -> ${r.href}`,
				r.kind === 'change-row' ? { ...r.a, age: '', since: '' } : r.a,
				/* a change row's age is the change's own (changeTruth), not the place's */ await tab(
					r.href.split('?')[0]
				),
				pg
			);
	}
}

/* the shared rows print the dwell age neutral ("a11c909 20m"); the word "waiting" is optional, the build id and the age are exact tokens, the age follows the build */
const escRe = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const buildAge = (text, build, age, word = 'waiting') =>
	new RegExp(
		`(?<![\\w.-])${escRe(build)}(?![\\w.-])[^]{0,60}?(?:${word}\\s+)?(?<![\\w.-])${escRe(age)}(?![\\w.])`,
		'i'
	).test(text);
/* RolloutLine prints the dwell before the build ("Waiting for approval 2h 4a8d2e6"): both exact tokens, either order, within 60 chars, "waiting" optional */
const buildAgeAny = (text, build, age) =>
	buildAge(text, build, age) ||
	new RegExp(
		`(?<![\\w.-])${escRe(age)}(?![\\w.])[^]{0,60}?(?<![\\w.-])${escRe(build)}(?![\\w.-])`,
		'i'
	).test(text);
/* an age matches when the strings are equal, or both are minutes/seconds within 90s (the minute turned between two reads); an hour or a day never slides */
const closeAge = (a, b) => {
	if (a === b) return true;
	const x = secs(a),
		y = secs(b);
	return (
		x != null &&
		y != null &&
		/^\d+\s?[sm]$/.test((a ?? '').trim()) &&
		/^\d+\s?[sm]$/.test((b ?? '').trim()) &&
		Math.abs(x - y) <= 90
	);
};
const hasAge = (text, age) => new RegExp(`(?<![\\w.-])${escRe(age)}(?![\\w.])`).test(text);
/* ── the oracle: expectations derived HERE from the raw /api/rollouts answer (the fixture's own timestamps, gates, catalogue), never from the app's models (data.ts waitClock / rollouts /
   buildInQuestionFacts). The mock dates every response relative to the moment it is asked, so an age is "the instant the answer was asked − a raw timestamp"; the page and the oracle agree to the
   minute. THE HOLD-CLOCK RULE (data.ts holdSince documents the same rule): the hold of an approval wait began when the OLDEST build the approval gate still refuses ARRIVED AT ITS GATE, that is the later
   of the build's creation and the first moment a LOWER tier of the same app deployed it (no lower tier: its creation; a lower tier that never ran it: no hold can be told). A build refused by a
   promotion gate waits for that step, not here, so only builds every promotion gate allows count; when none qualifies the refused builds all do. A row or card covering several places shows the
   LONGEST wait among them (the oldest held place). A place whose newest history entry is still InProgress is checking: it has no hold yet. ── */
const FMT_AGE = (n) => {
	const s = Math.max(0, Math.floor(n));
	return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
};
/* a printed age equals the oracle's to the minute: the page read its answer a few seconds before the oracle read its own */
const ageIs = (printed, ageSec) => [-120, -60, 0, 60, 120].some((d) => FMT_AGE(ageSec + d) === (printed ?? '').trim());
const TIER_RANK = { dev: 0, test: 1, staging: 2, prod: 3 };
const placeKey = (href) => {
	const m = /^\/rollouts\/[^/]+\/([^/?#]+)\/([^/?#]+)/.exec(href ?? '');
	return m ? `${m[1]}/${m[2]}` : null;
};
/* the words of a place's state, and the state each one names. Unknown words are reported, so a new word has to be added here on purpose. */
function stateOfWord(word) {
	const w = word.trim();
	if (/^(Failing|Failed)\b/.test(w)) return 'failed';
	if (/^Deploying\b/.test(w)) return 'deploying';
	if (/^Checking\b/.test(w)) return 'checking';
	if (/^(Needs your approval|Waiting for approval)\b/.test(w)) return 'awaiting-approval';
	if (/^(Waits on|Waits for|Held by|Held\b)/.test(w)) return 'held-by-rule';
	if (/^(Healthy|Up to date|At rest|\d+ (builds? )?behind|Rolled back)\b/.test(w)) return 'healthy';
	return undefined;
}
const yoursByState = new Map();
async function loadOracle() {
	const at = Date.now();
	const res = await ctx.request.get(`${base}/api/rollouts`);
	if (!res.ok()) throw new Error(`GET /api/rollouts answered ${res.status()}`);
	return holdOracle(await res.json(), at);
}
function holdOracle(raw, at) {
	const tagOf = (v) => v?.tag ?? v?.version ?? v?.revision ?? '';
	const tierOf = (r) =>
		/^(dev|test|staging|prod)/.exec(r.metadata.labels?.environment ?? '')?.[1] ??
		/-(dev|test|staging|prod)(-|$)/.exec(r.metadata.namespace)?.[1] ??
		null;
	const places = (raw.rollouts?.items ?? []).map((r) => ({
		key: `${r.metadata.namespace}/${r.metadata.name}`,
		ns: r.metadata.namespace,
		app: r.metadata.name,
		tier: tierOf(r),
		cluster: r.metadata.annotations?.['rollout-dashboard.kuberik.com/source-cluster'] ?? 'default',
		spec: r.spec ?? {},
		st: r.status ?? {}
	}));
	const arrival = (p, c) => {
		const lower = places.filter((q) => q.app === p.app && TIER_RANK[q.tier] < TIER_RANK[p.tier]);
		if (!lower.length) return c.created ?? null;
		const ts = lower.flatMap((q) => (q.st.history ?? []).filter((h) => tagOf(h.version) === c.tag).map((h) => h.timestamp)).sort();
		return ts.length ? (c.created && c.created > ts[0] ? c.created : ts[0]) : null;
	};
	const groups = new Map();
	for (const p of places) {
		const gates = p.st.gates ?? [];
		const appr = gates.filter((g) => g.kind === 'approval');
		const promo = gates.filter((g) => g.kind === 'promotion' && g.allowedVersions != null);
		const cands = p.st.candidates ?? p.st.releaseCandidates ?? [];
		const refused = cands.filter((c) => appr.some((g) => !(g.allowedVersions ?? []).includes(c.tag)));
		if (!appr.length || !refused.length || p.tier == null) continue;
		const here = refused.filter((c) => promo.every((g) => g.allowedVersions.includes(c.tag)));
		const arrivals = (here.length ? here : refused).map((c) => arrival(p, c)).filter(Boolean).sort();
		const gk = `${p.app}|${p.tier}`;
		if (!groups.has(gk)) groups.set(gk, { app: p.app, tier: p.tier, keys: [], clocks: new Map(), checking: true });
		const g = groups.get(gk);
		g.keys.push(p.key);
		if (p.st.history?.[0]?.bakeStatus === 'InProgress') continue;
		g.checking = false;
		if (arrivals[0]) g.clocks.set(p.key, (at - Date.parse(arrivals[0])) / 1000);
	}
	for (const g of groups.values()) {
		const secs = [...g.clocks.values()];
		g.ageSec = secs.length ? Math.max(...secs) : null; /* the longest wait = the oldest held place */
		g.wait = g.ageSec == null ? null : FMT_AGE(g.ageSec);
		g.multi = secs.length > 1 && new Set(secs.map(FMT_AGE)).size > 1;
		g.perPlace = [...g.clocks].map(([k, v]) => `${k.split('/')[0]} ${FMT_AGE(v)}`).join(', ');
	}
	/* the catalogue: a source's releases in sequence order; a place is N behind when N releases follow its current version */
	const cat = new Map();
	for (const s of raw.releaseSlices?.items ?? []) {
		const k = `${s.metadata.namespace}/${s.source ?? s.metadata.labels?.['kuberik.com/release-source']}`;
		cat.set(k, [...(cat.get(k) ?? []), ...(s.releases ?? [])]);
	}
	for (const v of cat.values()) v.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
	const behind = (p) => {
		const rels = cat.get(`${p.ns}/${p.spec.releaseSourceRef?.name}`);
		const run = tagOf(p.st.history?.[0]?.version) || p.st.currentVersion; /* the build a place runs is its newest history entry (the tab's "Running here"); status.currentVersion can lag it in the fixture */
		const i = rels ? rels.findIndex((x) => x.tag === run || x.version === run) : -1;
		return i < 0 ? null : rels.length - 1 - i;
	};
	return {
		groups,
		places,
		pins: places.filter((p) => p.spec.wantedVersion),
		groupOf: (href) => [...groups.values()].find((g) => g.keys.includes(placeKey(href))) ?? null,
		behindOf: (app, tier) => places.filter((p) => p.app === app && p.tier === tier).map(behind).filter((n) => n != null),
		behind,
		/* the candidates newer than the place's running build in the catalogue order (a pin refuses these) */
		newerCandidates: (p) => {
			const rels = cat.get(`${p.ns}/${p.spec.releaseSourceRef?.name}`) ?? [];
			const run = tagOf(p.st.history?.[0]?.version) || p.st.currentVersion;
			const at = rels.findIndex((x) => x.tag === run || x.version === run);
			return (p.st.candidates ?? p.st.releaseCandidates ?? []).filter((c) => at >= 0 && rels.findIndex((x) => x.tag === c.tag) > at);
		},
		catalogue: (p) => cat.get(`${p.ns}/${p.spec.releaseSourceRef?.name}`)
	};
}
/* ── checks A (the viewer's action per row per page = data.ts actionFor), B (an approval wait's clock = the hold clock derived HERE from the raw fixture timestamps by the
      hold-clock rule, see holdOracle(); NOT D.waitClock / D.rollouts; a row or card covering several places prints the LONGEST wait; a checking place's age = the tab's CHECKING age),
      C (the env pages' to-approve figures = fleetCounts(state).places.approval; every "(N for you)" = the places of the rows that say "Needs your approval"),
      W (state word = state for every row, card and tile), L (every "N behind" = the catalogue order). A and C's fleet total import the app's modules INTO the page from the vite
      server; B, W and L read the raw /api/rollouts answer of the same server and never the app's models. ── */
async function fleetChecks(statesToCheck) {
	const PAGES = ['/rollouts', '/environments', '/envs/prod', '/apps', '/', '/changes'];
	for (const state of statesToCheck) {
		await useState(state);
		for (const path of PAGES) {
			const where0 = `fleet[${state}] ${path}`;
			const p = await ctx.newPage();
			for (let attempt = 0; attempt < 2; attempt++) {
				/* a page that renders no <main> is a load hiccup: look once more */
				await p.goto(
					`${base}${path}${state === 'calm' ? '?calm=1' : state === 'quiet' ? '?quiet=1' : ''}`,
					{ waitUntil: 'load' }
				);
				await p
					.waitForFunction(
						() => (document.querySelector('main')?.innerText || '').trim().length > 40,
						null,
						{ timeout: 60000 }
					)
					.catch(() => {});
				if (await p.$('main')) break;
			}
			if (!(await p.$('main'))) {
				bad(where0, 'the page rendered no <main> after two loads');
				await p.close();
				continue;
			}
			await p.waitForTimeout(2500);
			const r = await p
				.evaluate(async (st) => {
					const D = await import('/src/lib/components/new/data.ts');
					const rows = D.rollouts(st).rows;
					const byHref = new Map(rows.map((x) => [x.href.replace(/\/$/, ''), x]));
					const norm = (h) =>
						(h || '')
							.split('?')[0]
							.replace(/\/gates$/, '')
							.replace(/\/$/, '');
					const main = document.querySelector('main');
					const btns = [...main.querySelectorAll('a.btn, button.btn')]
						.map((a) => ({
							text: a.textContent.replace(/\s+/g, ' ').trim(),
							href: norm(a.getAttribute('href') ?? a.dataset.href ?? null),
							raw: a.getAttribute('href') ?? a.dataset.href ?? null
						}))
						.filter((b) => /^(Roll back|Approve|Review approval)/.test(b.text));
					const A = btns
						.map((b) => {
							const row = byHref.get(b.href);
							const act = row ? D.actionFor(row, st) : null;
							const kind = /^Roll back/.test(b.text) ? 'rollback' : 'approve';
							return { ...b, ok: !!act && act.kind === kind, app: row?.app ?? '?' };
						})
						.filter((b) => !b.ok);
					const txt = main.innerText.replace(/\s+/g, ' ');
					/* every "(N for you)" the page prints: the places of the rows that say "Needs your approval" (C2) */
					const forYou = [...txt.matchAll(/\((\d+) for you\)/g)].map((m) => +m[1]);
					const want = D.fleetCounts(st).places.approval;
					/* /environments lists one row per place group, each with its own "N to approve" cell; only page-level figures equal the fleet, the cells must SUM to it */
					const toN = (el) => {
						const m = /(\d+)\s*(?:places?\s+)?(?:to approve|waiting for approval)/i.exec(
							(el?.innerText ?? '').replace(/\s+/g, ' ')
						);
						return m ? +m[1] : null;
					};
					const envRows = [...main.querySelectorAll('li[data-truth-kind="env-row"]')];
					const envs = envRows.length
						? {
								rollup: toN(main.querySelector('[data-truth-kind="fw-rollup"]')),
								header: toN(main.querySelector('h1')?.closest('header')),
								tags: [...main.querySelectorAll('[data-truth-kind="fw-approval"]')].map((t) => ({
									station: t.closest('[data-station]')?.dataset.station ?? '?',
									n: +t.dataset.truthN,
									text: toN(t)
								})),
								rows: envRows.map((l) => ({
									env: l.dataset.truthEnv,
									attr: +l.dataset.truthApproval || 0,
									cells: [...l.querySelectorAll('[data-n][title*="to approve" i]')].map((c) => ({
										n: +c.dataset.n,
										text: toN(c)
									}))
								}))
							}
						: null;
					const els = [
						...main.querySelectorAll(
							'[data-truth-kind="rollout"],[data-truth-kind="app"],[data-truth-kind="attention"]'
						)
					].map((el) => ({
						kind: el.dataset.truthKind,
						lr: el.classList.contains('lr'),
						app: el.dataset.truthApp,
						group: el.dataset.truthGroup,
						href: norm(
							el.dataset.truthHref ||
								el.querySelector('a[href^="/rollouts/"]')?.getAttribute('href')
						),
						text: el.innerText.replace(/\s+/g, ' ').trim(),
						since: el.dataset.truthSince,
						wb: el.dataset.truthWaitBuild,
						word:
							el.querySelector('[data-state-word],[data-word]')?.textContent.replace(/\s+/g, ' ').trim() ?? '',
						age: el.querySelector('.lr-age')?.textContent.trim() ?? ''
					}));
					/* W: every element that carries a state, with the word it prints for it (row [data-state-word], card [data-word], tile data-truth-fact) */
					const words = [...main.querySelectorAll('[data-truth-state]')].map((el) => ({
						kind: el.dataset.truthKind ?? '',
						app: el.dataset.truthApp ?? '',
						href: norm(el.dataset.truthHref),
						state: el.dataset.truthState,
						word:
							el.querySelector('[data-state-word],[data-word]')?.textContent.replace(/\s+/g, ' ').trim() ?? '',
						fact: el.dataset.truthFact ?? ''
					}));
					/* L: every "N behind" a tile prints, with the app and the environment cell it sits in */
					const lags = [...main.querySelectorAll('.env-lag')].map((e) => ({
						app: e.closest('[data-truth-app]')?.dataset.truthApp ?? '',
						tier: (e.closest('.env-cell')?.innerText ?? '').trim().split(/\s+/)[0],
						text: e.textContent.replace(/\s+/g, ' ').trim()
					}));
					return { A, forYou, want, els, envs, words, lags };
				}, state)
				.catch((e) => ({ error: String(e.message).slice(0, 120) }));
			await p.close();
			if (r.error) {
				bad(where0, `fleet probe failed (${r.error})`);
				continue;
			}
			for (const b of r.A)
				bad(
					where0,
					`A: "${b.text}" -> ${b.raw} but data.ts actionFor offers no such action on ${b.app}`
				);
			if (r.envs) {
				const E = r.envs,
					w = r.want;
				/* the stopped counts are the PAGE HEADER's facts, said once; the spine's head says only what moves ("N in progress"), so the header must carry the to-approve total and the rollup may not */
				if (w && E.header == null)
					bad(
						where0,
						`C: page header prints no to-approve total, fleetCounts().places.approval is ${w}`
					);
				if (E.rollup != null && E.rollup !== w)
					bad(
						where0,
						`C: spine rollup says ${E.rollup} to approve, fleetCounts().places.approval is ${w}`
					);
				if (E.header != null && E.header !== w)
					bad(
						where0,
						`C: page header says ${E.header} to approve, fleetCounts().places.approval is ${w}`
					);
				const tagSum = E.tags.reduce((n, t) => n + t.n, 0);
				if (tagSum !== w)
					bad(
						where0,
						`C: spine to-approve tags (${E.tags.map((t) => t.station + ' ' + t.n).join(', ') || 'none'}) sum to ${tagSum}, fleetCounts().places.approval is ${w}`
					);
				for (const t of E.tags)
					if (t.text !== t.n)
						bad(
							where0,
							`C: ${t.station} tag prints ${t.text} to approve, its data-truth-n is ${t.n}`
						);
				let cellSum = 0;
				for (const row of E.rows) {
					const s = row.cells.reduce((n, c) => n + c.n, 0);
					cellSum += s;
					if (s !== row.attr)
						bad(
							where0,
							`C: row ${row.env} to-approve cell ${s} vs data-truth-approval ${row.attr}`
						);
					for (const c of row.cells)
						if (c.text !== c.n)
							bad(where0, `C: row ${row.env} prints ${c.text} to approve, data-n ${c.n}`);
				}
				if (cellSum !== w)
					bad(
						where0,
						`C: per-row to-approve cells sum to ${cellSum} (${E.rows
							.filter((x) => x.cells.length)
							.map((x) => x.env + ' ' + x.cells.reduce((n, c) => n + c.n, 0))
							.join(', ')}), fleetCounts().places.approval is ${w}`
					);
				console.log(
					`${where0}: C envs: rollup ${E.rollup}, header ${E.header}, tags ${tagSum}, row cells sum ${cellSum} = fleet ${w}`
				);
			}
			/* C: the only fleet-wide approval figure a non-environment page prints is the Attention rollup "N to approve" (the viewer's asks, checked against the cards in rolloutsText); the old
			   "N to approve / N waiting for approval" scan matched no text in any state, so it is gone. What /environments and /envs/<tier> really print is "(N for you)": the places of the rows that
			   say "Needs your approval", counted here from the oracle's place sets (C2). */
			const O = await loadOracle().catch((e) => {
				bad(where0, `oracle: ${String(e.message).slice(0, 120)}`);
				return null;
			});
			if (!O) continue;
			if (path === '/rollouts') {
				const yours = { total: 0, byTier: {} };
				for (const x of r.els) {
					const g = (x.kind === 'rollout' || x.kind === 'attention') && x.group === 'approval' && x.word === 'Needs your approval' ? O.groupOf(x.href) : null;
					if (!g) continue;
					yours.total += g.keys.length;
					yours.byTier[g.tier] = (yours.byTier[g.tier] ?? 0) + g.keys.length;
				}
				yoursByState.set(state, yours);
			}
			const yours = yoursByState.get(state);
			let forYouChecked = 0;
			for (const n of r.forYou) {
				if (!yours) {
					bad(where0, `C2: "(${n} for you)" printed but /rollouts was not read first in state ${state}`);
					continue;
				}
				forYouChecked++;
				const want = path.startsWith('/envs/') ? (yours.byTier[path.slice(6)] ?? 0) : null;
				if (want != null ? n !== want : n !== yours.total && !Object.values(yours.byTier).includes(n))
					bad(
						where0,
						`C2: "(${n} for you)" but the rows saying "Needs your approval" cover ${yours.total} places (${JSON.stringify(yours.byTier)})`
					);
			}
			/* B: an approval wait has ONE clock: the hold clock, derived from the raw fixture timestamps (holdOracle). A row or card that covers several places shows the LONGEST wait of them. */
			let waitsChecked = 0;
			for (const g of O.groups.values()) {
				const clocks = [...g.clocks.values()];
				for (const e of r.els.filter((x) =>
					x.kind === 'app' ? x.app === g.app : (x.kind === 'rollout' || (x.kind === 'attention')) && x.group === 'approval' && g.keys.includes(placeKey(x.href))
				)) {
					/* a still-checking place has no hold yet, so no dwell is expected on its row or tile; its row prints the check's own age. */
					if (g.checking) {
						if (e.kind === 'rollout') {
							const tt = await tab(e.href);
							const tage = (tt.age || '').replace(/\s*ago$/, '');
							if (
								tage &&
								![...e.text.matchAll(/(?<![\w.-])\d+\s?(?:s|m|h|d|w|mo)(?![\w.])/g)].some((m) =>
									closeAge(m[0], tage)
								)
							)
								bad(where0, `B: ${g.app} checking row prints no tab CHECKING age "${tage}": ${e.text.slice(0, 90)}`);
						}
						continue;
					}
					if (g.ageSec == null) continue; /* no arrival can be told (the build waits for a promotion step): no hold clock to compare */
					waitsChecked++;
					if (e.kind === 'attention') {
						/* the Attention card says "for <hold clock>" in its own sentence */
						const m = /\bfor (\d+\s?(?:s|m|h|d|w|mo))\b/.exec(e.text);
						if (!m)
							bad(where0, `B: ${g.app} Attention card prints no wait clock, the hold clock is "${g.wait}": ${e.text.slice(0, 110)}`);
						else if (!ageIs(m[1], g.ageSec))
							bad(where0, `B: ${g.app} Attention card says "for ${m[1]}" but the hold clock is "${g.wait}"${g.multi ? ` (oldest of ${clocks.length} places: ${g.perPlace})` : ''}: ${e.text.slice(0, 110)}`);
					} else if (e.kind === 'rollout' && e.lr) {
						if (!ageIs(e.age, g.ageSec))
							bad(where0, `B: ${g.app} row age column "${e.age}" is not the hold clock "${g.wait}"${g.multi ? ` (oldest of ${clocks.length} places: ${g.perPlace})` : ''}: ${e.text.slice(0, 110)}`);
					} else if (e.kind === 'rollout') {
						if (!e.wb || !buildAgeAny(e.text, e.wb, g.wait))
							bad(where0, `B: ${g.app} row should print "${e.wb}" + "[waiting] ${g.wait}": ${e.text.slice(0, 110)}`);
					} else if (/\bNEXT\b/.test(e.text) && (!e.wb || !e.text.includes(e.wb) || !hasAge(e.text, g.wait)))
						bad(where0, `B: ${g.app} tile should print "${e.wb}" + hold clock "${g.wait}": ${e.text.slice(0, 110)}`);
				}
			}
			/* W: the state word names the state (Deploying never reads "Failing", an approval never reads "Held") on every row, card and tile of every page */
			let wordsChecked = 0;
			for (const w of r.words) {
				const said = (w.word || w.fact).trim();
				if (!said) continue;
				wordsChecked++;
				const implied = stateOfWord(said);
				if (implied === undefined)
					bad(where0, `W: ${w.app} (${w.state}) prints "${said}", which is not a state word the product has`);
				else if (implied !== w.state && !(w.state === 'checking' && implied === 'deploying'))
					bad(where0, `W: ${w.app} ${w.href} state is ${w.state} but its word is "${said}" (a ${implied} word)`);
			}
			/* L: "N behind" = the place's distance from the newest release in the source's catalogue order (releaseSlices by sequence) */
			for (const l of r.lags) {
				const n = +(/(\d+)/.exec(l.text)?.[1] ?? NaN);
				const have = O.behindOf(l.app, l.tier);
				if (!have.length) continue; /* no catalogue to count against */
				if (!have.includes(n))
					bad(where0, `L: ${l.app} ${l.tier} says "${l.text}" but the catalogue order puts its places ${have.join(' / ')} behind`);
			}
			console.log(
				`${where0}: A/B/C/W/L checked (${r.A.length} action mismatches; ${waitsChecked} wait clocks vs the raw fixture, ${forYouChecked} "for you" counts, ${wordsChecked} state words, ${r.lags.length} "N behind")`
			);
		}
	}
}
if (process.env.NO_FLEET !== '1') await fleetChecks(states);
/* env-detail: /envs/<tier> is the Environments tile opened at page scale — its header bar says exactly what the tile's bar says (lists and detail never disagree), and every app tile in its body names an app that has a row here */
async function envDetailChecks() {
	const p = await ctx.newPage();
	await p.goto(`${base}/environments`, { waitUntil: 'load' });
	await p.waitForSelector('[data-env-tile]', { timeout: 60000 }).catch(() => {});
	await p.waitForTimeout(1500);
	const tiles = await p.evaluate(() =>
		[...document.querySelectorAll('[data-env-tile]')].map((t) => ({
			tier: t.dataset.envTile,
			label: t.querySelector('[role="img"]')?.getAttribute('aria-label') ?? ''
		}))
	);
	for (const t of tiles) {
		await p.goto(`${base}/envs/${t.tier}`, { waitUntil: 'load' });
		await p.waitForSelector('[data-env-page]', { timeout: 60000 }).catch(() => {});
		await p.waitForTimeout(1500);
		const d = await p.evaluate(() => ({
			label:
				document.querySelector('[data-env-state] [role="img"]')?.getAttribute('aria-label') ?? null,
			tiles: [...document.querySelectorAll('[data-truth-kind="app"]')].map(
				(e) => e.dataset.truthApp
			),
			words: [
				...document.querySelectorAll(
					'[data-gangway-tile][data-truth-group="approval"] [data-env-box] .env-word'
				)
			].map((e) => e.textContent.trim()),
			yoursWords: [...document.querySelectorAll('[data-gangway-tile] .env-word')].map((e) =>
				e.textContent.trim()
			),
			todayRows: document.querySelectorAll('[data-day-row]').length,
			fold: !!document.querySelector('[data-show-earlier]')
		}));
		if (d.label !== t.label)
			bad(`envdetail /envs/${t.tier}`, `header bar "${d.label}" vs Environments tile "${t.label}"`);
		if (new Set(d.tiles).size !== d.tiles.length)
			bad(`envdetail /envs/${t.tier}`, `an app tile appears twice: ${d.tiles.join(', ')}`);
		for (const w of d.words)
			if (!['Needs your approval', 'Waiting for approval'].includes(w))
				bad(`envdetail /envs/${t.tier}`, `approval gate word "${w}" is not approvalWord()`);
		if (d.todayRows > 8)
			bad(
				`envdetail /envs/${t.tier}`,
				`Today list shows ${d.todayRows} rows before "Show N earlier" (fold is 8)`
			);
		console.log(
			`envdetail /envs/${t.tier}: header = tile (${t.label}), ${d.tiles.length} app tiles`
		);
	}
	await p.close();
}
/* the detail checks below read the default (incident) scenario: a fresh context, never the last list state's cookie */
if (process.env.NO_ENVD !== '1') {
	await useState('incident');
	await envDetailChecks();
}
/* the change page reads the live source the Changes list reads. Every single-change bead on /changes (repo cards) must
   sit in the SAME tier box, in the same bead state, on that change's own page (its header env row), and the page must resolve (not 404). */
async function changeDetailChecks() {
	const p = await ctx.newPage();
	await p.goto(`${base}/changes`, { waitUntil: 'load' });
	await p.waitForSelector('[data-bead]', { timeout: 60000 }).catch(() => {});
	await p.waitForTimeout(1500);
	const beads = await p.evaluate(() =>
		[...document.querySelectorAll('a[data-bead][href^="/changes/"]')]
			.filter((b) => b.querySelectorAll('span:not(.cd-x)').length >= 1 && !b.querySelector('.cd-x'))
			.map((b) => ({
				href: b.getAttribute('href'),
				state: b.dataset.bead,
				tier: b.closest('[data-tier]')?.dataset.tier ?? '',
				refs: [...b.querySelectorAll('span')]
					.map((x) => x.textContent.trim())
					.filter((t) => /^#|^[0-9a-f]{7}$/.test(t))
			}))
			.filter((b) => b.refs.length === 1)
	);
	const seen = new Set();
	for (const b of beads) {
		if (seen.has(b.href)) continue;
		seen.add(b.href);
		await p.goto(`${base}${b.href}`, { waitUntil: 'load' });
		await p.waitForSelector('[data-change-detail], h1', { timeout: 60000 }).catch(() => {});
		await p.waitForTimeout(1200);
		const d = await p.evaluate(() => {
			const s = document.querySelector('[data-change-strip]');
			const bd = s?.querySelector('[data-bead]');
			return {
				found: !!document.querySelector('[data-change-detail]'),
				state: bd?.dataset.bead ?? null,
				tier: bd?.closest('[data-tier]')?.dataset.tier ?? null
			};
		});
		const tag = `changedetail ${b.href}`;
		if (!d.found) {
			bad(tag, 'the list links a change its page cannot find');
			continue;
		}
		if (d.state !== b.state) bad(tag, `bead state "${d.state}" vs the list's "${b.state}"`);
		if (d.tier !== b.tier) bad(tag, `bead in "${d.tier}" vs the list's "${b.tier}"`);
	}
	console.log(`changedetail: ${seen.size} changes agree with their /changes bead`);
	await p.close();
}
if (process.env.NO_CHGD !== '1') {
	await useState('incident');
	await changeDetailChecks();
}
/* a multi-service change is placed per service: platform-telemetry #20's change page must list telemetry-indexer prod as WAITING (its gate holds #20's build), never "not affected" (the lookup is by the change's repo, not the app name) */
async function multiServiceChecks() {
	const p = await ctx.newPage();
	await p.goto(`${base}/changes`, { waitUntil: 'load' });
	await p.waitForSelector('a[href*="platform-telemetry"]', { timeout: 60000 }).catch(() => {});
	const href = await p.evaluate(
		() =>
			[...document.querySelectorAll('a[href^="/changes/"]')]
				.map((a) => a.getAttribute('href'))
				.find((h) => /platform-telemetry\/pull\/20$/.test(h)) ?? null
	);
	if (!href) {
		bad('multiservice', 'no /changes link to platform-telemetry #20');
		await p.close();
		return;
	}
	await p.goto(`${base}${href}`, { waitUntil: 'load' });
	await p.waitForSelector('[data-change-detail]', { timeout: 60000 }).catch(() => {});
	await p.waitForTimeout(1200);
	const t = await p.evaluate(() => document.querySelector('[data-change-detail]')?.innerText ?? '');
	const na = t.split('\n').map((l) => l.trim());
	const i = na.findIndex((l) => /not affected/i.test(l) && !/\d+ not affected/.test(l));
	const tail = i >= 0 ? na.slice(i).join(' ') : '';
	if (
		/telemetry-indexer/.test(tail) &&
		/prod/i.test(
			tail.slice(tail.indexOf('telemetry-indexer'), tail.indexOf('telemetry-indexer') + 40)
		)
	)
		bad('multiservice ' + href, 'telemetry-indexer prod is listed under "not affected"');
	if (!/telemetry-indexer/.test(t) || !/waiting|approval/i.test(t))
		bad('multiservice ' + href, 'telemetry-indexer prod is not shown as waiting');
	/* the change page's place row for telemetry-indexer prod prints the same hold clock as the /rollouts row */
	const w = holdClock.get('telemetry-indexer|prod');
	const k = na.findIndex((l, j) => l === 'telemetry-indexer' && j > na.indexOf('Where it runs'));
	const wi = k >= 0 ? na.slice(k, k + 14).findIndex((l) => l === 'Waiting for approval') : -1;
	const cage = wi >= 0 ? na[k + wi + 1] : null;
	if (w && cage != null && !closeAge(cage, w))
		bad(
			'multiservice ' + href,
			`telemetry-indexer prod place row prints "${cage}" but the hold clock is "${w}" (the hold clock, as printed on /rollouts)`
		);
	else if (w && cage == null)
		bad(
			'multiservice ' + href,
			'no "Waiting for approval" place row for telemetry-indexer on the change page'
		);
	console.log(
		`multiservice ${href}: telemetry-indexer prod ${/telemetry-indexer/.test(tail) ? 'NOT AFFECTED' : /telemetry-indexer/.test(t) && /waiting|approval/i.test(t) ? 'waiting' : 'MISSING'}`
	);
	await p.close();
}
/* one wait, one clock (the hold clock, derived from the raw fixture: holdOracle): the /rollouts row's age column and the Attention card (fleetChecks B), every PLACE row of the app page and the change page's place row print the same figure
   for the same approval wait. The app page lists places one by one, so each prints that place's OWN clock (payments-core: sa-east 1d, the other four 4h); a folded row shows the longest. The build's own age is printed, labelled, on the tab's Newer builds list and is not compared here. */
const holdClock = new Map();
async function waitClockChecks() {
	let O;
	try {
		O = await loadOracle();
	} catch (e) {
		return bad('waitclock', `could not read the raw fixture (${String(e.message).slice(0, 120)}): nothing was checked`);
	}
	const p = await ctx.newPage();
	/* the waits the PAGE shows as approvals (rows and cards of /rollouts); the oracle supplies each one's clock. A place whose gate refuses a build but that /rollouts does not list as an approval is not a wait here. */
	await p.goto(`${base}/rollouts?scenario=incident`, { waitUntil: 'load' });
	await p.waitForSelector('li[data-truth-kind=rollout],[data-truth-kind=attention]', { timeout: 60000 }).catch(() => {});
	await p.waitForTimeout(1500);
	const shown = await p.evaluate(() => [...document.querySelectorAll('[data-truth-kind=rollout],[data-truth-kind=attention]')].filter((e) => e.dataset.truthGroup === 'approval').map((e) => e.dataset.truthHref ?? ''));
	const groups = [...new Set(shown.map((h) => O.groupOf(h)).filter(Boolean))].filter((g) => !g.checking && g.clocks.size);
	if (!shown.length) return bad('waitclock', '/rollouts lists no approval wait, so nothing was checked');
	if (!groups.length) return bad('waitclock', `/rollouts lists ${shown.length} approval waits but the raw fixture has no approval gate refusing a build at any of them`);
	let n = 0;
	for (const g of groups) {
		holdClock.set(`${g.app}|${g.tier}`, g.wait);
		await p.goto(`${base}/apps/${g.app}`, { waitUntil: 'load' });
		await p.waitForSelector('[data-place-row]', { timeout: 30000 }).catch(() => {});
		await p.waitForTimeout(1000);
		for (const [key, ageSec] of g.clocks) {
			const age = await p.evaluate(
				(k) =>
					[...document.querySelectorAll('li[data-truth-kind=rollout]')]
						.find((l) => (l.dataset.truthHref ?? '').split('?')[0].endsWith(`/${k}`))
						?.querySelector('.pl-since')
						?.textContent.trim() ?? null,
				key
			);
			const tag = `waitclock /apps/${g.app} ${key.split('/')[0]}`;
			n++;
			if (age == null) bad(tag, 'the app page has no place row for this approval wait');
			else if (!ageIs(age, ageSec))
				bad(tag, `place row prints "${age}" but the hold clock derived from the fixture's timestamps is "${FMT_AGE(ageSec)}"`);
		}
		if (g.multi) console.log(`waitclock: ${g.app} ${g.tier} covers ${g.keys.length} places with different clocks (${g.perPlace}); a folded row must print the longest, "${g.wait}"`);
	}
	console.log(`waitclock: ${groups.length} approval waits, ${n} place rows compared with the clock derived from the raw fixture`);
	await p.close();
}
if (process.env.NO_WAITCLOCK !== '1') {
	await useState('incident');
	await waitClockChecks();
}
if (process.env.NO_MULTI !== '1') {
	await useState('incident');
	await multiServiceChecks();
}
/* ── v2 checks. P: the pinned place (spec.wantedVersion). A pin is a HOLD: /rollouts lists its place under Held and says "Held by the pin"; its Overview says "Held by the pin" on every newer build it refuses;
      its Gates tab offers "Clear pin" and never an approval; the app page's environment cell counts it ("Held 3 of 5 regions" counts the pin among the 3).
   N: every "N behind" on an app page's place rows = the distance from the newest release in the source's catalogue order. ── */
async function v2Checks() {
	let O;
	try {
		O = await loadOracle();
	} catch (e) {
		return bad('v2', `could not read the raw fixture (${String(e.message).slice(0, 120)}): nothing was checked`);
	}
	const p = await ctx.newPage();
	const read = async (path, settle = 2500) => {
		for (let attempt = 0; ; attempt++) {
			try {
				await p.goto(base + path, { waitUntil: 'load', timeout: 60000 });
				break;
			} catch (e) {
				if (attempt) {
					bad(`v2 ${path}`, `page did not load (${String(e.message).split('\n')[0].slice(0, 80)})`);
					return false;
				}
			}
		}
		await p.waitForFunction(() => (document.querySelector('main')?.innerText || '').trim().length > 80, null, { timeout: 30000 }).catch(() => {});
		await p.waitForTimeout(settle);
		return true;
	};
	if (!O.pins.length) bad('pin', 'the raw fixture has no pinned place (spec.wantedVersion), so the pinned-place case is not exercised');
	await read('/rollouts', 3500);
	for (const g of await p.locator('[data-show-all][aria-expanded=false]').all()) await g.click({ timeout: 1500 }).catch(() => {});
	await p.locator('[data-rest-fold]').first().click({ timeout: 1500 }).catch(() => {});
	const rows = await p.evaluate(() =>
		[...document.querySelectorAll('li[data-truth-kind=rollout]')].map((l) => ({
			href: (l.dataset.truthHref ?? '').split('?')[0],
			group: l.dataset.truthGroup,
			state: l.dataset.truthState,
			section: l.closest('[data-group]')?.dataset.group ?? '',
			word: l.querySelector('[data-state-word]')?.textContent.replace(/\s+/g, ' ').trim() ?? '',
			approve: [...l.querySelectorAll('a.btn, button.btn')].some((b) => /^(Approve|Review approval)/.test(b.textContent.trim()))
		}))
	);
	for (const pin of O.pins) {
		const tag = `pin ${pin.app} ${pin.key.split('/')[0]}`;
		const href = `/rollouts/${pin.cluster}/${pin.key}`;
		const row = rows.find((r) => placeKey(r.href) === pin.key);
		if (!row) bad(tag, '/rollouts has no row for the pinned place');
		else {
			if (row.group !== 'held' || row.state !== 'held-by-rule' || row.section !== 'Held')
				bad(tag, `/rollouts lists the pin as group "${row.group}" state "${row.state}" in section "${row.section}", a pin is a hold (Held)`);
			if (row.word !== 'Held by the pin') bad(tag, `/rollouts says "${row.word}" for the pin, not "Held by the pin"`);
			if (row.approve) bad(tag, '/rollouts offers an approval on a pinned place');
		}
		const base0 = row?.href ?? href;
		await read(`${base0}/gates`, 3000);
		const gt = await p.evaluate(() => ({
			text: document.querySelector('main')?.innerText ?? '',
			btns: [...document.querySelectorAll('main button, main a.btn')].map((b) => b.textContent.trim()).filter(Boolean)
		}));
		if (!gt.btns.includes('Clear pin')) bad(tag, `Gates tab offers no "Clear pin" (buttons: ${gt.btns.join(' | ') || 'none'})`);
		const appr = gt.btns.filter((b) => /^(Approve|Review approval)/.test(b));
		if (appr.length) bad(tag, `Gates tab offers "${appr.join('", "')}" on a pinned place, a pin is cleared, never approved`);
		if (/Needs your approval|Waiting for approval/.test(gt.text)) bad(tag, 'Gates tab words the pin as an approval wait');
		await read(base0, 3000);
		const ov = await p.evaluate(() => ({
			text: document.querySelector('main')?.innerText ?? '',
			btns: [...document.querySelectorAll('main button, main a.btn')].map((b) => b.textContent.trim()).filter(Boolean)
		}));
		/* the builds the pin refuses: newer than the pinned version in the catalogue order, and not a build that already failed here */
		const rels = (O.catalogue(pin) ?? []);
		const at = rels.findIndex((x) => (x.tag ?? x.version) === pin.st.currentVersion);
		const failedHere = new Set((pin.st.history ?? []).filter((h) => h.bakeStatus === 'Failed').map((h) => h.version?.tag ?? h.version?.version));
		const want = (pin.st.candidates ?? []).filter((c) => at >= 0 && rels.findIndex((x) => x.tag === c.tag) > at && !failedHere.has(c.tag)).length;
		const got = (ov.text.match(/Held by the pin/g) ?? []).length;
		if (!want) bad(tag, 'the fixture pin refuses no build, so "Held by the pin" is not exercised');
		else if (got !== want) bad(tag, `Overview says "Held by the pin" on ${got} builds, the pin refuses ${want} (newer than ${pin.st.currentVersion}, not failed here)`);
		if (!ov.btns.includes('Clear pin')) bad(tag, 'Overview offers no "Clear pin"');
		if (ov.btns.some((b) => /^(Approve|Review approval)/.test(b))) bad(tag, 'Overview offers an approval on a pinned place');
		/* the app page: the environment cell's "Held N of M regions" counts the pin */
		await read(`/apps/${pin.app}`, 3500);
		const ap = await p.evaluate((tier) => ({
			cells: [...document.querySelectorAll('main .env-cell')].map((c) => c.innerText.replace(/\s+/g, ' ').trim()).filter((t) => t.split(' ')[0] === tier),
			rows: [...document.querySelectorAll('li[data-truth-kind=rollout]')].map((l) => ({ href: l.dataset.truthHref ?? '', state: l.dataset.truthState, text: l.innerText.replace(/\s+/g, ' ').trim() }))
		}), pin.tier);
		const mine = ap.rows.find((r) => placeKey(r.href) === pin.key);
		const cell = ap.cells.map((t) => /Held (\d+) of (\d+) regions/.exec(t)).find(Boolean);
		const tierPlaces = O.places.filter((q) => q.app === pin.app && q.tier === pin.tier);
		const heldRows = ap.rows.filter((r) => O.places.some((q) => q.app === pin.app && q.tier === pin.tier && placeKey(r.href) === q.key) && /\bHeld\b|\bWaits (on|for)\b/.test(r.text));
		if (!mine) bad(tag, `/apps/${pin.app} has no place row for the pin`);
		else {
			if (!/Held by the pin/.test(mine.text)) bad(tag, `/apps/${pin.app} place row does not say "Held by the pin": ${mine.text.slice(0, 90)}`);
			if (mine.state !== 'held-by-rule') bad(tag, `/apps/${pin.app} place row carries state "${mine.state}", /rollouts says held-by-rule for the same pin`);
		}
		if (!cell) bad(tag, `/apps/${pin.app} ${pin.tier} environment cell prints no "Held N of M regions" (cells: ${ap.cells.join(' | ') || 'none'})`);
		else {
			if (+cell[2] !== tierPlaces.length) bad(tag, `${pin.tier} cell says "${cell[0]}" but the fixture has ${tierPlaces.length} ${pin.tier} places`);
			/* the pins come from the RAW fixture (spec.wantedVersion set while newer candidates exist), never from the page's rows; the other held places are the page's own place rows that are not a pin */
			const pinsHolding = O.pins.filter((q) => q.app === pin.app && q.tier === pin.tier && O.newerCandidates(q).length);
			const otherHeld = heldRows.filter((r) => !pinsHolding.some((q) => q.key === placeKey(r.href))).length;
			if (+cell[1] !== otherHeld + pinsHolding.length)
				bad(tag, `${pin.tier} cell says "${cell[0]}" but ${pinsHolding.length} pinned place(s) (raw spec.wantedVersion with newer builds) + ${otherHeld} other held place rows make ${otherHeld + pinsHolding.length}: the pin must count as held`);
		}
		console.log(`pin ${pin.app} ${pin.key.split('/')[0]}: /rollouts "${row?.word}" in ${row?.section}, Gates "Clear pin"${appr.length ? ' + APPROVAL' : ' only'}, Overview ${got}/${want} "Held by the pin", app cell "${cell?.[0] ?? '?'}"`);
	}
	/* N: every build row of an app page's Builds ledger says how far behind the newest release it is (data-truth-lag): that is its distance from the end of the source's catalogue order */
	let nb = 0;
	for (const app of [...new Set(O.places.filter((q) => q.spec.releaseSourceRef).map((q) => q.app))]) {
		const q0 = O.places.find((q) => q.app === app && q.spec.releaseSourceRef);
		const rels = O.catalogue(q0);
		if (!rels?.length) continue;
		if (!(await read(`/apps/${app}`, 2000))) continue;
		const bs = await p.evaluate(() => [...document.querySelectorAll('li[data-truth-kind=build]')].map((l) => ({ build: l.dataset.truthBuild ?? '', lag: l.dataset.truthLag ?? '', text: l.innerText.replace(/\s+/g, ' ').trim() })));
		for (const r of bs) {
			const i = rels.findIndex((x) => x.version === r.build || x.tag === r.build);
			const m = /\b(\d+) behind\b/.exec(r.text);
			if (i < 0 || r.lag === 'custom') continue; /* a build the catalogue does not hold, or a custom build, has no place in its order */
			const want = rels.length - 1 - i;
			if (want === 0) {
				if (m || (r.lag && r.lag !== '0')) bad(`behind /apps/${app} ${r.build}`, `the newest release says "${m?.[0] ?? 'lag ' + r.lag}"`);
				continue;
			}
			nb++;
			if (r.lag !== String(want) || (m && +m[1] !== want))
				bad(`behind /apps/${app} ${r.build}`, `Builds row says ${m ? `"${m[0]}"` : 'nothing'} (data-truth-lag ${r.lag || 'none'}), the catalogue order puts it ${want} behind the newest (${rels.length} releases, position ${i + 1})`);
		}
	}
	console.log(`behind: ${nb} "N behind" on app place rows compared with the catalogue order`);
	await p.close();
}
if (process.env.NO_V2 !== '1') {
	await useState('incident');
	await v2Checks();
}
await browser.close();
const uniq = [...new Set(problems)];
if (uniq.length) {
	console.log(`\n${uniq.length} MISMATCH(ES):`);
	for (const m of uniq) console.log(' - ' + m);
	process.exit(1);
}
console.log('\nOK: every rollout link agrees with its tab');
