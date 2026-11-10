/**
 * r34 — THE DATA LAYER for the five list pages (data only, no UI). Wraps roster-data's derivations over the
 * real HomeModel on the pinned incident fixture, and is the ONE place the coordinator's truth defects are
 * fixed (.work/home-r34/TRUTH-TODO.md). Every page reads facts from here, never from roster-data directly,
 * so a fix lands on every page at once. roster-data.ts / v09/rowstate.ts stay untouched (older lab versions
 * import them); the wrappers below override by composition.
 *
 * ── THE DATA-TRUTH CONTRACT (for page lanes; tools/truth.mjs reads it) ─────────────────────────────────
 * Every element that links to a rollout tab (`/rollouts/<cluster>/<ns>/<name>`) and prints a fact about that
 * rollout carries these attributes, on the link itself or on its nearest ancestor row. Spread the helper:
 *     <a href={row.href} {...truthAttrs(row)}>…</a>            (a RolloutRow from rollouts()/inbox()/apps())
 *     <a href={c.href}  {...changeTruth(c)}>…</a>               (a ChangeItem from changes())
 *   data-truth-state  EnvState of the place ('failed','awaiting-approval','held-by-rule','deploying','checking','healthy')
 *   data-truth-steps  'Started:done|Stage 1:active|Check:todo' (stepsOf)
 *   data-truth-age    ISO instant the tab's header age counts from = when the build shown was deployed (deployedAt). A row that prints
 *                     "waiting 5h" / "failing 20m" prints time-in-state (row.since) and that is data-truth-since; tabs do not show it
 *                     except the failing-check line's own age, which truth.mjs compares for failed rows
 *   data-truth-since  ISO instant of row.since (time in the current state)
 *   data-truth-cause  failureReason(row).line for a failing row, else the hold word; '' when none
 *   data-truth-build  the build (version) the row is about
 *   data-truth-place  placeLabel(row): 'production' | 'eu-west' | '5 prod regions' | 'staging' …
 * What a page PRINTS for steps / cause / age / place must come from the same helpers (stepsOf, failureReason,
 * placeLabel, ago) so the attribute and the text cannot diverge.
 *
 * ── Defects fixed here (numbers are TRUTH-TODO.md's) ───────────────────────────────────────────────────
 *  1 rolled back but live again (#38)        -> changes(): a rolled-back place whose model entry is `liveAgain` is landed, not failed
 *  2 #41/#42/#43 -> staging tab              -> changes(): a change held downstream links to the held place's tab
 *  3 duplicate refs                          -> fixture retitled (payments-core #90/#91); `refLabel` qualifies a ref with its repo when ambiguous
 *  4 landed but only reached dev (#89)       -> changes(): reach by ancestry; landed only at the app's last tier, else "In dev · not in staging yet" (moving)
 *  5 "production" listed as a region         -> environments(): `regions` are real regions only, regionless prod places are `regionless`
 *  6 region row linked to another place      -> Region.href is the WORST place's own tab, `places` lists every tab
 *  7 gated build shown as Started            -> stepsOf(): the waiting build's nodes, all todo (AD: no hold node, no done nodes of the old build)
 *  8 step names                              -> stepsOf(): 'Started', 'Stage N', 'Check' exactly as the tab (DeploymentPipelineCard.shortLabel)
 *  9 failure reason                          -> failureReason(): check name + message + the bake phrase, from the rollout's own history
 */
import { formatTimeAgoCompact } from '$lib/utils';
import { behindOfStatus } from '$lib/view-models/behind';
import { siteCount, siteKey } from '$lib/view-models/regions';
import { gateDisplayName } from '$lib/view-models/rollout-gates';
import { heldHereOf, heldKeyOfHref } from '$lib/view-models/held-here.svelte';
import { displayVersionForTag } from '$lib/version-utils';
import { gatePrettyOf } from '$lib/view-models/gate-pretty.svelte';
import { githubAbsenceSentence } from '$lib/api/github';
import { formatTransitionAt } from '$lib/api/schedules';
import { deployReason, deployMark } from '$lib/view-models/activity-note';
import { avatarForLogin } from '$lib/github-avatar';
import { respondGithub } from '$lib/demo/github-data';
import { githubJson, rangeUrl } from './github-read.svelte';
import { rolloutStateChip } from '$lib/view-models/rollout-state-chip';
import { deployActs } from '$lib/history-marks';
import { upToDateHeadline } from '$lib/view-models/up-to-date';
import * as RD from '$lib/components/home/roster/roster-data';
import { changeBySha, homeModel, resetHomeModel, source, isLive, viewerLogin, NOW, type HomeState } from '$lib/components/home/sketch/home-data';
import { approvalRev, bumpApprovals } from './approval-rev.svelte';
import { stateWord as sharedWord, severity } from './state-words';
import type { EnvPipeline, EnvState } from '$lib/view-models/home-model';
import { buildTopology, deployNameOf, siteNodeOf, upstreamOf, type AppTopology } from '$lib/view-models/sites-waves';
import type { Environment, HealthObservation } from '../../../types';
import type { Rollout } from '$lib/../types';
import type { TierKey, RolloutRow, ChangeItem, ChangeGroupKey, Region as RDRegion, AppItem, ArrivalRow } from '$lib/components/home/roster/roster-data';

export {
	needsYouCount, appTiers, heldDownstream, liveLabels, pretty, isMe, TIER_NAME, GROUP_NAME, CHANGE_GROUP_NAME, TIERS, NOW, ME,
	arrivalRows
} from '$lib/components/home/roster/roster-data';
export type { RolloutRow, RolloutGroup, RestApp, Change, ChangeItem, ChangeGroupKey, GroupKey, AppItem, ArrivalRow, TierKey } from '$lib/components/home/roster/roster-data';
export { pipelineSegs, rowMeter, reachMeter, appMeter, failingAt, failStep, worstOf, meterKey } from '$lib/components/home/roster/v09/rowstate';
export type { Seg, Meter, ReachTone } from '$lib/components/home/roster/v09/rowstate';
export type { HomeState } from '$lib/components/home/sketch/home-data';

/** roster-data (ADD ONLY: the lab versions still import it) spells the approval wait "Waits for [your] approval". This is the one place that vocabulary is translated
 *  into the product's (state-words.ts), so no page prints or parses the old string; pages read `TApp.approval` / `Hold.approval` instead of matching text. */
const rosterWait = (t: string): string => t.replace(/^Waits for (your )?approval/, (_m, y: string | undefined) => sharedWord('approval', { yours: !!y })!);

/** ONE age format everywhere: the tab header's compact form ("25m", "9h", "3d"), counted from the fixture clock. */
export const ago = (iso: string | null | undefined): string => (iso ? formatTimeAgoCompact(iso, RD.NOW) : '');
export const ARRIVALS_WINDOW = '12h';

/* ═══ raw fixture access (the tab is served from this same data) ═══ */
type RawEntry = { message?: string; triggeredBy?: { kind?: string; name?: string }; bakeStartTime?: string; bakeEndTime?: string; version: { revision?: string; tag?: string; version?: string }; timestamp: string; bakeStatus?: string; bakeStatusMessage?: string; failedHealthChecks?: { name: string; message?: string }[] };
type RawRollout = { metadata: { name: string; namespace: string }; spec?: { wantedVersion?: string; bakeTime?: string }; status: { source?: string; history?: RawEntry[]; gates?: { name: string; passing?: boolean; allowedVersions?: string[] | null; message?: string }[]; releaseCandidates?: { tag?: string; version?: string; created?: string }[]; availableReleases?: { tag?: string; version?: string; revision?: string; created?: string }[]; wantedVersion?: string; currentVersion?: string } };
const raws = (): RawRollout[] => source().rollouts as unknown as RawRollout[];
const hrefParts = (href: string) => { const p = href.split('/').filter(Boolean); return p[0] === 'rollouts' ? { cluster: p[1], ns: p[2], name: p[3] } : null; };
const rawOf = (href: string) => { approvalRev(); const h = hrefParts(href); return h ? raws().find((r) => r.metadata.namespace === h.ns && r.metadata.name === h.name) ?? null : null; };

/* ═══ steps (defects 7, 8) ═══ */
export type StepState = 'done' | 'active' | 'fail' | 'todo' | 'hold';
/** `name` is exactly the tab's pipeline node label: 'Started', 'Stage 1'.. (numbered inside each KruiseRollout, as the tab does), 'Check'.
 *  `gate` is retired (no row has a gate node any more); kept so older callers type-check. */
export type Step = { name: string; state: StepState; gate?: boolean };
const stState = (s: string): StepState => (s === 'done' ? 'done' : s === 'fail' ? 'fail' : s === 'active' ? 'active' : 'todo');
function pipelineNodes(p: EnvPipeline | null | undefined): Step[] {
	if (!p) return [{ name: 'Started', state: 'done' }, { name: 'Check', state: 'todo' }];
	if (p.isFallback) {
		const deploy = p.tracks[0]?.stages[0]?.state ?? 'pending';
		/* defect 8: while the deploy is still rolling the tab's Check node is "Pending" (it waits for health), never active */
		return [{ name: 'Started', state: 'done' }, { name: 'Check', state: deploy === 'active' ? 'todo' : stState(deploy === 'fail' ? deploy : p.bake) }];
	}
	const out: Step[] = [{ name: 'Started', state: 'done' }];
	for (const t of p.tracks) t.stages.forEach((s, i) => out.push({ name: `Stage ${i + 1}`, state: stState(s.state) }));
	out.push({ name: 'Check', state: stState(p.bake) });
	return out;
}
/** The pipeline nodes the tab's card shows for the row, named exactly as the tab names them ('Started', 'Stage N', 'Check').
 *  - waiting for approval / held by a rule: the DEPLOYED build's finished steps, all `done`; no gate node (see `gate(row)`).
 *  - deploying / checking: exactly ONE `active` node, the live one: deploying = the stage in flight (fallback pipeline: Started), checking = Check.
 *  - failed and healthy rows: as the tab shows. */
export function stepsOf(row: Pick<RolloutRow, 'state' | 'pipeline'>): Step[] {
	const nodes = pipelineNodes(row.pipeline);
	/* a gated place's pipeline card shows the DEPLOYED build, finished (2/2 Checked); the gate is drawn by the page from `gate(row)`, not as a node */
	if ((row.state === 'awaiting-approval' || row.state === 'held-by-rule') && !nodes.some((n) => n.state === 'active')) return nodes.map((n): Step => ({ name: n.name, state: 'done' }));
	if (row.state === 'awaiting-approval' || row.state === 'held-by-rule') return nodes;
	if (row.state === 'checking') return nodes.map((n, i): Step => ({ name: n.name, state: i === nodes.length - 1 ? 'active' : 'done' }));
	/* r5 R1: a place WITHOUT a KruiseRollout (the fallback pipeline: Started · Check) that is deploying shows on the tab "Started done · Check DEPLOYING" (1/2 steps): the
	   deploy has been applied, the Check step is the one in flight. Staged pipelines keep the stage the tab marks active. */
	if (row.state === 'deploying' && (!row.pipeline || row.pipeline.isFallback)) return nodes.map((n, i): Step => ({ name: n.name, state: i < nodes.length - 1 ? 'done' : 'active' }));
	if (row.state === 'deploying') {
		let at = nodes.findIndex((n) => n.state === 'active');
		if (at < 0) at = nodes.findIndex((n) => n.state === 'todo' && n.name !== 'Check');
		if (at < 0) at = 0;
		return nodes.map((n, i): Step => ({ name: n.name, state: i < at ? 'done' : i === at ? 'active' : 'todo' }));
	}
	return nodes;
}
export const stepsKey = (s: Step[]) => s.map((x) => `${x.name}:${x.state}`).join('|');

/* ═══ history + path (AD round 1) ═══ */
/** The place's last healthy history entry (the History tab's "Healthy at …" row). For a gated place the deployed build is the current one and counts;
 *  for any other row the entry before the current build. */
export function lastHealthy(row: Pick<RolloutRow, 'state' | 'href'>): { build: string; at: string } | null {
	const hist = rawOf(row.href)?.status.history ?? [];
	const from = row.state === 'awaiting-approval' || row.state === 'held-by-rule' ? 0 : 1;
	const e = hist.slice(from).find((h) => (h.bakeStatus ?? 'Succeeded') === 'Succeeded');
	/* the tab prints the version tag when the app uses tags (2.64.0-64), a short SHA otherwise */
	return e ? { build: shortBuild(e.version.version ?? e.version.tag ?? e.version.revision) ?? '', at: e.timestamp } : null;
}
/** The Gates tab's Runs-in rollup, word for word (up-to-date.ts): the tab counts by BUILD, so a failing place on the newest build counts.
 *  Apps' own `onNewest` is a different rule on purpose (the app page says "2 of 3 · 1 failed"). */
export function pathPosition(row: Pick<RolloutRow, 'app'>, state: HomeState = 'incident'): string {
	const p = placesOf(state, row.app);
	/* r6 T1: the Gates tab's "Runs in" counts a place as on the newest when it runs the NEWEST BUILD OF THE APP'S LADDER (the last of the rollout's availableReleases,
	   which can be a build no place runs yet: hello-world staging "0 of 3"), not the newest build a place happens to run. Same rule as `runsIn`/`behindCount`. */
	const ladder = p.map((x) => rawOf(x.href)?.status as { availableReleases?: { tag?: string; version?: string; revision?: string }[] } | undefined).find((s) => s?.availableReleases?.length)?.availableReleases;
	const top = ladder?.[ladder.length - 1];
	const topIds = top ? [top.tag, top.version, top.revision?.slice(0, 7)].filter(Boolean).map((x) => shortBuild(x)) : null;
	const onHead = topIds ? p.filter((x) => !!x.version && topIds.includes(x.version)).length : p.filter((x) => x.onBuild).length;
	/* r5 R11 (owner 2026-11-02: no bare fractions): the tab's rollup, with its unit and object spelled out. The tab helper itself is untouched; this wrapper is the source every page reads. */
	const t = upToDateHeadline({ onHead, deployed: p.length, total: p.length });
	return t.replace(/^All on the newest$/, `All ${p.length} places on the newest build`).replace(/^(\d+) of (\d+) on the newest$/, '$1 of $2 places on the newest build').replace(/^(\d+) of 1 places/, '$1 of 1 place');
}

/* ═══ failure reason (defect 9) ═══ */
export type FailureReason = { check: string | null; message: string | null; phrase: string | null; line: string; /** what the failing check measures (the HealthCheck's `status.observations`, else the snapshot on the history entry): the Attention card's figure */ observations: HealthObservation[] };
/** The tab's failing-check line ("invoice-api-error-rate: error rate 8.2% over a 1% budget") and, where the history carries one that is not
 *  the generic bake sentence, the controller's own phrase ("HighErrorRate firing · paged on-call"). null unless the place is failing. */
export function failureReason(row: Pick<RolloutRow, 'group' | 'href'>): FailureReason | null {
	if (row.group !== 'failed') return null;
	const h = rawOf(row.href)?.status.history?.[0];
	if (!h) return null;
	const fc = h.failedHealthChecks?.[0] as ({ name: string; message?: string; observations?: HealthObservation[] }) | undefined;
	const generic = /^A HealthCheck reported an error/.test(h.bakeStatusMessage ?? '');
	const phrase = h.bakeStatusMessage && !generic ? h.bakeStatusMessage : null;
	const check = fc?.name ?? null, message = fc?.message ?? null;
	/* the tab's failing-check line carries the first clause of the message ("…over a 1% budget"); the rest is detail */
	const lead = message?.split(/;\s/)[0] ?? null;
	const line = check && lead ? `${check}: ${lead}` : check ?? lead ?? phrase ?? 'Failing';
	/* the live HealthCheck first (what the tab's card reads), the snapshot the controller left on the history entry otherwise */
	const hp = hrefParts(row.href);
	const live = hp ? (source().healthChecks ?? []).find((i) => i.metadata.namespace === hp.ns && i.metadata.name === hp.name)?.healthChecks.find((c) => c.metadata?.name === check) : undefined;
	const observations = (live?.status as { observations?: HealthObservation[] } | undefined)?.observations ?? fc?.observations ?? [];
	return { check, message, phrase, line, observations };
}

