/**
 * THE ROLLOUTS PAGE VIEW-MODEL (r39 build; mock .work/home-r34/direction/r39/rollouts.html + kit/model.js `rolloutsPage`).
 * Pure composition over the data.ts helpers: no fact is invented here. Composition, top to bottom:
 *   banner     the lead failure (AlertPanel shape; the change line = the build's own PR identity)
 *   attention  the OTHER failing rollouts, then the viewer's approvals (kit compact Attention cards)
 *   groups     "All rollouts": In flight / Waiting / Held, one strand row each, then At rest (a quiet row per healthy place)
 * A rollout that is in the banner or in Attention is not repeated in the groups (each fact once; the page header counts all of them).
 * Honest fallbacks: no `observations[]` API on the list payload yet, so a failing card leads with the check's NAME and message
 * (attention.ts `checkFact`), never a figure; an approval card is title-led (no ratio) as the mock draws it.
 */
import { newestFirst } from '$lib/instant';
import {
	rollouts, pinOnlyPlaces, pinRow, placeCause, placesOf, placeBehind, regionStates, noReleasesAt, ago, buildOf, buildIdentity, deployedBuild, buildInQuestionFacts, holdSince, pinSinceOfHref, waitClock, gateName, isViewer, personOf, avatarSrc,
	type TRow, type HomeState
} from './data';
import { markOf, tabEnv, rowAction, actionHref, runwayRow, type MarkState } from './rollout-view';
import { nodesOfSteps, type MiniNode } from './mini-pipeline';
import { holdWordParts } from './rollout-view';
import { approvalWord } from './state-words';
import { attentionModel, approvalLead, type AttentionModel } from '$lib/view-models/attention';
import { failedBannerTitle } from '$lib/view-models/banner';
import { causeText, joinCause, gateLabelText, labelPart, type Cause } from '$lib/view-models/gate-label';
import { HELD_BY_PIN } from '$lib/view-models/pin-hold';
import { regionsPhrase, siteCount } from '$lib/view-models/regions';
import { TIER_RANK as TIER_RANKS } from '$lib/view-models/sites-waves';

const TIER_WORDS = new Set(['production', 'prod', 'staging', 'dev', 'test']);

/** the place beside the tier chip: "5 regions" · "eu-west" · null when the place is just the tier */
export function chipPlace(r: Pick<TRow, 'tier' | 'regions' | 'where'> & { place?: string }, hs?: HomeState): string | null {
	void hs;
	/* "N regions" only for more than one SITE (regions.ts); several entries on one default site are not regions (QA2) */
	const rp = r.regions.length > 1 ? regionsPhrase(siteCount(r.regions)) : null;
	if (rp) return rp;
	const p = tabEnv({ tier: r.tier, regions: r.regions, place: undefined }).replace(/^prod-/, '');
	return !p || TIER_WORDS.has(p) || p === r.tier ? null : p;
}

export type ChangeLine = { title: string; ref?: string; person?: string; src?: string | null; you?: boolean };
/** the change that the place's deployed build carries (PR number · title · author), the same source /changes prints */
export function changeLineOf(r: TRow): ChangeLine | null {
	const idn = buildIdentity(buildOf(r), r.href);
	const dep = deployedBuild(r);
	const title = idn?.title ?? dep.title;
	if (!title) return null;
	const author = idn?.author ?? dep.author;
	const you = isViewer(author);
	const person = personOf(author);
	return { title, ref: idn?.pr ? `#${idn.pr}` : undefined, person: you ? 'you' : person ?? undefined, you, src: you || !person ? null : avatarSrc(person) ?? null };
}

/** the failure banner's meta line (Since · build), one fact each; null parts are not printed. The place is the title's own ("failed in prod · eu-west"), never a second chip. */
export type BannerMeta = { since: string | null; build: string | null };
export type BannerModel = { row: TRow; title: string; check: { name: string; message: string } | null; line: string | null; change: ChangeLine | null; openHref: string; rollbackHref: string | null; meta: BannerMeta };
export type AttentionItem = { key: string; row: TRow; model: AttentionModel; app: string; href: string; rollbackHref: string | null; openHref: string; yours: boolean };
export type StrandRow = { key: string; row: TRow; app: string; href: string; tier: string; place: string | null; mark: MarkState; nodes: MiniNode[]; /** the state word / cause, typed (`CauseText` draws a promotion label by kind); `causeText(lead)` is its plain form */ lead: Cause; rest: string; age: string; yours: boolean; };
export type RestRow = { key: string; app: string; href: string; place: string; rep: boolean; sentence: string; code: string; age: string; tier: string; /** the quiet row prints the build code before the sentence (Changes' At rest) */ codeFirst?: boolean; /** r42 atoms (opt-in, /design/atoms): the landed change's lead bar */ lead?: { hops: import('$lib/components/atoms/LeadBar.svelte').Hop[]; origin?: number; scale: number; total: string } | null };
export type GroupKey = 'moving' | 'waiting' | 'held';
export const GROUP_WORD: Record<GroupKey, string> = { moving: 'In flight', waiting: 'Waiting', held: 'Held' };

export type RolloutsPage = {
	banner: BannerModel | null;
	attention: AttentionItem[];
	failing: number; toApprove: number;
	groups: { key: GroupKey; word: string; rows: StrandRow[] }[];
	rest: RestRow[]; restApps: number;
	counts: { moving: number; waiting: number; held: number; rest: number };
	empty: boolean;
};

/** a rollout's own steps as strand nodes; a gated rollout gets its GATE as the frontier node (held / approval; to-do while it still checks its own deploy) */
export function strandOf(r: TRow, hs: HomeState): MiniNode[] {
	const nodes = nodesOfSteps(r.steps, r.state);
	if (r.state === 'held-by-rule' || r.state === 'awaiting-approval') {
		const g = gateName(r, hs);
		nodes.push({ state: r.stillChecking ? 'pending' : r.state === 'awaiting-approval' ? 'approval' : 'held', step: g ? gateLabelText(g.label) : (r.state === 'awaiting-approval' ? 'Approval' : 'Gate') });
	}
	return nodes;
}

const sinceDesc = (a: { since?: string | null }, b: { since?: string | null }) => newestFirst(a.since, b.since);

/** [state word, what the strand cannot draw]. Never "step N of M". */
/** `clockInSentence: false` — the row has an age slot (the aligned column) that already prints the wait's clock, so the sentence does not say "for 5h" a second time (QA2 #8). */
/** the plain-text form of `sentenceParts`: what tests, titles and any sink that cannot draw read */
export function sentenceOf(r: TRow, hs: HomeState, o: { clockInSentence?: boolean } = {}): [string, string] {
	const [lead, rest] = sentenceParts(r, hs, o);
	return [causeText(lead), rest];
}
/** the row's sentence with its lead typed: a promotion hold keeps its `GateLabel`, so the row draws » [STAGING] instead of printing "Held by Promotion from staging" */
export function sentenceParts(r: TRow, hs: HomeState, o: { clockInSentence?: boolean } = {}): [Cause, string] {
	/* no releases: the row keeps its own state word and detail; the label only takes the currency slot, appended after the detail */
	if (r.noReleases && r.group !== 'failed') {
		const [lead, rest] = sentenceParts({ ...r, noReleases: null }, hs, o);
		return [lead, [rest, r.noReleases.label].filter(Boolean).join(' · ')];
	}
	if (r.group === 'approval') {
		return [[approvalWord(!!r.needsYou && !r.stillChecking)], r.stillChecking ? 'check still running' : o.clockInSentence === false ? '' : `for ${ago(waitClock(r, hs))}`];
	}
	if (r.group === 'held') {
		const g = gateName(r, hs);
		return [joinCause(placeCause(r.href, r.app, r.key, hs) ?? holdWordParts(r, hs) ?? (g ? ['Held by ', labelPart(g.label)] : r.word), r.alsoApproval ? ` · also needs ${r.alsoApproval.yours ? 'your ' : ''}approval` : ''), g?.sentence ?? ''];
	}
	const title = buildIdentity(buildOf(r), r.href)?.title ?? deployedBuild(r).title ?? '';
	if (r.state === 'deploying') {
		const cur = r.steps.find((s) => s.state === 'active');
		const stage = cur && /^Stage/.test(cur.name) ? cur.name : '';
		return [['Deploying'], [stage, title].filter(Boolean).join(' · ')];
	}
	return [['Checking'], title];
}