/* ═══ places (defect 5) ═══ */
/** Honest place word: a prod environment with no region is "production" (a place word, not a region); several folded regions are "N prod regions". */
export function placeLabel(x: { tier: string; regions?: string[]; label?: string }): string {
	const rs = x.regions ?? (x.label ? [x.label] : []);
	/* QA #10/#11: regions are SITES (distinct labels, a blank one is the default site); a blank label is never printed, the tier names the place */
	const n = siteCount(rs);
	const named = rs.map((l) => (l ?? '').trim()).find((l) => siteKey(l) !== 'default');
	if (x.tier === 'prod') return n > 1 ? `${n} prod regions` : named ?? 'production';
	return rs.find((l) => l && l.trim()) ?? x.tier;
}

/* ═══ rollouts ═══ */
export type TRow = RolloutRow & { steps: Step[]; failure: FailureReason | null; place: string; deployedAt: string | null; /** AD f: a folded production row covers n of the app's `of` production regions (null when not folded) */ regionsOf: { n: number; of: number } | null; /** AD v2 (a): classed as an approval wait while its own deploy is still being checked (the tab shows both) */ stillChecking: boolean };
const enrich = (r: RolloutRow): TRow => {
	const failure = failureReason(r);
	const t = r as TRow;
	t.steps = stepsOf(r);
	t.failure = failure;
	t.place = placeLabel(r);
	t.deployedAt = rawOf(r.href)?.status.history?.[0]?.timestamp ?? r.since ?? null; /* what the tab header's "9h ago" counts from */
	if (failure) {
		t.cause = failure.line;
		/* the tab ages "Deployment failed … · 20m ago" from the failing bake's END (the failed check's moment), not from the deploy timestamp */
		const be = rawOf(r.href)?.status.history?.[0]?.bakeEndTime;
		if (be) t.since = be;
	}
	void 0; /* defect 9: the row's one line of cause is the tab's failing check */
	return t;
};
/** The tab's TITLE form of the build (hello-frontend-app: "2.66.0-66"; apps without tags: the short SHA), and the META form (the SHA when it differs from the title). */
export const buildTitle = (r: Pick<RolloutRow, 'href' | 'version'>): string => {
	const v = rawOf(r.href)?.status.history?.[0]?.version;
	return (v ? shortBuild(v.version ?? v.tag ?? v.revision) : null) ?? r.version ?? '';
};
export const buildMeta = (r: Pick<RolloutRow, 'href' | 'version'>): string | null => {
	const rev = rawOf(r.href)?.status.history?.[0]?.version.revision?.slice(0, 7) ?? null;
	return rev && rev !== buildTitle(r) ? rev : null;
};
/** The build id the tab prints (short revision of the deployed history entry), falling back to the row's version. */
export const buildOf = (r: Pick<RolloutRow, 'href' | 'version'>): string => {
	const rev = rawOf(r.href)?.status.history?.[0]?.version.revision;
	return rev ? rev.slice(0, 7) : r.version ?? '';
};
/** data-truth-* attributes for a rollout row (spread onto the link). */
export function truthAttrs(r: TRow | RolloutRow): Record<string, string> {
	const t = r as TRow;
	const steps = t.steps ?? stepsOf(r);
	/* an approval's dwell is the WAITING build's (waitingBuild().since, the tab's Newer-builds age), never the row's */
	const wb = r.group === 'approval' ? waitingBuild(r) : null;
	return {
		'data-truth-state': r.state,
		'data-truth-steps': stepsKey(steps),
		'data-truth-age': t.deployedAt ?? rawOf(r.href)?.status.history?.[0]?.timestamp ?? r.since ?? '',
		'data-truth-since': wb?.since ?? r.since ?? '',
		...(wb ? { 'data-truth-wait-build': wb.build } : {}),
		'data-truth-cause': (t.failure ?? failureReason(r))?.line ?? r.cause ?? (r.state === 'awaiting-approval' ? sharedWord('approval')! : r.word),
		'data-truth-build': buildTitle(r),
		'data-truth-place': placeLabel(r)
	};
}
/* ═══ urgency: ONE order for every page ═══ */
/** production failure > failure elsewhere > approval wait > rule hold > moving > rest; newest `since` first within a class. */
export const urgencyClass = (r: Pick<RolloutRow, 'state' | 'group' | 'tier'> | null | undefined): number =>
	!r ? 9 : r.group === 'failed' ? (r.tier === 'prod' ? 0 : 1) : r.state === 'awaiting-approval' ? 2 : r.state === 'held-by-rule' ? 3 : r.state === 'deploying' || r.state === 'checking' ? 4 : 5;
export const urgency = (a: Pick<RolloutRow, 'state' | 'group' | 'tier' | 'since'> | null, b: Pick<RolloutRow, 'state' | 'group' | 'tier' | 'since'> | null): number =>
	urgencyClass(a) - urgencyClass(b) || Number(!!(b as { needsYou?: boolean } | null)?.needsYou) - Number(!!(a as { needsYou?: boolean } | null)?.needsYou) /* r34 build-fairway: within a class the viewer's OWN action (a rollback or approval only they can press) leads, so Needs you, /rollouts and /environments name one lead */ || (b?.since ?? '').localeCompare(a?.since ?? '');
/** The fleet's single most urgent place: failure, approval or rule hold, else the newest moving place (calm/quiet); null when nothing is in motion. Pages exclude it from their lists. */
export function lead(state: HomeState): TRow | null {
	const r = rollouts(state).rows[0];
	return r && urgencyClass(r) <= 4 ? r : null; /* calm/quiet: with nothing urgent it is the newest moving place */
}

/** An approval gate that refuses every candidate: the tab says "waiting on an approval, N newer builds" whatever the deployed build is doing (a place can be Checking and gated at once). */
const approvalHold = (href: string): number => {
	const st = rawOf(href)?.status;
	const cands = (st?.releaseCandidates ?? []).map((c) => c.tag ?? c.version ?? '');
	if (!cands.length) return 0;
	const g = (st?.gates ?? []).find((x) => /approval/.test(x.name) && x.allowedVersions != null && cands.every((c) => !x.allowedVersions!.includes(c)));
	return g ? cands.length : 0;
};
/** THE viewer's action on a row (the one helper every page asks; hand-rolled copies are defects). data.ts answers "the viewer's action": Roll back on a failing place and Approve on an approval the
 *  signed-in viewer can give, exactly as the model labels them, and NOTHING else. A row with no action (hello-frontend-app production, a calm approval someone else gives) offers no button: its row
 *  links to the rollout tab, which answers "available actions" (Retry, Roll back, Review approval) for anyone. `state` is accepted so callers pass the page's state, but the model already carries it. */
export function actionFor(row: Pick<TRow, 'group' | 'action'>, _state?: HomeState): TRow['action'] {
	const a = row.action;
	if (!a) return null;
	if (row.group === 'failed') return a.kind === 'rollback' ? a : null;
	if (row.group === 'approval') return a.kind === 'approve' ? a : null;
	return null;
}
export function rollouts(state: HomeState) {
	const R = RD.rollouts(state);
	const rows = R.rows.map(enrich);
	/* AD v2 (a): a deploying/checking place that the tab shows as waiting on an approval IS an approval wait: class, word, group, counts all follow the tab.
	   `stillChecking` keeps the truth that its own deploy is still being watched (its pipeline nodes stay as the tab draws them). */
	const yours = new Set(R.c.v.approvals.map((a) => a.app));
	for (const r of rows) {
		r.word = rosterWait(r.word);
		if ((r.state === 'checking' || r.state === 'deploying') && approvalHold(r.href) > 0) {
			r.state = 'awaiting-approval'; r.group = 'approval'; r.glyph = 'approval';
			r.needsYou = yours.has(r.app);
			r.word = sharedWord('approval', { yours: r.needsYou })!;
			r.action = r.needsYou ? { label: 'Approve', href: r.href, kind: 'approve' } : null;
			(r as TRow).stillChecking = true;
			r.steps = pipelineNodes(r.pipeline);
		} else (r as TRow).stillChecking = false;
	}
	rows.sort(urgency);
	for (const r of rows) r.regionsOf = r.tier === 'prod' && r.regions.length > 1 ? { n: r.regions.length, of: prodRegionCount(R.c.m as never, [r.app]) } : null;
	const order: RD.GroupKey[] = ['failed', 'approval', 'held', 'moving'];
	const groups = order.map((k) => ({ key: k, rows: rows.filter((r) => r.group === k) as TRow[], places: rows.filter((r) => r.group === k).reduce((n, r) => n + r.regions.length, 0) })).filter((g) => g.rows.length);
	/* ONE unit (AD v2 e): every count below is in PLACES (a folded prod row of 3 regions is 3 places); `rowCount` is rows */
	const places = (k: RD.GroupKey) => groups.find((g) => g.key === k)?.places ?? 0;
	const placeFigures = { unit: 'places' as const, failing: places('failed'), approval: places('approval'), held: places('held'), waiting: places('approval') + places('held'), moving: places('moving'), rowCount: rows.length };
	const figures = { ...R.figures, yourApprovals: rows.filter((r) => r.group === 'approval' && r.needsYou).length, moving: places('moving') };
	return { ...R, rows: rows as TRow[], groups, figures, placeFigures };
}
export type Rollouts = ReturnType<typeof rollouts>;

/* ═══ changes (defects 1, 2, 3, 4) ═══ */
/** AD e/f: `failure` = the failing check of the change's worst rollout row (null unless failing); `regions` = "2 of 5" for a folded production place: n = regions the fact covers, of = the app's production regions (null when the place is not folded prod). */
export type TChange = ChangeItem & { /** the person to print: the author, but never the viewer on their own change (AD v2 y) */ person: string | null; /** the approval-scope sentence when the viewer can act: "Waits for your approval · prod-ap-south · 1 of 5 regions waiting" */ scope: string | null; refLabel: string; prHref: string | null; tabHref: string | null; /** the mocked `/changes/github.com/…` page for this change */ changeHref: string | null; failure: FailureReason | null; regions: { n: number; of: number } | null; /** the author's login as the tabs print it (`who` is the same login) */ author: string | null; commitHref: string | null; prNumber: number | null;
	/** AD v2 (c): for a change waiting on an approval, the HELD build's title and author as the Overview's Newer builds lists them */
	heldBuild: { build: string; title: string | null; author: string | null; person: string | null } | null;
	/** the viewer can give the approval this change waits for (then it also shows in Mine) */
	youApprove: boolean };
const RANK_T: Record<TierKey, number> = { dev: 0, test: 1, staging: 2, prod: 3 };
const TWORD: Record<TierKey, string> = { dev: 'dev', test: 'test', staging: 'staging', prod: 'production' };
type FxChange = { repo: string; title: string; mergedAt: string; mergeCommitSha: string; kind?: string; number?: number; author?: string; htmlUrl?: string };
const chgList = (): FxChange[] => source().changes as unknown as FxChange[];
const tierOfEnv = (e: { isProdRegion: boolean; tier: string }): TierKey => (e.isProdRegion || e.tier === 'prod' ? 'prod' : e.tier === 'dev' ? 'dev' : e.tier === 'test' ? 'test' : 'staging');

/** Defect 4: the furthest tier whose deploy history contains this change's build OR a later build of the same app (a skipped build rides along with the next one). */
function reachByAncestry(state: HomeState, apps: string[], sha: string | null, mergedAt: string): TierKey | null {
	const m = homeModel(state);
	let best: TierKey | null = null;
	for (const a of m.apps) {
		if (!apps.some((n) => a.app.startsWith(n) || n.startsWith(a.app))) continue;
		for (const e of a.envs) {
			if (e.state === 'not-deployed') continue;
			const raw = raws().find((r) => r.metadata.name === a.app && (r.metadata.namespace === e.env || r.metadata.namespace.endsWith(`-${e.env}`)));
			/* a place the scenario shows healthy (calm masks the model's state, not the raw bake) runs its CURRENT build, whatever that entry's raw bake says */
			const ok = (raw?.status.history ?? []).some((h, i) => {
				if ((h.bakeStatus ?? 'Succeeded') === 'Failed' && !(i === 0 && e.state !== 'failed')) return false;
				const v = (h.version.revision ?? h.version.tag ?? '').slice(0, 7);
				if (sha && v === sha) return true;
				const c = changeBySha(a.app, v);
				return !!c && c.mergedAt >= mergedAt;
			});
			if (ok) { const t = tierOfEnv(e); if (!best || RANK_T[t] > RANK_T[best]) best = t; }
		}
	}
	return best;
}

/** AD d: the places (at `reach` tier) that run a build carrying this change and are not failing/held; the latest arrival is when the change is fully there. */
function livePlaces(state: HomeState, apps: string[], sha: string | null, mergedAt: string, reach: TierKey | null, includeHeld = false): { href: string; at: string; n: number; label: string } | null {
	if (!reach) return null;
	const m = homeModel(state);
	const found: { href: string; at: string; label: string }[] = [];
	for (const a of m.apps) {
		if (!apps.some((n) => a.app.startsWith(n) || n.startsWith(a.app))) continue;
		for (const e of a.envs) {
			if (tierOfEnv(e) !== reach || ['not-deployed', 'failed', ...(includeHeld ? [] : ['awaiting-approval', 'held-by-rule'])].includes(e.state)) continue;
			const raw = rawOf(e.href);
			const hist = [...(raw?.status.history ?? [])].reverse(); /* oldest first */
			const first = hist.find((h, i) => {
				if ((h.bakeStatus ?? 'Succeeded') === 'Failed' && !(i === hist.length - 1 && e.state !== 'failed')) return false; /* the current entry of a place the scenario shows healthy runs */
				const v = (h.version.revision ?? h.version.tag ?? '').slice(0, 7);
				if (sha && v === sha) return true;
				const c = changeBySha(a.app, v);
				return !!c && c.mergedAt >= mergedAt;
			});
			if (first) found.push({ href: e.href, at: first.timestamp, label: e.label });
		}
	}
	if (!found.length) return null;
	found.sort((p, q) => q.at.localeCompare(p.at));
	return { href: found[0].href, at: found[0].at, n: new Set(found.map((f) => f.label)).size, label: found[0].label };
}

/** The production regions an app (or a set of apps) runs in: the denominator of "2 of 5 regions". */
function prodRegionCount(m: { apps: { app: string; envs: { isProdRegion: boolean; tier: string; state: string; label: string }[] }[] }, apps: string[]): number {
	/* distinct region NAMES across the apps; a regionless prod place ("prod") is not a region, so an app with one prod rollout has no "n of m" */
	const labels = new Set<string>();
	for (const a of m.apps) if (apps.includes(a.app)) for (const e of a.envs) if (tierOfEnv(e) === 'prod' && e.state !== 'not-deployed' && siteKey(e.label) !== 'default') labels.add(e.label);
	return labels.size;
}

export function changes(state: HomeState, opts: { rolledBackLands?: boolean } = {}) {
	const C = RD.changes(state, opts);
	const m = homeModel(state);
	const R = rollouts(state);
	const items = C.items as TChange[];
	for (const i of items) i.fact = rosterWait(i.fact);
	/* held places by label/app for linking a downstream-held change to the held tab */
	const heldTab = (apps: string[], where: string): string | null => {
		const tier: TierKey | null = where.endsWith('prod regions') || where === 'production' ? 'prod' : null;
		for (const a of m.apps) {
			if (!apps.includes(a.app)) continue;
			for (const e of a.envs)
				if ((e.state === 'awaiting-approval' || e.state === 'held-by-rule') && (tier ? tierOfEnv(e) === 'prod' : e.label === where)) return e.href;
		}
		return null;
	};
	/* AD (5): the same #N in two repos anywhere in the fixture is qualified, whether or not both are on screen */
	const refRepos = new Map<string, Set<string>>();
	for (const c of chgList()) if (c.kind === 'pr' && c.number != null) { const k = `#${c.number}`; refRepos.set(k, (refRepos.get(k) ?? new Set()).add(c.repo)); }
	const refCount = new Map<string, number>();
	for (const i of items) refCount.set(i.ref, (refCount.get(i.ref) ?? 0) + 1);
	for (const i of items) {
		i.prHref = null;
		i.tabHref = null;
		/* defect 1: a rolled-back place whose current build carries the change again is live, not failed */
		if (i.rolledBack) {
			const env = m.apps.filter((a) => i.apps.includes(a.app)).flatMap((a) => a.envs).find((e) => e.myChanges.some((c) => c.ref === i.ref && c.state === 'rolled-back' && c.liveAgain));
			if (env) {
				i.group = 'landed'; i.glyph = 'arrived'; i.rolledBack = false;
				i.where = placeLabel({ tier: tierOfEnv(env), regions: [env.label] });
				i.fact = `Deployed again in ${i.where} after a rollback`;
				i.since = env.arrivedAt ?? i.since; i.reach = tierOfEnv(env); i.at = i.reach; i.href = env.href;
			}
		}
		/* defect 2: a change waiting downstream links to the place that holds it */
		if (i.group === 'waiting' && /^(Waiting for approval|Held|Waits on)/.test(i.fact)) {
			const h = heldTab(i.apps, i.where);
			if (h) { i.tabHref = h; i.prHref = i.href.startsWith('http') ? i.href : null; i.href = h; }
		}
		/* defect 4 (+AD a,b,d): landed means arrived at the app's last environment; reach is by ancestry, not by exact sha. Applies to mine and
		   team alike. The change links to a place that is LIVE with it, and its age counts from that place's arrival (one `since` per change). */
		if (i.group === 'landed' && !i.rolledBack) {
			const ch = chgList().find((c) => i.repo === c.repo && c.mergedAt === i.mergedAt);
			const sha = ch?.mergeCommitSha.slice(0, 7) ?? null;
			const reach = reachByAncestry(state, i.apps, sha, i.mergedAt) ?? i.reach;
			const last = i.tiers[i.tiers.length - 1];
			const live = livePlaces(state, i.apps, sha, i.mergedAt, reach);
			i.reach = reach; i.at = reach;
			if (live) { i.tabHref = live.href; i.prHref = i.href.startsWith('http') ? i.href : null; i.href = live.href; i.since = live.at; }
			if (reach && last && RANK_T[reach] < RANK_T[last]) {
				const next = i.tiers.find((t) => RANK_T[t] > RANK_T[reach]);
				i.group = 'moving'; i.glyph = 'rest';
				i.fact = `In ${TWORD[reach]} · not in ${next ? TWORD[next] : 'the next environment'} yet`;
				i.where = TWORD[reach];
				/* AD v2 (a): the next tier's place is gated by an approval (even while it checks its own deploy): the change waits for approval there */
				const gated = next ? R.rows.find((r) => i.apps.includes(r.app) && r.tier === next && r.state === 'awaiting-approval') : null;
				if (gated) { i.group = 'waiting'; i.glyph = 'approval'; i.where = gated.regionsOf || gated.regions.length > 1 ? `${gated.regions.length} prod regions` : gated.place; i.fact = `${sharedWord('approval')} in ${i.where}`; i.tabHref = gated.href; i.href = gated.href; i.since = gated.since ?? i.since; }
			} else if (reach) {
				/* one rule for every landed change: regions that RUN a build carrying it (a held place still runs its deployed build), named when one, counted when several */
				const runs = reach === 'prod' ? livePlaces(state, i.apps, sha, i.mergedAt, 'prod', true) : null;
				i.where = reach === 'prod' ? (runs ? (runs.n > 1 ? `${runs.n} prod regions` : placeLabel({ tier: 'prod', regions: [runs.label] })) : live ? placeLabel({ tier: 'prod', regions: [live.label] }) : i.where) : reach;
				i.fact = reach === last || reach === 'prod' ? `In ${i.where}${reach !== 'prod' ? ' · its last environment' : ''}` : `In ${i.where}`;
			}
		}
		/* the rows' own age wins when the change links to a rollout row: one fact, one age */
		if (i.group !== 'landed') { const lr = R.rows.find((r) => r.href === i.href); if (lr?.since && i.group !== 'moving') i.since = lr.since; }
		/* defect 3: a ref that exists in another repo too is qualified with its repo */
		i.refLabel = i.ref.startsWith('#') && (((refRepos.get(i.ref)?.size ?? 0) > 1) || (refCount.get(i.ref) ?? 0) > 1) ? `${i.repo}${i.ref}` : i.ref;
	}
	for (const i of items) {
		i.fact = i.fact.replace(/ on check ([a-z0-9-]+)/, (_m, n: string) => ` on ${gateDisplayName(n)}`); /* AD v2 (q): gate names as the Gates tab prints them */
		i.heldBuild = null; i.youApprove = false; i.scope = null;
		if (i.group === 'waiting' && /^Waiting for approval/.test(i.fact)) {
			const hr = R.rows.find((r) => r.href === i.href && r.state === 'awaiting-approval');
			if (hr) {
				const hb = candidateBuilds(hr)[0];
				i.heldBuild = hb ? { ...hb, person: personOf(hb.author) } : null;
				i.youApprove = hr.needsYou;
				if (hr.needsYou) { const sc = approvalScope(hr, state); i.scope = sc.sentence; i.mine = true; i.fact = sc.sentence; }
			}
		}
		i.failure = i.group === 'failed' ? (R.rows.find((r) => r.href === i.href)?.failure ?? failureReason({ group: 'failed', href: i.href })) : null;
		/* AD (2): "n of m" is the tab's prod n/of: production regions that RUN a build carrying the change, over the app's production regions */
		const ofProd = prodRegionCount(m, i.apps);
		const chg = chgList().find((c) => c.repo === i.repo && c.mergedAt === i.mergedAt) ?? chgList().find((c) => c.title === i.title);
		const nProd = ofProd > 1 ? (livePlaces(state, i.apps, chg?.mergeCommitSha.slice(0, 7) ?? null, i.mergedAt, 'prod', true)?.n ?? 0) : 0;
		i.regions = ofProd > 1 ? { n: nProd, of: ofProd } : null;
		/* AD (3)(4): links to the change itself and its author's login, from the fixture's own change record */
		i.author = chg?.author ?? null;
		if (chg?.author) i.who = chg.author;
		i.person = personOf(chg?.author ?? i.who);
		i.prNumber = chg?.kind === 'pr' ? chg.number ?? null : null;
		i.prHref = chg?.kind === 'pr' ? chg.htmlUrl ?? null : null;
		i.commitHref = chg?.kind !== 'pr' ? chg?.htmlUrl ?? null : null;
		i.changeHref = chg?.htmlUrl ? '/changes/github.com' + new URL(chg.htmlUrl).pathname.replace(/\/commit\//, '/') : null;
	}
	const order: ChangeGroupKey[] = ['failed', 'waiting', 'moving', 'landed'];
	const sortIt = (a: ChangeItem, b: ChangeItem) => (b.since ?? '').localeCompare(a.since ?? '');
	/* AD c: ONE derivation of every figure; header, chips and groups all read `totals`. rolled-back changes are their own count, never in a group total. */
	const tally = (xs: ChangeItem[]) => {
		const t = { failed: 0, waiting: 0, moving: 0, landed: 0, rolledBack: 0, total: xs.length };
		for (const x of xs) { if (x.rolledBack) t.rolledBack++; else t[x.group]++; }
		return t;
	};
	const totals = { mine: tally(items.filter((i) => i.mine)), team: tally(items.filter((i) => !i.mine)), all: tally(items) };
	/* AD: the lead change = the one `lead(state)` carries when it is yours, else the most urgent of yours by the same order */
	const L = lead(state);
	const cls = (i: ChangeItem) => (i.rolledBack ? 9 : i.group === 'failed' ? (/production|prod regions/.test(i.where) ? 0 : 1) : i.group === 'waiting' ? (i.fact.startsWith(sharedWord('approval')!) ? 2 : 3) : 5);
	const mineAll = items.filter((i) => i.mine);
	const leadChange: TChange | null =
		(L && (mineAll.find((i) => i.href === L.href) ?? mineAll.find((i) => L.change?.ref === i.ref && i.apps.includes(L.app)))) ||
		[...mineAll].filter((i) => cls(i) <= 3).sort((a, b) => cls(a) - cls(b) || sortIt(a, b))[0] || null;
	const group = (mine: boolean) => order.map((k) => ({ key: k, rows: items.filter((i) => i.mine === mine && i.group === k).sort((a, b) => Number(b === leadChange) - Number(a === leadChange) || sortIt(a, b)) })).filter((g) => g.rows.length);
	return {
		...C, items, mine: group(true), team: group(false), totals, lead: leadChange,
		/* kept for older callers; same numbers as `totals` */
		figures: { failing: totals.mine.failed, waiting: totals.mine.waiting, moving: totals.mine.moving, teamFailing: totals.team.failed }
	};
}
export type Changes = ReturnType<typeof changes>;
/** The avatar the History tab draws for a login: the signed-in account's picture (the mock GitHub status), undefined for anyone else (the page draws the monogram). */
export function avatarSrc(login: string | null | undefined): string | undefined {
	return avatarForLogin(login, source().github);
}
/** Why the changes lists are empty when GitHub is the reason (null when the list is the answer): the sentence the product uses everywhere GitHub is absent (githubAbsenceSentence). 'loading' while the first answer is on its way, so a page never says "nothing" before it knows. */
export type GithubAbsence = { kind: 'loading' | 'absent' | 'error'; title: string; sentence: string; /** true when the reader can fix it themselves: GitHub is set up here but they have not connected (QA #20) */ connect: boolean };
/** The pure part of `githubAbsence`: the sentence and the remedy for one `changesState`. */
export function absenceFor(state: string): GithubAbsence | null {
	if (state === 'ok') return null;
	if (state === 'loading') return { kind: 'loading', title: '', sentence: '', connect: false };
	if (state === 'error') return { kind: 'error', title: 'Changes could not be read', sentence: 'GitHub did not answer.', connect: false };
	return { kind: 'absent', title: 'Changes need GitHub', sentence: githubAbsenceSentence({ configured: state === 'not_connected' ? true : false, connected: false }), connect: state === 'not_connected' };
}
export function githubAbsence(): GithubAbsence | null {
	return absenceFor(source().changesState);
}
/** THE one answer to "which change does this approval release, and who wrote it": the identity of the build the gate holds (waitingBuild), the person by display name; `you` when the viewer wrote it.
 *  Home, Rollouts and Changes all print this, so one approval is one change everywhere. */
export function approvalIdentity(row: Pick<RolloutRow, 'app' | 'href'>): { ref?: string; title?: string; person?: string; you: boolean } {
	const wb = waitingBuild(row);
	const idn = wb ? buildIdentity(wb.build, row.href) : null;
	const author = idn?.author ?? wb?.author ?? null;
	const you = isViewer(author);
	return { ref: idn?.pr ? `#${idn.pr}` : undefined, title: idn?.title ?? wb?.title ?? undefined, person: you ? undefined : personName(author) ?? undefined, you };
}
/** a login as a person's name (the display-name helper every page uses) */
export const personName = (login: string | null | undefined): string | null => { const p = personOf(login); return p ? RD.pretty(p) ?? p : null; };
export type Changes24h = { landed: number; failed: number; rolledBack: number; medianToProdMs: number | null };
/** Over the last 24 h of the fixture clock: changes that landed, are failing, were rolled back, and the median merge → production time of those that reached production. */
export function changes24h(state: HomeState, view: 'mine' | 'team'): Changes24h {
	const since = NOW.getTime() - 24 * 3600e3;
	const xs = changes(state).items.filter((i) => (view === 'mine') === i.mine && Date.parse(i.since ?? i.mergedAt) >= since);
	const ms = xs.filter((i) => i.group === 'landed' && !i.rolledBack && i.reach === 'prod').map((i) => Date.parse(i.since ?? i.mergedAt) - Date.parse(i.mergedAt)).filter((x) => x >= 0).sort((a, b) => a - b);
	return { landed: xs.filter((i) => i.group === 'landed' && !i.rolledBack).length, failed: xs.filter((i) => i.group === 'failed' && !i.rolledBack).length, rolledBack: xs.filter((i) => i.rolledBack).length, medianToProdMs: ms.length ? ms[Math.floor(ms.length / 2)] : null };
}
/** data-truth-* for a change row: the linked place's own facts when a rollout row carries it, else the change's. */
export function changeTruth(c: TChange, state: HomeState = 'incident'): Record<string, string> {
	const row = rollouts(state).rows.find((r) => r.href === c.href);
	return row
		? { ...truthAttrs(row), 'data-truth-age': c.since ?? '', 'data-truth-place': c.where }
		: { 'data-truth-state': '', 'data-truth-steps': '', 'data-truth-age': c.since ?? '', 'data-truth-cause': '', 'data-truth-build': '', 'data-truth-place': c.where };
}

/* ═══ environments (defects 5, 6) ═══ */
export type Region = RDRegion & { regionless: false; places: { app: string; href: string; state: EnvState }[] };
export type RegionlessProd = { label: 'production'; regionless: true; apps: number; worst: RDRegion['worst']; failing: number; waiting: number; moving: number; rest: number; href: string; places: { app: string; href: string; state: EnvState }[] };
const SEV: Partial<Record<EnvState, number>> = { failed: 0, 'awaiting-approval': 1, 'held-by-rule': 2, deploying: 3, checking: 4 };
export function environments(state: HomeState) {
	const E = RD.environments(state);
	const R = rollouts(state);
	const prod = R.c.tiers.find((t) => t.key === 'prod');
	const by = new Map<string, { app: string; href: string; state: EnvState }[]>();
	/* AD v2 (a): places the tab shows as approval-gated count as approvals everywhere */
	const gatedHref = new Set(R.rows.filter((r) => r.stillChecking).map((r) => r.href));
	for (const p of prod?.places ?? []) by.set(p.label, [...(by.get(p.label) ?? []), { app: p.app, href: p.href, state: gatedHref.has(p.href) ? ('awaiting-approval' as EnvState) : p.state }]);
	const build = (label: string, ps: { app: string; href: string; state: EnvState }[]) => {
		const worst = [...ps].sort((a, b) => (SEV[a.state] ?? 9) - (SEV[b.state] ?? 9))[0];
		const n = { failing: 0, waiting: 0, moving: 0, rest: 0 };
		for (const p of ps) { if (p.state === 'failed') n.failing++; else if (p.state === 'awaiting-approval' || p.state === 'held-by-rule') n.waiting++; else if (p.state === 'deploying' || p.state === 'checking') n.moving++; else n.rest++; }
		return { label, apps: ps.length, ...n, worst: (n.failing ? 'failed' : n.waiting ? 'waiting' : n.moving ? 'deploying' : 'rest') as RDRegion['worst'], href: worst.href, places: ps };
	};
	const regions: Region[] = [...by.entries()].filter(([l]) => siteKey(l) !== 'default').map(([l, ps]) => ({ ...build(l, ps), regionless: false as const }))
		.sort((a, b) => b.failing - a.failing || b.waiting - a.waiting || b.apps - a.apps || a.label.localeCompare(b.label));
	const rlAll = [...by.entries()].filter(([l]) => siteKey(l) === 'default').flatMap(([, ps]) => ps);
	const rl = rlAll.length ? rlAll : undefined;
	const regionless: RegionlessProd | null = rl ? { ...build('production', rl), label: 'production', regionless: true } : null;
	/* AD k: one unit per tier. apps = distinct apps; places = environments across apps (a place is one app in one environment/region);
	   failing/moving/waiting/rest are counted in PLACES and sum to `places`. `regions` = distinct production regions (prod only). */
	const tiers = E.tiers.map((t) => {
		const flip = R.rows.filter((r) => r.stillChecking && r.tier === t.key).reduce((n, r) => n + r.regions.length, 0);
		const moving = t.moving - flip, waiting = t.waiting + flip;
		return {
		...t, moving, waiting, rows: R.rows.filter((r) => r.tier === t.key), unit: 'places' as const,
		counts: { apps: t.apps, places: t.places, regions: t.key === 'prod' ? regions.length + (regionless ? 1 : 0) : null, failing: t.failing, moving, waiting, rest: t.places - t.failing - moving - waiting },
		regions: t.key === 'prod' ? regions.length + (regionless ? 1 : 0) : null
		};
	});
	return { R, tiers, regions, regionless };
}
export type Environments = ReturnType<typeof environments>;

/* ═══ apps ═══ */
/** AD h: a build id is cut to 7 only when it is a git SHA (8-40 hex); tags like "4.42.0-42" are never truncated. */
export const shortBuild = (v: string | null | undefined): string | null => (!v ? null : /^[0-9a-f]{8,40}$/.test(v) ? v.slice(0, 7) : v);
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-(\d+))?$/;
const semverCmp = (a: string, b: string): number => { const x = SEMVER.exec(a)!, y = SEMVER.exec(b)!; for (let k = 1; k <= 4; k++) { const d = +(x[k] ?? 0) - +(y[k] ?? 0); if (d) return d; } return 0; };
/** the failing build is reported separately from the newest build (AD j) */
/** the app's deployed places with the app-wide newest build marked (newest = highest semver tag, else latest merge, else latest arrival) */
/** additive (r4 /rollouts, At rest rows): an app's deployed places with the newest build; exported for the At rest fold's build and age columns */
export function placesOf(state: HomeState, app: string): (AppPlace & { newest: string | null })[] {
	const envs = (homeModel(state).apps.find((x) => x.app === app)?.envs ?? []).filter((e) => e.state !== 'not-deployed' && e.version);
	const newestEnv = [...envs].sort((p, q) => {
		const pv = shortBuild(p.version)!, qv = shortBuild(q.version)!;
		if (SEMVER.test(pv) && SEMVER.test(qv)) return semverCmp(qv, pv);
		const pc = changeBySha(app, pv)?.mergedAt, qc = changeBySha(app, qv)?.mergedAt;
		if (pc && qc && pc !== qc) return qc.localeCompare(pc);
		return (q.arrivedAt ?? '').localeCompare(p.arrivedAt ?? '');
	})[0];
	const newest = newestEnv ? shortBuild(newestEnv.version) : null;
	return envs.map((e) => ({ env: e.env, label: e.label, tier: tierOfEnv(e), state: e.state, href: e.href, version: shortBuild(e.version), onNewest: shortBuild(e.version) === newest && e.state !== 'failed', onBuild: shortBuild(e.version) === newest, newest }));
}
export type AppFailing = { build: string | null; place: string; href: string; line: string };
export type AppPlace = { env: string; label: string; tier: TierKey; state: EnvState; href: string; version: string | null; onNewest: boolean; /** runs the newest BUILD whatever its health (the Gates tab's count) */ onBuild: boolean };
export type TApp = Omit<AppItem, 'newest' | 'onNewest' | 'fact'> & {
	row: TRow | null;
	/** AD g/h: the newest build the app has ANYWHERE (not the most common one), never truncated unless a SHA */
	newest: string | null;
	/** places running `newest`, of `places` deployed places (same unit: places) */
	onNewest: number;
	/** the outcome line; a held app names its blocker ("Waits on payments-svc in staging") (AD i) */
	fact: string;
	blocker: string | null;
	/** places that deployed but failed: the app page's "2 of 3 on the newest · 1 failed" suffix. onNewest never includes them. */
	failedCount: number;
	/** the app's worst region: how many releases behind the newest, and where */
	behind: { n: number; place: string } | null;
	/** the rollout tab of the place the outcome line names */
	outcomeHref: string;
	failing: AppFailing | null;
	/** the picked place waits for an approval: structured, so pages never match the fact's text */
	approval: boolean;
	/** every hold the app has, each as a sentence ("Waits on payments-svc in 2 prod regions", "Pinned to 4.40.0-40 in af-south-1"); `outcome` = fact + holds */
	holds: string[];
	outcome: string;
	placeList: AppPlace[];
	/** production regions of the app and how many run the newest build (the tab's "prod 0/5") */
	prod: { regions: number; onNewest: number };
};
/** the place an app's outcome names: failing, then needs-you, then moving, then held; production first among equals, newest since first */
function pickPlace(rows: TRow[]): TRow | null {
	/* r39 coordinator (a): the headline is the MOST SEVERE state (state-words `severity`: failing, waiting for approval, held, checking, deploying); within one state the viewer's own action first */
	const c = (r: TRow) => severity(r.state) * 2 + (r.needsYou ? 0 : 1);
	return [...rows].sort((p, q) => c(p) - c(q) || Number(q.tier === 'prod') - Number(p.tier === 'prod') || (q.since ?? '').localeCompare(p.since ?? ''))[0] ?? null;
}
/** one outcome grammar for a change and an app (roster-data's, kept verbatim) */
const outcomeOf = (w: TRow): string =>
	w.group === 'failed' ? `Failing in ${w.where}` : w.state === 'awaiting-approval' ? `${sharedWord('approval')} in ${w.where}`
	: w.group === 'moving' ? `${w.word} ${w.state === 'deploying' ? 'to' : 'in'} ${w.where}`
	: `${w.word.startsWith('Waits on') ? w.word : 'Held'} in ${w.where}`;