export function strandRow(r: TRow, hs: HomeState): StrandRow {
	const [lead, rest] = sentenceParts(r, hs, { clockInSentence: false });
	const gated = r.group === 'approval' || r.group === 'held';
	return { key: r.key, row: r, app: r.app, href: r.href, tier: r.tier, place: chipPlace(r), mark: markOf(r), nodes: strandOf(r, hs), lead, rest, age: ago(gated && !r.stillChecking ? waitClock(r, hs) : r.since), yours: r.group === 'approval' && !!r.needsYou && !r.stillChecking };
}

/** ONE region count for an approval everywhere ("5 of 6 regions", "6 regions" when all): the prod regions that wait, of the app's prod regions */
function waitScopeOf(app: string, hs: HomeState): string | null {
	const sts = regionStates(app, hs);
	const k = sts.filter((x) => x.ink === 'waiting').length;
	return sts.length > 1 && k ? (k === sts.length ? `${k} regions` : `${k} of ${sts.length} regions`) : null;
}
/** the meta line of a failure banner from its row: how long it has failed, the failing build */
export function bannerMeta(r: TRow | null | undefined): BannerMeta {
	if (!r) return { since: null, build: null };
	return { since: r.since ? ago(r.since) : null, build: r.version ?? null };
}
/** the failure banner of a lead failing row (AlertPanel shape; the change line = the build's own PR identity) */
export function bannerOf(lead: TRow): BannerModel {
	const a = rowAction(lead);
	return { row: lead, title: failedBannerTitle(lead.app, lead.tier, chipPlace(lead)), check: lead.failure?.check ? { name: lead.failure.check, message: lead.failure.message ?? '' } : null, line: lead.failure?.line ?? null, change: changeLineOf(lead), meta: bannerMeta(lead), openHref: lead.href, rollbackHref: a?.kind === 'rollback' ? actionHref(a) : null };
}
export function attentionItem(r: TRow, hs: HomeState): AttentionItem {
	const failed = r.group === 'failed';
	const a = rowAction(r);
	const hrefRollback = a?.kind === 'rollback' ? actionHref(a) : null;
	/* the region meter draws on every approval card: the same regions Home's card counts; its figure says "5 of 6", so the chip drops the scope */
	const regions = !failed && r.tier === 'prod' ? regionStates(r.app, hs) : null;
	const counted = !!approvalLead(regions);
	const model = attentionModel({
		state: failed ? 'failed' : 'approval',
		age: failed ? ago(r.since) : ago(waitClock(r, hs)),
		tier: r.tier, place: counted ? '' : (!failed && r.tier === 'prod' && waitScopeOf(r.app, hs)) || chipPlace(r) || '',
		regions,
		check: failed ? { name: r.failure?.check ?? null, message: r.failure?.message ?? r.failure?.line ?? '' } : null,
		observations: failed ? r.failure?.observations ?? null : null,
		gateSentence: failed ? null : gateName(r, hs)?.sentence ?? null,
		title: r.app
	});
	return { key: r.key, row: r, model, app: r.app, href: r.href, rollbackHref: failed ? hrefRollback : null, openHref: r.href, yours: !failed };
}