/** QA #23: the place's release stream, oldest first, as the builds are named everywhere (`status.availableReleases`). A build in it is a RELEASE of the app, whatever place runs it today. */
export function streamBuilds(href: string): string[] {
	const rel = (rawOf(href)?.status as { availableReleases?: { tag?: string; version?: string; revision?: string }[] } | undefined)?.availableReleases ?? [];
	return rel.map((r) => shortBuild(r.version ?? r.tag ?? r.revision) ?? '').filter(Boolean);
}
/** the published pretty name of a gate on the rollout at `href` (cluster + namespace scoped), or null until its detail was fetched */
const prettyOfGate = (href: string, gate: string): string | null => { const h = hrefParts(href); return h ? gatePrettyOf(h.cluster, h.ns, gate) : null; };
/** QA #12 — THE ONE "how many builds behind" of a place, for every surface (Apps tile, app strip + ledger, Environments, Runs-in, the tab's header):
 *  the length of the tab's "Newer builds" list (`status.releaseCandidates`); only a rollout that carries no such list falls back to its position in `availableReleases`. */
export { behindOfStatus };
/** how many releases a place is behind (the tab's "N behind"); null when its build is not in the release list */
function behindCount(href: string, version: string | null): number | null {
	const st = rawOf(href)?.status as { releaseCandidates?: unknown[]; currentVersion?: string; availableReleases?: { tag?: string; version?: string; revision?: string }[] } | undefined;
	const rel = st?.availableReleases ?? [];
	const idx = rel.findIndex((r) => [r.tag, r.version, r.revision?.slice(0, 7)].some((x) => x && shortBuild(x) === version));
	return idx < 0 ? null : behindOfStatus(st);
}
export type RunsIn = { label: string; tier: TierKey; build: string | null; word: string; href: string; state: EnvState };
/** The Gates tab's Runs-in rows for an app: one per deployed place in the tab's order, with the build as the tab prints it and its word ("on the newest" / "N behind" / "failing"). */
export function runsIn(app: string, state: HomeState = 'incident'): RunsIn[] {
	return placesOf(state, app).map((p) => {
		const behind = behindCount(p.href, p.version);
		return { label: placeLabel({ tier: p.tier, regions: [p.label] }), tier: p.tier, build: p.version, href: p.href, state: p.state, word: p.state === 'failed' ? 'failing' : p.onNewest ? 'on the newest' : behind != null ? `${behind} behind` : 'behind' };
	});
}

export function apps(state: HomeState) {
	const A = RD.apps(state);
	const R = rollouts(state);
	const m = homeModel(state);
	const causes = heldCauses(state);
	const items = A.items.map((a): TApp => {
		const rows = R.rows.filter((r) => r.app === a.app);
		const w = pickPlace(rows);
		const envs = (m.apps.find((x) => x.app === a.app)?.envs ?? []).filter((e) => e.state !== 'not-deployed' && e.version);
		/* newest = the highest build among all places: semver tags by number, else the build merged latest, else the latest arrival */
		const newestEnv = [...envs].sort((p, q) => {
			const pv = shortBuild(p.version)!, qv = shortBuild(q.version)!;
			if (SEMVER.test(pv) && SEMVER.test(qv)) return semverCmp(qv, pv);
			const pc = changeBySha(a.app, pv)?.mergedAt, qc = changeBySha(a.app, qv)?.mergedAt;
			if (pc && qc && pc !== qc) return qc.localeCompare(pc);
			return (q.arrivedAt ?? '').localeCompare(p.arrivedAt ?? '');
		})[0];
		const newest = newestEnv ? shortBuild(newestEnv.version) : a.newest;
		const placeList: AppPlace[] = envs.map((e) => ({ env: e.env, label: e.label, tier: tierOfEnv(e), state: e.state, href: e.href, version: shortBuild(e.version), onNewest: shortBuild(e.version) === newest && e.state !== 'failed', onBuild: shortBuild(e.version) === newest }));
		const onNewest = placeList.filter((p) => p.onNewest).length;
		const prodPl = placeList.filter((p) => p.tier === 'prod');
		/* the outcome is recomputed from OUR pick (production first among equals) so the text and its link name the same place */
		let fact = w ? outcomeOf(w) : a.fact, blocker: string | null = null;
		let promoteHref: string | null = null;
		const behindOf = (p: AppPlace) => behindCount(p.href, p.version);
		if (!w) {
			/* a quiet app with a place behind the newest: the app page's "Ready to promote · prod 1 behind" */
			const order: TierKey[] = ['dev', 'test', 'staging', 'prod'];
			const lag = order.map((t) => ({ t, ps: placeList.filter((p) => p.tier === t && !p.onNewest && p.state !== 'failed') })).find((x) => x.ps.length);
			if (lag) { const n = Math.max(...lag.ps.map((p) => behindOf(p) ?? 1)); fact = `Ready to promote to ${lag.t} · ${n} behind`; promoteHref = lag.ps[0].href; }
		}
		if (w && (w.state === 'held-by-rule' || w.state === 'awaiting-approval') && w.group !== 'failed') {
			const hc = causes.find((c) => c.rows.some((r) => r.href === w.href));
			blocker = hc ? (w.state === 'awaiting-approval' ? sharedWord('approval')! : hc.cause.replace(/^Waiting/, 'Waits')) : w.state === 'awaiting-approval' ? sharedWord('approval')! : null;
			if (blocker) fact = `${blocker} in ${w.place}`;
		}
		const fr = rows.find((r) => r.group === 'failed');
		const failing: AppFailing | null = fr ? { build: shortBuild(fr.version) ?? buildOf(fr), place: fr.place, href: fr.href, line: fr.failure?.line ?? 'Failing' } : null;
		const holds: string[] = [];
		for (const hc of causes) {
			const mine = hc.rows.filter((r) => r.app === a.app);
			if (!mine.length) continue;
			const where = mine.length > 1 ? `${mine.length} places` : mine[0].place;
			holds.push(`${hc.cause === sharedWord('approval') ? hc.cause : hc.cause.replace(/^Waiting/, 'Waits')} in ${where}`);
		}
		for (const e of m.apps.find((x) => x.app === a.app)?.envs ?? []) {
			const pin = rawOf(e.href)?.spec?.wantedVersion;
			if (pin && e.state !== 'not-deployed') holds.push(`Pinned to ${shortBuild(e.version) ?? pin} in ${placeLabel({ tier: tierOfEnv(e), regions: [e.label] })}`);
		}
		const outcome = [fact, ...holds.filter((h) => !fact.includes(h))].join(' · ');
		return Object.assign(a, { approval: !!w && w.state === 'awaiting-approval' && w.group !== 'failed', behind: (() => { let best: { n: number; place: string } | null = null; for (const p of placeList) { const n = behindCount(p.href, p.version) ?? 0; if (n > (best?.n ?? 0)) best = { n, place: placeLabel({ tier: p.tier, regions: [p.label] }) }; } return best; })(), row: w, outcomeHref: w?.href ?? promoteHref ?? placeList[0]?.href ?? a.href, failedCount: placeList.filter((p) => p.state === 'failed').length, holds, outcome, newest, onNewest, fact, blocker, failing, placeList, prod: { regions: prodPl.length, onNewest: prodPl.filter((p) => p.onNewest).length } }) as unknown as TApp;
	});
	const L = lead(state);
	for (const it of items) it.lead = !!L && it.row?.href === L.href;
	const groups = A.groups as unknown as { key: AppItem['group']; rows: TApp[] }[];
	for (const g of groups) if (g.key === 'needs') g.rows.sort((p, q) => urgency(p.row, q.row) || p.app.localeCompare(q.app));
	return { R, items, groups, lead: items.find((i) => i.lead) ?? null };
}

/* ═══ fleet24h: the History tab's Summary trio, fleet-wide ═══ */
export type Fleet24h = { deploys: number; failed: number; rolledBack: number; medianToHealthyMs: number | null };
export type Fleet24hEvent = { kind: 'deploy' | 'failed' | 'rolledBack'; app: string; place: string; tier: TierKey; build: string; at: string; href: string; who: string; /** who triggered it: the user's name, or "Automatic" for the system */ trigger: string; viewerTriggered: boolean; /** the person-typed reason recorded with the deploy, or null (QA #14) */ reason: string | null; /** 'manual' | null: see deployMark (QA2 #14: a force deploy is a manual deploy) */ mark: 'manual' | null };
const fleetEvents = (state: HomeState, tier?: TierKey): { ev: Fleet24hEvent; ms: number | null }[] => {
	const since = NOW.getTime() - 24 * 3600e3;
	const out: { ev: Fleet24hEvent; ms: number | null }[] = [];
	for (const a of homeModel(state).apps) for (const e of a.envs) {
		if (e.state === 'not-deployed' || (tier && tierOfEnv(e) !== tier)) continue;
		const raw = rawOf(e.href);
		if (!raw) continue;
		const acts = deployActs(raw as never);
		(raw.status.history ?? []).forEach((h, i) => {
			const t = Date.parse(h.timestamp);
			if (t < since || t > NOW.getTime()) return;
			/* r4 AD envs-2 (calm truth): a place the scenario shows healthy runs its CURRENT build whatever that entry's raw bake says (the reachByAncestry rule), so its newest entry is a deploy here too — one state everywhere */
			const masked = i === 0 && h.bakeStatus === 'Failed' && e.state !== 'failed';
			const kind: Fleet24hEvent['kind'] = acts[i]?.kind === 'rollback' ? 'rolledBack' : h.bakeStatus === 'Failed' && !masked ? 'failed' : 'deploy';
			out.push({ ev: { kind, app: a.app, place: placeLabel({ tier: tierOfEnv(e), regions: [e.label] }), tier: tierOfEnv(e), build: shortBuild(h.version.version ?? h.version.tag ?? h.version.revision) ?? '', at: h.timestamp, href: e.href, who: h.triggeredBy?.kind === 'User' && h.triggeredBy.name ? RD.pretty(h.triggeredBy.name) ?? 'Automatic' : 'Automatic', trigger: h.triggeredBy?.kind === 'User' && h.triggeredBy.name ? h.triggeredBy.name : 'Automatic', viewerTriggered: h.triggeredBy?.kind === 'User' && isViewer(h.triggeredBy.name), reason: deployReason(h.message), mark: deployMark({ actorKind: h.triggeredBy?.kind === 'User' && h.triggeredBy.name ? 'person' : 'controller' }) }, ms: kind === 'deploy' && h.bakeEndTime ? Date.parse(h.bakeEndTime) - t : null });
		});
	}
	return out.sort((x, y) => y.ev.at.localeCompare(x.ev.at));
};
/** Every deploy of the last 24 h, classed once: a rollback, a failure, or a plain deploy. `fleet24h` counts exactly these, so a page that lists them accounts for its figures. */
export const fleet24hEvents = (state: HomeState, tier?: TierKey): Fleet24hEvent[] => fleetEvents(state, tier).map((x) => x.ev);
/** Deploys, failed deploys and rollbacks in the last 24 h of the fixture clock across every place (or one tier's); a deploy that is a rollback is counted as a rollback only, and `deploys` is the sum of all three. */
export function fleet24h(state: HomeState, tier?: TierKey): Fleet24h {
	const xs = fleetEvents(state, tier);
	const ms = xs.map((x) => x.ms).filter((x): x is number => x != null).sort((p, q) => p - q);
	return { deploys: xs.length, failed: xs.filter((x) => x.ev.kind === 'failed').length, rolledBack: xs.filter((x) => x.ev.kind === 'rolledBack').length, medianToHealthyMs: ms.length ? ms[Math.floor(ms.length / 2)] : null };
}

/* ═══ per-place build facts (AD v2 f, g, h, i) ═══ */
/** The WAITING build of a gated place (newest candidate): its own id, title, author and age, never the deployed build's. null when nothing waits. */
export function waitingBuild(row: Pick<RolloutRow, 'app' | 'href'>): { build: string; title: string | null; author: string | null; since: string | null; count: number } | null {
	const all = candidateBuilds(row);
	/* r5 R3: the build the place's OWN gate holds (the Gates tab's "Held builds · HELD HERE"), not the newest candidate that merely waits for a promotion step */
	const here = all.some((x) => x.here) ? all.filter((x) => x.here) : all;
	/* ONE approval = ONE change: of the builds the gate holds, the one that got furthest through the tiers below (it is what an approval is for), not a newer build that is still behind it */
	const ps = placesOf('incident', row.app), me = ps.find((p) => p.href === row.href);
	const reach = (b: string): number => (me ? Math.max(-1, ...ps.filter((p) => RANK_T[p.tier] < RANK_T[me.tier] && shortBuild(p.version) === b).map((p) => RANK_T[p.tier])) : -1);
	const h = [...here].sort((x, y) => reach(y.build) - reach(x.build));
	return h[0] ? { build: h[0].build, title: h[0].title, author: h[0].author, since: h[0].created, count: h.length } : null;
}
/** r6 T6: when the build that waits at a gated place ARRIVED AT ITS GATE: the later of the build's creation and the moment the app's lower tiers deployed it (a promotion gate lets a build
 *  through only once the tier below runs it). null when no age can be told: the build waits for a promotion step that has not happened, or nothing waits.
 *  The build's own age (`waitingBuild().since`, the tab's Newer-builds age) is NOT the hold's age: 4.43.0-43 was created 10h ago and reached staging 1h ago. */
export function holdSince(row: Pick<RolloutRow, 'app' | 'href' | 'tier'>, state: HomeState = 'incident'): string | null {
	const wb = waitingBuild(row);
	if (!wb) return null;
	/* QA round 2 A6: the hold began when the OLDEST still-held build reached its gate, never when the newest arrived: a new build landing under an
	   unanswered approval must not reset "waiting for 2h" to "3m". */
	const all = candidateBuilds(row);
	const here = all.some((x) => x.here) ? all.filter((x) => x.here) : all;
	const lower = placesOf(state, row.app).filter((p) => RANK_T[p.tier] < RANK_T[row.tier as TierKey]);
	const arrivalOf = (b: { build: string; created: string | null }): string | null => {
		if (!lower.length) return b.created;
		const ts: string[] = [];
		for (const p of lower) for (const h of rawOf(p.href)?.status.history ?? []) if (shortBuild(h.version.version ?? h.version.tag ?? h.version.revision) === b.build) ts.push(h.timestamp);
		if (!ts.length) return null;
		const arrived = ts.sort()[0];
		return b.created && b.created > arrived ? b.created : arrived;
	};
	const arrivals = here.map(arrivalOf).filter((x): x is string => !!x).sort();
	return arrivals[0] ?? null;
}
/** QA2 #8: THE ONE CLOCK OF A WAIT. A row that waits (approval / rule) has one time for the fact "how long": when the hold began (`holdSince`), else the waiting
 *  build's own age, else the row's. The sentence ("Waiting for approval for 5h"), the row's age slot and the /apps card's age all read THIS, so one row never shows
 *  two disagreeing unlabelled clocks (the build's own age stays on the Newer-builds list, where it is labelled). */
export function waitClock(row: Pick<RolloutRow, 'app' | 'href' | 'tier'> & { since?: string | null }, state: HomeState = 'incident'): string | null {
	return holdSince(row, state) ?? waitingBuild(row)?.since ?? row.since ?? null;
}
/** The DEPLOYED build of a place with its own commit: the change title the History headline prints (fixture change by sha, else the range head) and the range head's author. */
export function deployedBuild(row: Pick<RolloutRow, 'app' | 'href' | 'version'>): { build: string; meta: string | null; title: string | null; author: string | null; at: string | null } {
	const r = buildRange(row);
	const sha = rawOf(row.href)?.status.history?.[0]?.version.revision?.slice(0, 7) ?? '';
	return { build: buildTitle(row), meta: buildMeta(row), title: titleOfBuild(row.href, sha, null) ?? buildIdentity(sha, row.href)?.title ?? changeBySha(row.app, sha)?.title ?? (r?.title && !/^Release commit for build /.test(r.title) ? r.title : null), author: r?.author ?? null, at: rawOf(row.href)?.status.history?.[0]?.timestamp ?? null };
}
/** "7 newer builds · held: waiting for health checks": the newest-build line of the tab header. null when the place is on the newest. */
export function newestBuild(row: Pick<RolloutRow, 'app' | 'href' | 'state' | 'word'>): { count: number; sentence: string; newest: string | null } | null {
	const st = rawOf(row.href)?.status as { availableReleases?: { tag?: string; version?: string }[] } | undefined;
	const cur = rawOf(row.href)?.status.currentVersion;
	const rel = st?.availableReleases ?? [];
	const count = behindOfStatus(rawOf(row.href)?.status as never);
	if (!count) return null;
	const why = row.state === 'awaiting-approval' ? 'waiting for approval' : row.state === 'held-by-rule' ? row.word.replace(/^Waits on /, 'waiting on ') : row.state === 'failed' ? 'waiting for health checks' : null;
	const nw = rel[rel.length - 1];
	/* round 3: the held phrase counts what the hold refuses HERE (held.ts), and names the rest ("2 waiting for staging"), so "Newer builds" and the banner never disagree */
	const hh = why ? heldHere(row.href) : null;
	const split = hh && hh.waiting > 0 ? `${hh.count} held: ${why}, ${hh.waiting} waiting for ${hh.stage ?? 'an earlier stage'}` : why ? `held: ${why}` : '';
	return { count, sentence: `${count} newer build${count === 1 ? '' : 's'}${split ? ` · ${split}` : ''}`, newest: nw ? shortBuild(nw.version ?? nw.tag) : null };
}
/** The pill word for a place in the ROW's vocabulary (never "DEPLOYED" on a build held in prod). `tabPill` keeps the rollout tab's own pill. */
export const stateWord = (row: Pick<RolloutRow, 'state'>): string =>
	({ failed: 'FAILED', deploying: 'DEPLOYING', checking: 'CHECKING', 'awaiting-approval': 'WAITING', 'held-by-rule': 'HELD', healthy: 'DEPLOYED' } as Record<string, string>)[row.state] ?? 'DEPLOYED';
export type RegionState = { label: string; state: EnvState; ink: 'failed' | 'waiting' | 'moving' | 'healthy'; href: string; build: string | null; onNewest: boolean };
/** Every production region of an app in the tab's order with its own state ink, as the Overview's "prod 0/3" strip encodes it (invoice-api: eu-west red, us-east and us-west orange).
 *  ink: failed = red, waiting = orange (approval or rule hold, including a checking place the tab shows as gated), moving = deploying/checking, healthy otherwise. */
export function regionStates(app: string, state: HomeState = 'incident'): RegionState[] {
	const gated = new Set(rollouts(state).rows.filter((r) => r.state === 'awaiting-approval' || r.state === 'held-by-rule').map((r) => r.href));
	return placesOf(state, app).filter((p) => p.tier === 'prod').map((p) => {
		const st: EnvState = gated.has(p.href) && p.state !== 'failed' ? 'awaiting-approval' : p.state;
		return { label: p.label, state: st, ink: st === 'failed' ? 'failed' : st === 'awaiting-approval' || st === 'held-by-rule' ? 'waiting' : st === 'deploying' || st === 'checking' ? 'moving' : 'healthy', href: p.href, build: p.version, onNewest: p.onBuild };
	});
}
/** An app's production regions split by cause (invoice-api: eu-west failed, us-east/us-west waiting for approval): [{state, cause, labels}] in severity order. */
export function placeCauses(app: string, state: HomeState = 'incident'): { state: EnvState; cause: string; labels: string[] }[] {
	const R = rollouts(state);
	const hc = heldCauses(state);
	const out = new Map<string, { state: EnvState; cause: string; labels: string[] }>();
	for (const r of R.rows.filter((x) => x.app === app && x.tier === 'prod')) {
		const cause = r.state === 'failed' ? (r.failure?.line ?? 'Failing') : hc.find((c) => c.rows.some((x) => x.href === r.href))?.cause ?? r.word;
		const k = `${r.state}|${cause}`;
		const e = out.get(k) ?? { state: r.state, cause, labels: [] };
		e.labels.push(...r.regions);
		out.set(k, e);
	}
	return [...out.values()];
}
/** ONE counting vocabulary. Everything is available in both units; recommended wording is PLACES for every count of holds/approvals ("6 places held", "8 places waiting for approval"),
 *  and "N rollouts" only for rows that fold several regions of one app ("5 rollouts held"). */
export function fleetCounts(state: HomeState) {
	const R = rollouts(state);
	const causes = heldCauses(state);
	const places = (rows: TRow[]) => rows.reduce((n, r) => n + r.regions.length, 0);
	const appr = R.rows.filter((r) => r.group === 'approval'), held = R.rows.filter((r) => r.group === 'held'), fail = R.rows.filter((r) => r.group === 'failed');
	return {
		places: { approval: places(appr), held: places(held), waiting: places(appr) + places(held), failing: places(fail), moving: places(R.rows.filter((r) => r.group === 'moving')) },
		rollouts: { approval: appr.length, held: held.length, waiting: appr.length + held.length, failing: fail.length },
		apps: { approval: new Set(appr.map((r) => r.app)).size, held: new Set(held.map((r) => r.app)).size, waiting: new Set([...appr, ...held].map((r) => r.app)).size },
		/* every approval wait in one place: the sum of its rows' regions is `places.approval` (checkout-edge 1 + telemetry-indexer 1 + payments-core 5 + invoice-api 2 = 9) */
		/* ONE hold unit: places held, and how many distinct causes they share */
		holds: { places: places(appr) + places(held), causes: causes.length, sentence: `${places(appr) + places(held)} places held · ${causes.length} cause${causes.length === 1 ? '' : 's'}` },
		approvals: appr.map((r) => ({ app: r.app, places: r.regions.length, place: r.place, href: r.href, yours: r.needsYou })),
		causes: causes.length,
		wording: { places: 'places', rollouts: 'rollouts', recommended: 'places' as const }
	};
}

/* ═══ gates, held builds, cleared (Needs you) ═══ */
/** The gate that holds the row's candidate, named as the Gates tab prints it, with its release sentence. null for a row nothing holds. */
export function gateName(row: Pick<RolloutRow, 'state' | 'href' | 'word' | 'key'>, state: HomeState = 'incident'): { name: string; sentence: string } | null {
	if (row.state !== 'awaiting-approval' && row.state !== 'held-by-rule') return null;
	const st = rawOf(row.href)?.status;
	const cand = st?.releaseCandidates?.[0]?.tag ?? st?.releaseCandidates?.[0]?.version;
	const gs = st?.gates ?? [];
	const holding = gs.filter((g) => g.allowedVersions != null && !!cand && !g.allowedVersions.includes(cand));
	if (!holding.length) holding.push(...gs.filter((g) => g.passing === false));
	const g = (row.state === 'awaiting-approval' ? holding.find((x) => /approval/.test(x.name)) : null) ?? holding[0];
	if (!g) return null;
	/* a dependency gate is titled by the provider the Gates tab names ("payments-svc"), not by the gate's slug */
	if (/^dependency-/.test(g.name)) {
		const ny = homeModel(state).fleet.needsYou;
		/* a place without its own entry is gated by the same provider as the app's other dependency holds */
		const provider = ny.find((n) => `${n.app}@${n.env}` === row.key)?.facts?.provider ?? ny.find((n) => n.app === row.key.split('@')[0] && n.facts?.provider)?.facts?.provider;
		if (provider) return { name: provider, sentence: `Releases when ${provider} ships a newer version` };
	}
	const sentence = row.state === 'awaiting-approval' ? 'Releases when someone approves'
		: /^dependency-/.test(g.name) || /^Waits on [a-z]/.test(row.word) ? 'Releases when its dependency ships a newer version'
		: /schedule|window|freeze/.test(g.name) ? 'Releases when the deploy window opens'
		: /check|health|test/.test(g.name) || homeModel(state).fleet.needsYou.find((n) => `${n.app}@${n.env}` === row.key)?.facts?.reason === 'check' ? 'Releases when the check starts passing' : 'Releases when the rule allows this build';
	return { name: gateDisplayName(g.name, prettyOfGate(row.href, g.name)), sentence };
}
/* ═══ ONE commit identity per build (AD v2 m) ═══ */
/**
 * WHO / WHAT RULE (r34 truth, settled): two subjects, two sources, never mixed.
 *  - a BUILD is the subject (Apps lead header, Slipway, Environments' arriving build, Newer builds, held builds): r5 R4 (lead ruling) TITLE and PERSON come from the tabs but
 *    from their two named panes: the TITLE is the History tab's HEADLINE, the single-sha commit lookup (`commitHeadline`: a11c202 -> "Retry webhook delivery with exponential
 *    backoff", never the range's boilerplate "Release commit for build a11c202"; used by `deployedBuild.title`, `heldBuilds.title`, `waitingBuild.title`); the PERSON is the
 *    head commit's author in the range "previous release -> this build" the CHANGE pane prints (`buildRange`, `heldBuilds`, `waitingBuild`, `newestBuild`,
 *    `deployedBuild.author`: a11c202 -> mark-collins), because the headline's trigger is "Automatic" for every automatic deploy. When the person is the viewer the page
 *    prints "Your change" instead of a face. A build with no real title shows no title (the build id is already on the row).
 *  - a CHANGE is the subject (Changes rows/Folio, Needs you cards, "Yours"): the PR identity (`buildIdentity`, `changes()[].author/title`), e.g. a11c202 -> the viewer's #37.
 *  - a build is NAMED as the tab names it (`buildTitle`/`buildName`: "4.42.0-42"), SHAs only as meta.
 */
export type BuildIdentity = { pr: number | null; title: string; author: string | null; href: string | null; repo: string };
const identityIndex = new WeakMap<object, Map<string, BuildIdentity>>();
function identities(): Map<string, BuildIdentity> {
	const src = source();
	const hit = identityIndex.get(src);
	if (hit) return hit;
	const m = new Map<string, BuildIdentity>();
	/* the changes list the page reads is the one source: the PR pages and tabs print the same records */
	for (const c of chgList()) m.set(c.mergeCommitSha.slice(0, 7), { pr: c.kind === 'pr' ? c.number ?? null : null, title: c.title, author: c.author ?? null, href: c.htmlUrl ?? null, repo: c.repo });
	if (!isLive()) {
		/* unit tests: the demo GitHub universe also names builds the pinned fixture does not */
		try {
			const j = JSON.parse(respondGithub('GET', '/api/github/changes', new URLSearchParams({ days: '365' }))?.body ?? '{}');
			for (const c of (j.changes ?? []) as { repo: string; kind?: string; number?: number; title: string; author: string; htmlUrl: string; mergeCommitSha: string }[])
				m.set(c.mergeCommitSha.slice(0, 7), { pr: c.kind === 'pr' ? c.number ?? null : null, title: c.title, author: c.author, href: c.htmlUrl, repo: c.repo });
		} catch { /* fixture identities stand */ }
	}
	identityIndex.set(src, m);
	return m;
}
/** The one title/author/PR for a build, from the mock's /api/github/changes (what the PR pages print), the fixture where the mock has nothing. `build` is a SHA (any length) or, with `href`, a tag/version of that rollout. null when neither knows it. */
export function buildIdentity(build: string | null | undefined, href?: string): BuildIdentity | null {
	if (!build) return null;
	let sha = /^[0-9a-f]{7,40}$/.test(build) ? build.slice(0, 7) : null;
	if (!sha && href) { const r = (rawOf(href)?.status.availableReleases ?? []).find((x) => x.tag === build || x.version === build); sha = r?.revision?.slice(0, 7) ?? null; }
	return sha ? identities().get(sha) ?? null : null;
}