/** a rest place's sentence: "Rolled back"; else its currency from the ONE behind count (a newer build held by a gate counts; one that failed or was rolled back does not): "N behind" (the Runs-in word) or "On the newest". Before the fleet answers, or while the lag is unknown, no currency is claimed: "Healthy". */
function restSentence(p: { state: string; href: string }, settled: boolean): string {
	if (p.state === 'rolled-back') return 'Rolled back';
	const n = placeBehind(p.href, settled);
	return n === null ? 'Healthy' : n > 0 ? `${n} behind` : 'On the newest';
}
/** the rows that have no section of their own on the page above: at rest = every place not covered by a row, healthy or rolled back */
function restRows(rows: TRow[], restApps: { app: string }[], hs: HomeState, settled: boolean): RestRow[] {
	const order: Record<string, number> = TIER_RANKS;
	const covered = (p: { href: string; label: string; tier: string }, app: string) =>
		rows.some((r) => r.href === p.href || (r.app === app && r.tier === p.tier && (r.regions.includes(p.label))));
	const out: (RestRow & { o: number })[] = [];
	for (const { app } of restApps) {
		for (const p of placesOf(hs, app)) {
			if (p.state !== 'healthy' && p.state !== 'rolled-back' && p.state !== 'superseded') continue;
			if (covered(p, app)) continue;
			const label = p.label.replace(/^prod-/, '');
			const place = !label || TIER_WORDS.has(label) || label === p.tier ? p.tier : `${p.tier} · ${label}`;
			const none = noReleasesAt(p.href);
			/* no releases: the health word and the running build stay; the label takes the currency slot ("2 behind" / "On the newest") */
			const sentence = none ? `${p.state === 'rolled-back' ? 'Rolled back' : 'Healthy'} · ${none.label}` : restSentence(p, settled);
			out.push({ key: p.href, app, href: p.href, place, rep: false, sentence, code: p.version ?? '', age: ago(deployedBuild({ app, href: p.href, version: p.version ?? '' }).at), tier: p.tier, o: order[p.tier] ?? 9 });
		}
	}
	out.sort((a, b) => a.app.localeCompare(b.app) || a.o - b.o || a.place.localeCompare(b.place));
	let prev = '';
	return out.map(({ o: _o, ...x }) => { const rep = x.app === prev; prev = x.app; return { ...x, rep }; });
}

export function rolloutsPage(hs: HomeState, o: { settled?: boolean } = {}): RolloutsPage {
	const R = rollouts(hs);
	const rows = R.rows;
	const failedRows = rows.filter((r) => r.group === 'failed');
	const lead = runwayRow(failedRows);
	const banner = lead ? bannerOf(lead) : null;
	const yours = rows.filter((r) => r.group === 'approval' && r.needsYou && !r.stillChecking);
	const attentionRows = [...failedRows, ...yours].filter((r) => r !== lead);
	const inAttention = new Set([...failedRows, ...yours].map((r) => r.key));
	const strand = (g: (r: TRow) => boolean) => rows.filter((r) => !inAttention.has(r.key) && g(r)).sort(sinceDesc).map((r) => strandRow(r, hs));
	const moving = strand((r) => r.group === 'moving');
	const waiting = strand((r) => r.group === 'approval');
	/* a place only the pin holds is listed under Held as a held row of its own (cause "Held by the pin") and drawn nowhere else; every total below is its list's length */
	const pinPlaces = pinOnlyPlaces(R.c.m.apps as never, rows);
	const pinHrefs = new Set(pinPlaces.map((p) => p.href));
	const held = [...rows.filter((r) => !inAttention.has(r.key) && r.group === 'held'), ...pinPlaces.map((p) => pinRow(p, hs))].sort(sinceDesc).map((r) => {
		const sr = strandRow(r, hs);
		/* the pin outranks the rules (held-chip.ts): a pin-only place's whole cause is the pin */
		return pinHrefs.has(r.href) ? { ...sr, lead: [HELD_BY_PIN], rest: '', age: ago(pinSinceOfHref(r.href)) } : sr;
	});
	const rest = restRows(rows, R.restAll ?? R.rest, hs, o.settled ?? true).filter((p) => !pinHrefs.has(p.href));
	const groups = ([['moving', moving], ['waiting', waiting], ['held', held]] as [GroupKey, StrandRow[]][]).filter(([, g]) => g.length).map(([key, g]) => ({ key, word: GROUP_WORD[key], rows: g }));
	return {
		banner, attention: attentionRows.map((r) => attentionItem(r, hs)), failing: failedRows.length, toApprove: yours.length,
		groups, rest, restApps: new Set(rest.map((p) => p.app)).size,
		counts: { moving: moving.length, waiting: waiting.length, held: held.length, rest: rest.length },
		empty: !rows.length && !rest.length
	};
}