/** The Overview/History range for a build: the tabs ask the mock for (the release listed just before it → the build), both as FULL revisions from the rollout's release list.
 *  Author, diffstat and commit list depend on exactly that pair, so every helper below goes through here. */
function tabRange(href: string, tag: string): { title: string; author: string | null; additions: number; deletions: number; files: number; commits: { sha: string; title: string; author: string | null }[] } | null {
	const h = hrefParts(href);
	const rel = rawOf(href)?.status.availableReleases ?? [];
	const i = rel.findIndex((r) => r.tag === tag || r.version === tag);
	if (!h || i < 0) return null;
	const head = rel[i].revision ?? rel[i].tag ?? tag;
	const base = i > 0 ? rel[i - 1].revision ?? rel[i - 1].tag ?? '' : '';
	try {
		const j = githubJson<{ commits?: { sha: string; message: string; author?: string }[]; additions?: number; deletions?: number; changedFiles?: number }>(rangeUrl(h.ns, h.name, h.cluster), { base, head });
		if (!j) return null;
		const cs = (j.commits ?? []) as { sha: string; message: string; author?: string }[];
		const hc = cs[cs.length - 1];
		if (!hc) return null;
		/* r6 T5: github-data answers a range it cannot resolve with "Release commit for build X" and an invented author; the dev mock re-headlines it from the fixture's change (home-incident.ts), and so does this in-browser read (title AND author from the PR identity) */
		const idn = /^Release commit for build /.test(String(hc.message)) ? buildIdentity(hc.sha, href) : null;
		if (idn) { hc.message = idn.title; hc.author = idn.author ?? hc.author; }
		return { title: String(hc.message).split('\n')[0], author: hc.author ?? null, additions: j.additions ?? 0, deletions: j.deletions ?? 0, files: j.changedFiles ?? 0, commits: cs.map((c) => ({ sha: c.sha.slice(0, 7), title: String(c.message).split('\n')[0], author: c.author ?? null })) };
	} catch { return null; }
}
/** r5 R4: the History tab's HEADLINE for a build: the single-sha commit lookup the tab asks (`GET /api/github/repos/:owner/:repo/commits/:sha`, repo from the rollout's source), i.e. the commit
 *  subject and its author. `build` is the tag, version or short name the tab prints; null when the rollout has no linked GitHub source or the mock does not know the commit. */
export function commitHeadline(href: string, build: string | null | undefined): { title: string; author: string | null } | null {
	if (!build) return null;
	const st = rawOf(href)?.status;
	const src = /^github\.com\/([^/]+)\/(.+)$/.exec(st?.source ?? '');
	if (!src) return null;
	const rel = (st?.availableReleases ?? []).find((x) => x.tag === build || x.version === build || (x.revision ?? '').startsWith(build));
	const sha = rel?.revision ?? (/^[0-9a-f]{7,40}$/.test(build) ? build : null);
	if (!sha) return null;
	try {
		const j = githubJson<{ subject?: string; author?: string }>(`/api/github/repos/${src[1]}/${src[2]}/commits/${sha}`);
		return j?.subject ? { title: j.subject, author: j.author ?? null } : null;
	} catch { return null; }
}
/** r5 R4: the title a build is printed with everywhere on the list pages: the History headline (`commitHeadline`), else the range head's message, never the generic "Release commit for build X"
 *  boilerplate (null then: the build id is already on the row). */
function titleOfBuild(href: string, build: string, rangeTitle: string | null | undefined): string | null {
	/* r6 T5: the PR identity (`buildIdentity`) is the last source, so a held/waiting build prints the title its change has everywhere else (a11c909 "Add idempotency key to invoice creation") */
	const t = commitHeadline(href, build)?.title ?? (rangeTitle && !/^Release commit for build /.test(rangeTitle) ? rangeTitle : null) ?? buildIdentity(build, href)?.title ?? rangeTitle ?? null;
	return t && !/^Release commit for build /.test(t) ? t : null;
}
/** Round 2 B5 — the candidates this place's hold refuses HERE (lane A's ONE `heldBuilds` rule: the Gates tab, the detail banner and these pages print the same count);
 *  those only queued behind an earlier stage are `waiting` and never counted as held. null when the place has no rollout to ask. */
export function heldHere(href: string): { has: (c: { tag?: string; version?: string }) => boolean; count: number; waiting: number; stage: string | null } | null {
	const r = rawOf(href) as never as Rollout | null;
	const key = heldKeyOfHref(href);
	const k = key ? heldHereOf(key) : null;
	if (!r || !k) return null;
	return { count: k.count, waiting: k.waiting, stage: k.stage, has: (c) => k.ids.has(displayVersionForTag(r, c.tag ?? c.version ?? '') || (c.tag ?? c.version ?? '')) };
}
/** The builds the place's gate holds, as the Overview's "Newer builds" lists them: title and author of the candidate's head commit in the range deployed → candidate (the same mock range endpoint the Overview reads).
 *  r5 R3: `here` is true when the build is held AT THIS PLACE by its own gate (every promotion gate of the place lets it through, so it is the gate that refuses it: the Gates tab's "Held builds ... HELD HERE"),
 *  false when it merely waits for a promotion step ("Waits for staging"). r5 R4: `title` is the History headline of the build (see `titleOfBuild`), `author` stays the range head's author (the CHANGE pane). */
/** EVERY release candidate of the place, with its commit title and author (the Overview's "Newer builds" list). `here` is the allow-list reading; the COUNT of builds a hold refuses HERE is `heldHere` (held.ts's `heldBuilds`, the one definition) and `here` follows it once the place's detail has answered. */
export function candidateBuilds(row: Pick<RolloutRow, 'app' | 'href'>): { build: string; title: string | null; author: string | null; created: string | null; here: boolean }[] {
	const st = rawOf(row.href)?.status;
	const promo = (st?.gates ?? []).filter((g) => /^promotion-/.test(g.name) && g.allowedVersions != null);
	const hh = heldHere(row.href);
	return (st?.releaseCandidates ?? []).map((c) => {
		const b = c.tag ?? c.version ?? '';
		const r = tabRange(row.href, b);
		const title = titleOfBuild(row.href, b, r?.title), author: string | null = r?.author ?? null;
		const shown = c.version ?? c.tag ?? b; /* the build as the tab names it ("4.45.0-45"), not the registry tag ("b-45") */
		return { build: shortBuild(shown) ?? shown, title, author, created: c.created ?? null, here: hh ? hh.has({ tag: c.tag, version: c.version }) : promo.every((g) => g.allowedVersions!.includes(b)) };
	});
}
/** The hold, for pages to draw as a mark + text after the pipeline: the gate's own name and release sentence plus the builds it holds. null when nothing holds the row. */
export function gate(row: Pick<RolloutRow, 'state' | 'href' | 'word' | 'key' | 'app'>, state: HomeState = 'incident'): { name: string; sentence: string; held: ReturnType<typeof candidateBuilds>; heldCount: number; heldSentence: string } | null {
	const g = gateName(row, state);
	if (!g) return null;
	const held = candidateBuilds(row);
	return { ...g, held, heldCount: held.length, heldSentence: `${held.length} build${held.length === 1 ? '' : 's'} held` };
}
export type HealthCheckRow = { name: string; state: 'failing' | 'passing' | 'pending'; since: string | null; message: string | null };
type RawHC = { metadata: { name: string; namespace: string }; status?: { status?: string; message?: string; lastChangeTime?: string; lastErrorTime?: string } };
/** The Overview's Health checks card for the place: failing checks of the deployed entry (named as the tab, aged from the bake end), the namespace's HealthCheck resources, then "Flux Deployment" (passing since the deploy). */
export function healthChecks(row: Pick<RolloutRow, 'href'>): HealthCheckRow[] {
	const h = hrefParts(row.href);
	const e = rawOf(row.href)?.status.history?.[0] as (RawEntry & { failedHealthChecks?: { name: string; message?: string }[] }) | undefined;
	if (!h || !e) return [];
	const out: HealthCheckRow[] = (e.failedHealthChecks ?? []).map((f) => ({ name: f.name, state: 'failing' as const, since: e.bakeEndTime ?? e.timestamp, message: f.message ?? null }));
	/* the HealthChecks the API lists for this rollout (the same answer the tab's card reads): named as the tab names them (display-name annotation),
	   Healthy passes, Pending waits, anything else fails */
	for (const c of (source().healthChecks ?? []).flatMap((i) => (i.metadata.namespace === h.ns && i.metadata.name === h.name ? i.healthChecks : [])) as unknown as (RawHC & { metadata: { annotations?: Record<string, string> } })[]) {
		const name = c.metadata.annotations?.['kuberik.com/display-name'] ?? c.metadata.name;
		if (out.some((o) => o.name === name)) continue;
		const st = c.status?.status;
		out.push({ name, state: st === 'Healthy' ? 'passing' : st === 'Pending' ? 'pending' : 'failing', since: c.status?.lastChangeTime ?? null, message: st === 'Healthy' ? null : c.status?.message ?? null });
	}
	if (!out.some((o) => o.name === 'Flux Deployment')) out.push({ name: 'Flux Deployment', state: 'passing', since: e.timestamp, message: null });
	return out;
}
/** The tab's "1 commit deployed · +39 −24 · 3 files" for the build the place runs now (range previous build → this build, the mock endpoint the Overview and History read),
 *  with the commit list and the head commit's title and author. null when the app has no mocked range. */
export function buildRange(row: Pick<RolloutRow, 'href'>): { title: string; author: string | null; additions: number; deletions: number; files: number; commits: { sha: string; title: string; author: string | null }[] } | null {
	const v = rawOf(row.href)?.status.history?.[0]?.version;
	if (!v) return null;
	const r = tabRange(row.href, v.tag ?? v.version ?? v.revision ?? '');
	const idn = buildIdentity(v.revision ?? v.tag, row.href);
	/* AD v2 (n): a BUILD's person is its commit author (the History print); the PR identity supplies only the title. `buildIdentity` is the PR person. */
	void idn;
	return r; /* the TAB's commit message and author */
}
/** the head commit (title + author) of the build the place runs now; same source as `buildRange` */
export function deployedCommit(row: Pick<RolloutRow, 'href'>): { title: string; author: string | null } | null {
	const r = buildRange(row);
	return r ? { title: r.title, author: r.author } : null;
}
/** r5 R1: the LIVE phase of the place's deployed entry as the tab reads it (its bakeStatus), falling back to the row's state: 'deploying' (Deploying) · 'checking' (InProgress bake)
 *  · 'failed' · 'done' (Succeeded). A held/approval row whose own deploy is still baking is 'checking' (checkout-edge production: the tab pill says CHECKING). */
function livePhase(row: Pick<RolloutRow, 'state' | 'href' | 'group'>): 'deploying' | 'checking' | 'failed' | 'done' {
	const bs = rawOf(row.href)?.status.history?.[0]?.bakeStatus;
	if (row.group === 'failed' || bs === 'Failed') return 'failed';
	if (bs === 'Deploying') return 'deploying';
	if (bs === 'InProgress') return 'checking';
	if (!bs) return row.state === 'deploying' ? 'deploying' : row.state === 'checking' ? 'checking' : 'done';
	return 'done';
}
/** r5 R16: the Check timer's clock as the tab prints it ("4m 57s remaining"), rounded UP to whole minutes on a list ("5 min left"; "under 1 min left"): bake start + the rollout's bakeTime
 *  minus the fixture clock. null unless the place's bake is running and has a bake time. */
export function checkClock(row: Pick<RolloutRow, 'state' | 'href' | 'group'>): string | null {
	if (livePhase(row) !== 'checking') return null;
	const raw = rawOf(row.href), e = raw?.status.history?.[0];
	const m = /^(\d+)(s|m|h)$/.exec(raw?.spec?.bakeTime ?? '');
	if (!e?.bakeStartTime || !m) return null;
	const left = Date.parse(e.bakeStartTime) + +m[1] * ({ s: 1e3, m: 60e3, h: 3600e3 } as Record<string, number>)[m[2]] - NOW.getTime();
	if (!(left > 0)) return null;
	const min = Math.ceil(left / 60000);
	return min < 60 ? `${min} min left` : `${Math.floor(min / 60)} h ${min % 60} min left`;
}
/** r5 R1: the Overview's Health-checks header tally for the place ("1 pending · 0 passing", "1 failing · 1 passing"). While the deploy or its bake is live the tab's "Flux Deployment" row is
 *  PENDING ("reconciling"), so it counts as pending, not passing. */
export function healthTally(row: Pick<RolloutRow, 'state' | 'href' | 'group'>): string {
	const live = livePhase(row);
	const rows = healthChecks(row).map((c) => (c.name === 'Flux Deployment' && (live === 'deploying' || live === 'checking') ? 'pending' : c.state));
	const n = (k: string) => rows.filter((x) => x === k).length;
	return n('failing') ? `${n('failing')} failing · ${n('passing')} passing` : n('pending') ? `${n('pending')} pending · ${n('passing')} passing` : `${n('passing')} passing`;
}
/** What the tab prints under the Check node of a failed/active row: the step label, its age, the controller message and the two status words.
 *  r5 R1: the words are the tab's own (DeploymentPipelineCard finalHCStatus / finalBakeTimerStatus): Health checks = Failed (failed) · Waiting (deploying) · Pending (bake running, checks not all healthy)
 *  · Healthy; Check timer = Checking (bake running) · Done · Pending. They follow the entry's bakeStatus, not the row's group. */
export function stepDetail(row: Pick<RolloutRow, 'state' | 'href' | 'since' | 'group'>): { step: string; age: string; message: string | null; healthChecks: string; checkTimer: string } {
	const h = rawOf(row.href)?.status.history?.[0];
	const live = livePhase(row);
	return {
		step: 'Final check', age: ago(row.since ?? h?.timestamp ?? NOW.toISOString()),
		message: h?.bakeStatusMessage ?? null,
		healthChecks: live === 'failed' ? 'Failed' : live === 'deploying' ? 'Waiting' : live === 'checking' ? 'Pending' : 'Healthy',
		checkTimer: live === 'checking' ? 'Checking' : live === 'done' ? 'Done' : 'Pending'
	};
}
/** The tab's state pill (rolloutStateChip on the deployed entry, upper-cased as drawn) and its gate-holding count ("1 gate holding", "1 of 5 gates holding"; null when no gate holds). */
export function tabPill(row: Pick<RolloutRow, 'href'>): { word: string; role: string; holding: string | null } {
	const st = rawOf(row.href)?.status;
	const chip = rolloutStateChip(st?.history?.[0]?.bakeStatus ?? null);
	const cand = st?.releaseCandidates?.[0]?.tag ?? st?.releaseCandidates?.[0]?.version;
	const gs = st?.gates ?? [];
	const n = gs.filter((g) => g.allowedVersions != null && !!cand && !g.allowedVersions.includes(cand)).length;
	return { word: chip.label.toUpperCase(), role: chip.role, holding: n ? (n === gs.length ? `${n} gate${n === 1 ? '' : 's'} holding` : `${n} of ${gs.length} gates holding`) : null };
}
export type Cleared = { kind: 'rollback' | 'recovered' | 'approved'; app: string; place: string; what: string; who: string; at: string; href: string };
/** Things that recently LEFT the inbox, with evidence in the places' own histories: rollbacks performed (deployActs), a failed deploy followed by a
 *  healthy one (recovered), and a person's deploy into a place that has an approval gate (approved). Within the last 24 h of the fixture clock. */
export function cleared(state: HomeState): Cleared[] {
	const out: Cleared[] = [];
	const since = NOW.getTime() - 24 * 3600e3;
	for (const a of homeModel(state).apps) for (const e of a.envs) {
		const raw = rawOf(e.href);
		if (!raw || e.state === 'not-deployed') continue;
		const hist = raw.status.history ?? [];
		const acts = deployActs(raw as never);
		const place = placeLabel({ tier: tierOfEnv(e), regions: [e.label] });
		const who = (h: RawEntry) => (h.triggeredBy?.kind === 'User' && h.triggeredBy.name ? RD.pretty(h.triggeredBy.name) ?? 'Automatic' : 'Automatic');
		hist.forEach((h, i) => {
			const t = Date.parse(h.timestamp);
			if (t < since || t > NOW.getTime()) return;
			const act = acts[i];
			if (act && act.kind === 'rollback') out.push({ kind: 'rollback', app: a.app, place, what: `Rolled back from ${act.from} to ${act.to}`, who: who(h), at: h.timestamp, href: e.href });
			const prev = hist[i + 1];
			if (prev && (prev.bakeStatus ?? '') === 'Failed' && (h.bakeStatus ?? 'Succeeded') === 'Succeeded' && !(act && act.kind === 'rollback'))
				out.push({ kind: 'recovered', app: a.app, place, what: `Recovered after ${(prev.version.revision ?? prev.version.tag ?? '').slice(0, 7)} failed`, who: who(h), at: h.timestamp, href: e.href });
			if (h.triggeredBy?.kind === 'User' && act && act.kind === 'forward' && (raw.status.gates ?? []).some((g) => /approval/.test(g.name)))
				out.push({ kind: 'approved', app: a.app, place, what: `Approved ${act.to}`, who: who(h), at: h.timestamp, href: e.href });
		});
	}
	return out.sort((x, y) => y.at.localeCompare(x.at));
}

/** A build as the tabs name it (the version the rollout lists: "4.42.0-42"), from a SHA or tag of the app. */
export function buildName(app: string, build: string | null | undefined): string | null {
	if (!build) return null;
	for (const r of raws()) if (r.metadata.name === app)
		for (const x of r.status.availableReleases ?? []) if ([x.tag, x.version, x.revision, x.revision?.slice(0, 7)].includes(build) || x.revision?.startsWith(build)) return shortBuild(x.version ?? x.tag) ?? build;
	return shortBuild(build);
}
/** The fleet's newest deploy (any kind): app, place, author, time and the History link of that rollout. */
export function lastDeploy(state: HomeState, tier?: TierKey): { app: string; place: string; who: string; trigger: string; viewerTriggered: boolean; author: string | null; at: string; build: string; kind: Fleet24hEvent['kind']; href: string; historyHref: string } | null {
	const e = fleetEvents(state, tier)[0]?.ev;
	if (!e) return null;
	/* `trigger`/`who` = who started the deploy ("Automatic" for the system; "you" only when viewerTriggered); `author` = the build's commit author, separately */
	return { app: e.app, place: e.place, who: e.who, trigger: e.trigger, viewerTriggered: e.viewerTriggered, author: buildRange({ href: e.href })?.author ?? null, at: e.at, build: e.build, kind: e.kind, href: e.href, historyHref: `${e.href}/history` };
}

/* ═══ per-place holds, gates, approval scope (AD v2 v, w, x, y, z) ═══ */
/** Where a place stands in its tier's rollout order (sites & waves): its wave, whether it leads the wave, and who it follows. `multi` is true only when the tier has more than one wave, i.e. when the wave tells the reader something. */
export type WaveInfo = { site: string; wave: number; leader: boolean; follows: string | null; multi: boolean };
const TOPOLOGY = new WeakMap<object, Map<string, AppTopology>>();
/** The wave facts of the place a rollout href names, off the fixture's Environments (null for an unbound rollout or an unplaced tier). */
export function waveInfoOfHref(href: string): WaveInfo | null {
	const h = hrefParts(href);
	if (!h) return null;
	const src = source(), envs = src.environments as unknown as Environment[];
	const env = envs.find((e) => e.metadata?.namespace === h.ns && e.spec?.rolloutRef?.name === h.name);
	if (!env) return null;
	const topo = (TOPOLOGY.get(src) ?? (TOPOLOGY.set(src, buildTopology(envs)), TOPOLOGY.get(src)!)).get(deployNameOf(env));
	const node = siteNodeOf(topo, env);
	const tier = topo?.tiers.find((t) => t.tier === node?.tier);
	if (!topo || !node || !tier) return null;
	const follows = node.isLeader ? null : (upstreamOf(topo, node)[0]?.site ?? null);
	return { site: node.site, wave: node.wave, leader: node.isLeader, follows, multi: tier.waves.length > 1 };
}
export type PlaceHold = { wave: WaveInfo | null; env: string; label: string; place: string; tier: TierKey; state: EnvState; href: string; deployedBuild: string | null; holdReason: 'approval' | 'rule' | 'health' | 'failed' | null; gate: { name: string; sentence: string } | null; heldBuilds: ReturnType<typeof candidateBuilds>; runs: string | null };
/** Every deployed place of an app (all tiers, test and staging included) with its own deployed build, WHY it holds newer builds, the gate that holds them and the builds held.
 *  invoice-api: eu-west failed (health), us-east and us-west held by the manual-approval gate (allowed a11c404 only). */
export function placeHolds(app: string, state: HomeState = 'incident'): PlaceHold[] {
	return placesOf(state, app).map((p) => {
		const approval = approvalHold(p.href) > 0;
		const held = candidateBuilds({ app, href: p.href });
		const gs = rawOf(p.href)?.status.gates ?? [];
		const cand = rawOf(p.href)?.status.releaseCandidates?.[0]?.tag;
		const rule = !approval && !!cand && gs.some((g) => g.allowedVersions != null && !g.allowedVersions.includes(cand));
		const reason: PlaceHold['holdReason'] = p.state === 'failed' ? 'failed' : approval ? 'approval' : rule ? 'rule' : held.length && p.state !== 'healthy' ? 'health' : null;
		const g = approval || rule ? gateName({ state: approval ? 'awaiting-approval' : 'held-by-rule', href: p.href, word: '', key: `${app}@${p.env}` }, state) : null;
		return { wave: waveInfoOfHref(p.href), env: p.env, label: p.label, place: placeLabel({ tier: p.tier, regions: [p.label] }), tier: p.tier, state: p.state, href: p.href, deployedBuild: buildName(app, p.version), holdReason: reason, gate: g, heldBuilds: held, runs: p.version };
	});
}
/** Where a build already runs (the Builds list's "live in us-east, us-west"): the app's places whose deployed build is `build` (tab name, tag or SHA). */
export function buildPlaces(app: string, build: string, state: HomeState = 'incident'): { place: string; href: string; state: EnvState }[] {
	const want = buildName(app, build) ?? build;
	return placesOf(state, app).filter((p) => buildName(app, p.version) === want).map((p) => ({ place: placeLabel({ tier: p.tier, regions: [p.label] }), href: p.href, state: p.state }));
}
export type GateInfo = { /** identity, unique per gate: the gate's resource name (dependency gates folded). `name` is only a display name and repeats (every generated `ghd-xxxxx` reads "Gate"). */ id: string; name: string; kind: 'approval' | 'dependency' | 'check' | 'schedule' | 'promotion' | 'other'; sentence: string; holding: boolean; places: string[]; held: string[]; releasedBy: string; /** the held-HERE count is not known yet (the place's detail has not answered): print a pending state, never `held.length` */ heldPending: boolean };
/** A detail page's OWN gates, approvals included (the list pages exclude approvals by rule): each gate once, the places it guards, the builds it holds, who/what releases it. */
export function gatesOf(app: string, state: HomeState = 'incident'): GateInfo[] {
	const out = new Map<string, GateInfo>();
	for (const p of placesOf(state, app)) {
		const st = rawOf(p.href)?.status;
		const cands = (st?.releaseCandidates ?? []).map((c) => c.tag ?? c.version ?? '');
		for (const g of st?.gates ?? []) {
			const kind: GateInfo['kind'] = /approval/.test(g.name) ? 'approval' : /^dependency-/.test(g.name) ? 'dependency' : /^promotion-/.test(g.name) ? 'promotion' : /schedule|window|freeze/.test(g.name) ? 'schedule' : /check|health|test|eval/.test(g.name) ? 'check' : 'other';
			if (kind === 'promotion') continue; /* sequencing, not a hold anyone releases */
			const holding = g.allowedVersions != null && cands.length > 0 && cands.every((c) => !g.allowedVersions!.includes(c));
			const k = g.name.replace(/^dependency-.*-needs-/, 'dependency-');
			const e = out.get(k) ?? { id: k, name: gateDisplayName(g.name, prettyOfGate(p.href, g.name)), kind, sentence: '', holding: false, heldPending: false, places: [], held: [], releasedBy: kind === 'approval' ? 'someone approves' : kind === 'dependency' ? 'its provider ships a newer version' : kind === 'schedule' ? 'the window opens' : kind === 'check' ? 'the check passes' : 'the rule allows it' };
			e.places.push(placeLabel({ tier: p.tier, regions: [p.label] }));
			const hh = holding ? heldHere(p.href) : null;
			if (holding && !hh) e.heldPending = true;
			if (holding) { e.holding = true; for (const c of cands) { if (hh && !hh.has({ tag: c })) continue; const n = buildName(app, c) ?? c; if (!e.held.includes(n)) e.held.push(n); } }
			e.sentence = `Releases when ${e.releasedBy}`;
			out.set(k, e);
		}
	}
	return [...out.values()];
}
/** ONE approval-scope rule: the viewer's Approve acts on the place the row links to (the first of a folded row's regions). `sentence` is what the row and the change print;
 *  `others` says what the remaining regions do: "N other regions wait on their own approvals" only when each one's own gate refuses the build, else "N other regions hold this build". */
export function approvalScope(row: Pick<RolloutRow, 'app' | 'tier' | 'regions' | 'href' | 'needsYou' | 'where'>, state: HomeState = 'incident'): { sentence: string; acts: string; n: number; of: number; others: string | null } {
	const of = Math.max(1, row.regions.length);
	const acts = row.regions[0] ?? row.where;
	const actsLabel = row.tier === 'prod' && acts !== 'prod' ? `prod-${acts}` : acts === 'prod' ? 'production' : acts;
	const rest = row.regions.slice(1);
	const own = rest.length > 0 && rest.every((l) => { const pl = placesOf(state, row.app).find((p) => p.label === l && p.tier === 'prod'); return !!pl && approvalHold(pl.href) > 0; });
	const others = rest.length ? (own ? `${rest.length} other regions wait on their own approvals` : `${rest.length} other region${rest.length === 1 ? '' : 's'} hold this build`) : null;
	/* ONE region count for an approval (Facia's waitScope): the prod regions that wait, of the app's prod regions ("5 of 6 regions", "6 regions" when all) */
	const sts = row.tier === 'prod' ? regionStates(row.app, state) : [];
	const k = sts.filter((r) => r.ink === 'waiting').length;
	const scope = sts.length > 1 && k ? (k === sts.length ? `${k} regions` : `${k} of ${sts.length} regions`) : null;
	return { sentence: `${sharedWord('approval', { yours: row.needsYou })} · ${scope ?? actsLabel}`, acts: actsLabel, n: 1, of, others };
}
/* ═══ approving in place (r34 r3-approve) ═══ */
/** What one Approve press releases: the build, the places (a folded prod row = every region whose own gate refuses it), and the tag each rollout is asked to allow.
 *  The wire contract (src/lib/api/approvals.ts): one `POST /api/rollouts/<ns>/<name>/approve {version}` per place. */
export type ApprovalTarget = { key: string; app: string; build: string; where: string; count: number; places: { href: string; label: string; tag: string }[]; href: string };
export function approvalTarget(row: Pick<RolloutRow, 'app' | 'tier' | 'href' | 'regions'>, state: HomeState = 'incident'): ApprovalTarget | null {
	const own = placesOf(state, row.app).filter((p) => p.tier === row.tier && approvalHold(p.href) > 0 && (p.href === row.href || !row.regions.length || row.regions.includes(p.label)));
	const ps = own.length ? own : approvalHold(row.href) > 0 ? placesOf(state, row.app).filter((p) => p.href === row.href) : [];
	if (!ps.length) return null;
	const wb = waitingBuild({ app: row.app, href: ps[0].href });
	const places = ps.map((p) => {
		const cands = rawOf(p.href)?.status.releaseCandidates ?? [];
		const c = cands.find((x) => shortBuild(x.version ?? x.tag ?? '') === wb?.build) ?? cands[0];
		return { href: p.href, label: p.label, tag: c?.tag ?? c?.version ?? '' };
	}).filter((p) => p.tag);
	if (!places.length) return null;
	const where = placeLabel({ tier: row.tier as TierKey, regions: places.map((p) => p.label) });
	return { key: `${row.app}|${row.tier}|${places.map((p) => p.href).sort().join(',')}`, app: row.app, build: wb?.build ?? places[0].tag, where, count: places.length, places, href: row.href };
}
type Snap = { r: RawRollout; status: RawRollout['status'] };
const SNAPS = new Map<string, Snap[]>();
/** Apply an approval to the fixture in place (the optimistic step): each place's approval gate allows its held builds and the named build starts deploying. */
export function grantApproval(t: ApprovalTarget): void {
	const snaps: Snap[] = [];
	for (const p of t.places) {
		const r = hrefParts(p.href) ? raws().find((x) => x.metadata.namespace === hrefParts(p.href)!.ns && x.metadata.name === hrefParts(p.href)!.name) : null;
		if (!r) continue;
		snaps.push({ r, status: structuredClone(r.status) });
		const st = r.status;
		const held = (st.releaseCandidates ?? []).map((c) => c.tag ?? c.version ?? '');
		for (const g of st.gates ?? []) if (/approval/.test(g.name) && g.allowedVersions != null) g.allowedVersions = [...new Set([...g.allowedVersions, ...held])];
		st.releaseCandidates = (st.releaseCandidates ?? []).filter((c) => (c.tag ?? c.version) !== p.tag);
		st.history = [{ version: { tag: p.tag, version: p.tag, revision: p.tag }, timestamp: RD.NOW.toISOString(), bakeStatus: 'Deploying', bakeStartTime: RD.NOW.toISOString(), triggeredBy: { kind: 'User', name: viewerLogin() } }, ...(st.history ?? [])];
	}
	SNAPS.set(t.key, snaps);
	resetHomeModel(); bumpApprovals();
}
/** Undo: restore each place exactly as it was before the approval. */
export function revokeApproval(t: ApprovalTarget): void {
	for (const s of SNAPS.get(t.key) ?? []) s.r.status = s.status;
	SNAPS.delete(t.key);
	resetHomeModel(); bumpApprovals();
}
/** the viewer must never appear as the person on their own change or build */
export const isViewer = (login: string | null | undefined): boolean => !!login && (login.toLowerCase() === viewerLogin().toLowerCase() || (!isLive() && login === 'danielreed'));
export const personOf = (login: string | null | undefined): string | null => (isViewer(login) ? null : login ?? null);

/* ═══ environment & change detail (AD v2 aa, bb, ff, gg, hh, ii, jj) ═══ */
export type Inbound = { app: string; build: string; from: TierKey | null; reason: string | null; href: string | null };
/** (aa) Builds NOT yet running in an environment: the app's newest build runs elsewhere (upstream) but no place of this tier runs it; `reason` is why the tier holds it. A build already checking in the tier belongs to its row. */
export function inbound(state: HomeState, tier: TierKey): Inbound[] {
	const causes = heldCauses(state);
	const out: Inbound[] = [];
	for (const a of homeModel(state).apps) {
		const ps = placesOf(state, a.app);
		const here = ps.filter((p) => p.tier === tier);
		if (!here.length) continue;
		const newest = ps[0]?.newest;
		if (!newest || here.some((p) => p.version === newest)) continue;
		const up = ps.filter((p) => p.version === newest && p.state !== 'failed').map((p) => p.tier).sort((x, y) => RANK_T[y] - RANK_T[x])[0] ?? null;
		const hold = here.map((p) => causes.find((c) => c.rows.some((r) => r.href === p.href))).find(Boolean);
		out.push({ app: a.app, build: buildName(a.app, newest) ?? newest, from: up, reason: hold?.cause ?? null, href: here[0].href });
	}
	return out;
}
/** QA2 #5: ARRIVING = an inbound build nothing holds back. A build held on an approval / rule / check is waiting, not moving, so tiles must not claim it is arriving (the gangway's `ready` column is this same set). */
export const isArriving = (x: Inbound): boolean => !x.reason;
/** (bb) The verb(s) of a place: every fact the tab states, e.g. checkout-edge prod = ["waits on approval", "d09e6f4 checking 25m"]; `text` joins them. */
export function stateVerb(row: TRow, state: HomeState = 'incident'): { facts: string[]; text: string } {
	const facts: string[] = [];
	const cause = (() => { const c = heldCauses(state).find((x) => x.rows.some((r) => r.href === row.href)); return c ? c.cause.replace(/^Waiting/, 'waits').replace(/^waits for approval$/, 'waits on approval') : null; })();
	if (row.group === 'failed') facts.push('failing');
	else if (row.state === 'awaiting-approval') facts.push('waits on approval');
	else if (row.state === 'held-by-rule') facts.push(cause ?? 'held by a rule');
	if (row.stillChecking) facts.push(`${buildTitle(row)} checking ${ago(row.since)}`);
	else if (row.state === 'checking' || row.state === 'deploying') facts.push(`${buildTitle(row)} ${row.state === 'checking' ? 'checking' : 'deploying'} ${ago(row.since)}`);
	if (row.regions.length > 1) facts.unshift(`${row.regions.length} prod regions`);
	return { facts, text: facts.join(' · ') };
}
/** (ff) The rows of ONE place (a region or a non-prod environment): folded rows are unfolded so a region page lists that region only. */
export function rowsOf(state: HomeState, tier: TierKey, label: string): TRow[] {
	const out: TRow[] = [];
	/* placeLabel prints a lone "prod" region as "production"; callers hold that DISPLAY label, so accept it for the raw region (else the row is lost and a failing place reads as a healthy rest place) */
	const raw = tier === 'prod' && label === 'production' ? 'prod' : label;
	for (const r of rollouts(state).rows) {
		if (r.tier !== tier || !(r.regions.includes(label) || r.regions.includes(raw))) continue;
		const pl = placesOf(state, r.app).find((p) => p.tier === tier && (p.label === label || p.label === raw));
		out.push(r.regions.length === 1 ? r : { ...r, key: `${r.app}@${label}`, regions: [label], where: label, place: label, href: pl?.href ?? r.href, regionsOf: null });
	}
	return out;
}
const changeBuilds = (c: Pick<ChangeItem, 'repo' | 'mergedAt' | 'title'>): { sha: string | null; contained: string[]; entry: FxChange | undefined } => {
	const entry = chgList().find((x) => x.repo === c.repo && x.mergedAt === c.mergedAt) ?? chgList().find((x) => x.title === c.title);
	let contained = (entry as unknown as { containedIn?: string[] } | undefined)?.containedIn ?? [];
	if (entry?.kind === 'pr' && entry.number != null) {
		const j = githubJson<{ containedIn?: string[] }>(`/api/github/pulls/${(entry as unknown as { owner?: string }).owner ?? 'exampleco'}/${entry.repo}/${entry.number}`);
		if (Array.isArray(j?.containedIn)) contained = j!.containedIn!;
	}
	return { sha: entry?.mergeCommitSha.slice(0, 7) ?? null, contained: contained.map((x) => x.slice(0, 7)), entry };
};
/** (gg) Every place of the change's apps with its deployed build and whether that build CONTAINS the change (the PR's own containedIn: a "Custom build" does not count). */
export function placesOfChange(c: Pick<TChange, 'repo' | 'apps' | 'mergedAt' | 'title'>, state: HomeState = 'incident'): { app: string; place: string; tier: TierKey; build: string | null; state: EnvState; href: string; containsChange: boolean }[] {
	const { contained } = changeBuilds(c);
	return c.apps.flatMap((app) => placesOf(state, app).map((p) => {
		const sha = rawOf(p.href)?.status.history?.[0]?.version.revision?.slice(0, 7) ?? p.version ?? '';
		return { app, place: placeLabel({ tier: p.tier, regions: [p.label] }), tier: p.tier, build: buildName(app, p.version), state: p.state, href: p.href, containsChange: contained.includes(sha) && p.state !== 'failed' };
	}));
}
/** (hh) The PR's own commits (head commit with the PR's title and author) and, separately, the builds carrying the change. */
export function changeCommits(c: Pick<TChange, 'repo' | 'apps' | 'mergedAt' | 'title'>, state: HomeState = 'incident'): { commits: { sha: string; title: string; author: string | null }[]; builds: { app: string; build: string; places: string[] }[] } {
	const { entry } = changeBuilds(c);
	const id = buildIdentity(entry?.mergeCommitSha.slice(0, 7));
	const commits = entry ? [{ sha: entry.mergeCommitSha.slice(0, 7), title: id?.title ?? entry.title, author: id?.author ?? entry.author ?? null }] : [];
	const by = new Map<string, { app: string; build: string; places: string[] }>();
	for (const p of placesOfChange(c, state)) if (p.containsChange && p.build) { const k = `${p.app}|${p.build}`; const e = by.get(k) ?? { app: p.app, build: p.build, places: [] }; e.places.push(p.place); by.set(k, e); }
	return { commits, builds: [...by.values()] };
}
/** (ii) Every deploy that carried the change, one row per place and deploy, rollbacks and redeploys included, with the tab's own timestamps, oldest first. */
export function historyOfChange(c: Pick<TChange, 'repo' | 'apps' | 'mergedAt' | 'title'>, state: HomeState = 'incident'): { app: string; place: string; build: string; at: string; kind: 'deploy' | 'rollback' | 'redeploy'; who: string; outcome: string; href: string }[] {
	const { contained } = changeBuilds(c);
	const out: ReturnType<typeof historyOfChange> = [];
	for (const app of c.apps) for (const e of homeModel(state).apps.find((x) => x.app === app)?.envs ?? []) {
		const raw = rawOf(e.href);
		if (!raw || e.state === 'not-deployed') continue;
		const acts = deployActs(raw as never);
		(raw.status.history ?? []).forEach((h, i) => {
			if (!contained.includes((h.version.revision ?? h.version.tag ?? '').slice(0, 7))) return;
			const k = acts[i]?.kind;
			out.push({ app, place: placeLabel({ tier: tierOfEnv(e), regions: [e.label] }), build: shortBuild(h.version.version ?? h.version.tag ?? h.version.revision) ?? '', at: h.timestamp, kind: k === 'rollback' ? 'rollback' : k === 'redeploy' ? 'redeploy' : 'deploy', who: h.triggeredBy?.kind === 'User' && h.triggeredBy.name ? RD.pretty(h.triggeredBy.name) ?? 'Automatic' : 'Automatic', outcome: h.bakeStatus ?? 'Succeeded', href: e.href });
		});
	}
	return out.sort((x, y) => x.at.localeCompare(y.at));
}
/** (jj) The cost of a failure: the newer builds a place holds behind it, with the PR each one carries and whether it is the viewer's. */
export function heldBehind(row: Pick<RolloutRow, 'app' | 'href'>): { count: number; builds: { build: string; pr: number | null; title: string | null; author: string | null; mine: boolean }[]; includesViewer: boolean } {
	const builds = candidateBuilds(row).map((h) => {
		const tag = (rawOf(row.href)?.status.releaseCandidates ?? []).find((c) => (c.version ?? c.tag) === h.build || c.tag === h.build)?.tag;
		const id = buildIdentity(tag, row.href);
		return { build: h.build, pr: id?.pr ?? null, title: id?.title ?? h.title, author: id?.author ?? h.author, mine: isViewer(id?.author) };
	});
	return { count: builds.length, builds, includesViewer: builds.some((b) => b.mine) };
}

/** One hold of an app, as a sentence plus what kind it is: pages branch on `approval`, never on the sentence's words. The approval hold says "your" when the viewer can give it. */
export type Hold = { text: string; approval: boolean };
export function appHolds(item: Pick<TApp, 'app' | 'holds'>, state: HomeState): Hold[] {
	const out: Hold[] = [];
	for (const hc of heldCauses(state)) {
		const mine = hc.rows.filter((r) => r.app === item.app);
		if (!mine.length) continue;
		const approval = hc.cause === sharedWord('approval');
		const word = approval ? sharedWord('approval', { yours: mine.some((r) => actionFor(r)?.kind === 'approve') })! : hc.cause.replace(/^Waiting/, 'Waits');
		out.push({ text: `${word} in ${mine.map((r) => r.place).join(' and ')}`, approval });
	}
	return [...out, ...item.holds.filter((h) => /^Pinned/.test(h)).map((text) => ({ text, approval: false }))];
}
/* ═══ inbox, arrivals, held causes ═══ */
export type InboxItem = { row: TRow; action: RolloutRow['action']; reason: string; steps: Step[] };
export function inbox(state: HomeState) {
	const R = rollouts(state);
	const items: InboxItem[] = R.rows.filter((r) => r.needsYou).sort(urgency).map((r) => ({
		row: r, action: r.action, steps: r.steps,
		reason: r.failure?.line ?? (r.state === 'awaiting-approval' ? sharedWord('approval', { yours: true })! : r.cause ?? r.word)
	}));
	return { items, count: items.length, R };
}
export type TArrival = ArrivalRow & { /** the build as the tab names it ("4.42.0-42") */ build: string | null; href: string | null };
export function arrivals(state: HomeState): TArrival[] {
	const R = RD.rollouts(state);
	return RD.arrivalRows(R.activity, R.c.m.apps).map((a) => {
		const envs = (R.c.m.apps.find((x) => x.app === a.app)?.envs ?? []).filter((e) => tierOfEnv(e) === 'prod' && e.state !== 'not-deployed' && e.version && Math.abs(Date.parse(e.arrivedAt ?? a.at) - Date.parse(a.at)) < 30 * 60000);
		const e = envs[0];
		return { ...a, build: e ? buildName(a.app, e.version) : null, href: e?.href ?? null };
	});
}
/** A closed deploy window says the window and its clock, as every schedule does elsewhere (`formatTransitionAt`: "Mon 09:00 UTC"): "Deploy window opens Mon 09:00 UTC"; with no published transition, "Waiting for the deploy window". */
export function windowCause(w: { label: string; opensAt: string | null } | undefined, now: Date = new Date()): string {
	return w?.opensAt ? `Deploy window opens ${formatTransitionAt(w.opensAt, now)}` : 'Waiting for the deploy window';
}
export type HeldCause = { key: string; cause: string; places: string[]; rows: TRow[] };
/** One entry per hold cause, from the model's needsYou facts: "Waiting for approval", "Waiting on payments-svc", "Waiting on Integration tests" (a check is named as the Gates tab prints its gate). */
export function heldCauses(state: HomeState, tier?: TierKey): HeldCause[] {
	const R = rollouts(state);
	const ny = new Map(R.c.m.fleet.needsYou.map((n) => [`${n.app}@${n.env}`, n]));
	const out = new Map<string, HeldCause>();
	for (const r of R.rows) {
		if (r.group !== 'approval' && r.group !== 'held') continue;
		if (tier && r.tier !== tier) continue;
		const n = ny.get(r.key);
		const f = n?.facts;
		const cause =
			r.state === 'awaiting-approval' ? 'Waiting for approval'
			: f?.reason === 'dependency' ? (f.provider ? `Waiting on ${f.provider}` : 'Waiting on a dependency')
			: f?.reason === 'check' ? (f.checks?.length ? `Waiting on ${f.checks.map((c) => gateDisplayName(c)).join(', ')}` : 'Waiting on a check')
			: f?.reason === 'pinned' ? 'Pinned'
			: f?.reason === 'clock' ? windowCause(f.window)
			: r.word.startsWith('Waits on') ? r.word.replace('Waits on', 'Waiting on') : 'Held by a rule';
		const e = out.get(cause) ?? { key: cause, cause, places: [], rows: [] };
		e.places.push(`${r.app} · ${r.place}`);
		e.rows.push(r);
		out.set(cause, e);
	}
	return [...out.values()].sort((a, b) => b.rows.length - a.rows.length || a.cause.localeCompare(b.cause));
}

/* silence unused-import lint for re-exported helpers */
void NOW;
void ago;

/* ═══ r34 v2 CD r3 — block owned by the change-detail lane (appended; the truth lane may move it) ═══ */
/** The TAB's own commit range for ANY build of a rollout (not only the one it runs now): title, author and the commit list of the range "release listed before it → this build"
 *  (the same mock endpoint the Overview / History read; `buildRange` is this for the deployed build, `heldBuilds` for the candidates). `build` is the tag, the version or the
 *  short name the tab prints ("a11c202", "4.45.0-45"). null when the rollout has no such release or the mock has no range. A BUILD is the subject: the person is the commit's author. */
export function buildCommitOf(href: string, build: string | null | undefined): { title: string; author: string | null; sha: string; commits: { sha: string; title: string; author: string | null }[] } | null {
	if (!build) return null;
	const rel = (rawOf(href)?.status as { availableReleases?: { tag?: string; version?: string; revision?: string }[] } | undefined)?.availableReleases ?? [];
	const r = rel.find((x) => x.tag === build || x.version === build || (x.revision ?? '').startsWith(build));
	const tag = r?.tag ?? r?.version ?? build;
	const range = tabRange(href, tag);
	return range ? { title: range.title, author: range.author, sha: (r?.revision ?? tag).slice(0, 7), commits: range.commits } : null;
}

/* ═══ r5 rollouts lane (appended) ═══ */
/** r5: true when `at` is the timestamp of the place's NEWEST history entry (the one the tab's header describes). A page that masks a place's current state (?calm / ?quiet) uses it to tell
 *  "this failure is the place's current state" from "this failure is behind us". */
export function isCurrentEntry(href: string, at: string): boolean {
	return rawOf(href)?.status.history?.[0]?.timestamp === at;
}
/** r6 T3: when a failed history entry (identified by its timestamp `at`) was followed by a healthy one: the timestamp of the NEXT newer Succeeded entry of the place, which is
 *  what the History tab prints as "Healthy at ... · 20m ago". null when nothing newer has succeeded (the place is still failing, or the next entry is still baking). */
export function recoveredAt(href: string, at: string): string | null {
	const h = rawOf(href)?.status.history ?? [];
	const i = h.findIndex((e) => e.timestamp === at);
	if (i <= 0) return null;
	const n = h.slice(0, i).reverse().find((e) => (e.bakeStatus ?? 'Succeeded') === 'Succeeded');
	return n?.timestamp ?? null;
}
/** r5 S8: the bake's length as the tab prints it on a finished check ("1m 0s"); null while it runs or when the entry has no bake window. */
export function bakeDuration(row: Pick<RolloutRow, 'href'>): string | null {
	const e = rawOf(row.href)?.status.history?.[0];
	if (!e?.bakeStartTime || !e.bakeEndTime) return null;
	const s = Math.max(0, Math.round((Date.parse(e.bakeEndTime) - Date.parse(e.bakeStartTime)) / 1000));
	return `${Math.floor(s / 60)}m ${s % 60}s`;
}
// apps-12 (AT7): the builds a place has deployed, newest first, as the Builds card prints them when nothing newer exists (title and author as the tab's History headline)
export function deployedHistory(href: string, n = 8): { build: string; title: string | null; author: string | null; at: string | null }[] {
	return (rawOf(href)?.status.history ?? []).slice(0, n).map((h) => {
		const v = h.version as { tag?: string; version?: string; revision?: string };
		const tag = v.tag ?? v.version ?? v.revision ?? '';
		const sha = v.revision?.slice(0, 7) ?? '';
		const r = tabRange(href, tag);
		return { build: shortBuild(v.version ?? v.tag) ?? tag, title: titleOfBuild(href, sha || tag, r?.title ?? null), author: r?.author ?? null, at: h.timestamp ?? null };
	});
}
// inbox-15: the build a place runs by its href alone (a healthy place the roster leaves out of `rows`); the tab header's own build title
export const buildAtHref = (href: string): string | null => buildTitle({ href, version: '' }) || null;
