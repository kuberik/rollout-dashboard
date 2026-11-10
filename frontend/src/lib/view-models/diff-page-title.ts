import { getDisplayVersion } from '$lib/utils';

/**
 * The diff page's `<title>` — pulled out as a pure function so the "v" bug
 * (QA/TL, round 7, 2026-10-10: `<title>Diff vb-42</title>` for the tag
 * `b-42`, a stray literal "v" prefix the page's own markup had hard-coded
 * ahead of `${version}`) has a test that cannot silently regress. A build
 * id is whatever `getDisplayVersion` resolves (`version.version` ||
 * `.revision` || `.tag`) — never a literal "v" glued onto it, since a tag
 * is not guaranteed to be semver (`b-42`, a sha, a date-stamped build) and
 * "v" in front of a non-numeric id reads as a typo, not a version marker.
 *
 * `toBuild`/`fallbackTag` mirror the page's own two sources: once the
 * rollout and its history entry have loaded, the entry's resolved display
 * version is the truth; before that (first paint, SSR, or a `version` the
 * history no longer carries), the raw route param is the only id known —
 * printed as-is, still with no "v" added.
 */
export function diffPageTitle(args: {
	rolloutName?: string | null;
	rolloutNamespace?: string | null;
	toBuild?: string | null;
	fallbackTag: string;
}): string {
	const build = args.toBuild ?? args.fallbackTag;
	if (args.rolloutName && args.rolloutNamespace) {
		return `${args.rolloutName} (${args.rolloutNamespace}) Diff ${build}`;
	}
	return `Diff ${build}`;
}

/** Re-exported so a caller building `toBuild` itself never needs a second
 *  import for the same resolution `getDisplayVersion` already does. */
export { getDisplayVersion };

/**
 * WHAT THIS DIFF IS OF (squad-rollout, AD round 5, 2026-10-10). The diff
 * page is about ONE history entry and the entry right before it; that pair
 * is not always a change. Three cases are not a diff at all and must not
 * read as an error:
 *   · `redeploy` — the same build twice ("Redeploy of 2c8b409"), nothing
 *     changed and nothing to roll back to;
 *   · `first`    — no earlier entry and the history is provably complete
 *     ("First deploy of a1b2c3d");
 *   · `oldest`   — no earlier entry, but retention may have evicted it
 *     (`historyAtLimit`): what it replaced is unknown, so it is not called
 *     a first deploy.
 * `missing` is a build the history does not hold at all.
 * `rollback` marks a change whose act (`deployActs`) went backwards.
 */
export type DiffSubject =
	| { kind: 'change'; from: string; to: string; fromTag: string; toTag: string; rollback: boolean }
	| { kind: 'redeploy'; build: string }
	| { kind: 'first'; build: string }
	| { kind: 'oldest'; build: string }
	| { kind: 'missing'; build: string };

type EntryLike = { version: { tag: string; version?: string; revision?: string } };

export function diffSubject(args: {
	history: EntryLike[];
	tag: string;
	/** `historyAtLimit(rollout)` */
	atLimit: boolean;
	/** `deployActs(rollout)[index]?.kind`, when known */
	actKind?: string | null;
}): { subject: DiffSubject; index: number } {
	const index = args.history.findIndex((h) => h.version.tag === args.tag);
	if (index === -1) return { subject: { kind: 'missing', build: args.tag }, index };
	const cur = args.history[index];
	const prev = args.history[index + 1];
	const to = getDisplayVersion(cur.version);
	if (!prev) {
		return { subject: { kind: args.atLimit ? 'oldest' : 'first', build: to }, index };
	}
	if ((prev.version.tag ?? to) === (cur.version.tag ?? to)) {
		return { subject: { kind: 'redeploy', build: to }, index };
	}
	return {
		subject: {
			kind: 'change',
			from: getDisplayVersion(prev.version),
			to,
			fromTag: prev.version.tag ?? '',
			toTag: cur.version.tag ?? '',
			rollback: args.actKind === 'rollback'
		},
		index
	};
}

/** The subject in words, for the header's first meta fact and the empty state. */
export function diffSubjectLabel(s: DiffSubject): string {
	switch (s.kind) {
		case 'change':
			return `${s.from} → ${s.to}`;
		case 'redeploy':
			return `Redeploy of ${s.build}`;
		case 'first':
			return `First deploy of ${s.build}`;
		case 'oldest':
			return `Oldest kept deploy of ${s.build}`;
		case 'missing':
			return `No deploy of ${s.build} in history`;
	}
}

/** `1m`, `2h 5m`, `3d 4h` — History's own span words. */
export function spanLabel(ms: number): string {
	const m = Math.max(0, Math.floor(ms / 60_000));
	if (m < 60) return `${m}m`;
	const h = Math.floor(m / 60);
	if (h < 24) return m % 60 === 0 ? `${h}h` : `${h}h ${m % 60}m`;
	const d = Math.floor(h / 24);
	return h % 24 === 0 ? `${d}d` : `${d}d ${h % 24}h`;
}

export type DeployOutcome = {
	/** For RolloutTabHeader's `chip`; `undefined` = keep the rollout's live chip. */
	chip: { role: 'ready' | 'failing' | 'checking' | 'deploying' | 'unranked'; label: string; title?: string } | undefined;
	/** The outcome as a sentence: "Healthy in 1m", "Failed after 1m". */
	sentence: string;
	tone: 'good' | 'adverse' | 'active' | 'neutral';
};

/**
 * WHAT THIS ONE DEPLOY DID (squad-rollout, AD round 6, item a). The diff
 * page is about one past deploy, so its pill says how THAT deploy went,
 * never the rollout's current state — except when this deploy IS the
 * running one, where its live state is the true answer (`chip: undefined`
 * keeps RolloutTabHeader's own live chip). A past deploy with no verdict
 * (it was replaced mid-check) reads "superseded", not "checking".
 */
export function deployOutcome(
	entry: { bakeStatus?: string | null; timestamp: string; bakeEndTime?: string | null },
	opts: { live: boolean; now: number }
): DeployOutcome {
	const t0 = new Date(entry.timestamp).getTime();
	const end = entry.bakeEndTime ? new Date(entry.bakeEndTime).getTime() : NaN;
	const took = Number.isFinite(t0) && Number.isFinite(end) && end > t0 ? spanLabel(end - t0) : null;
	if (entry.bakeStatus === 'Succeeded') {
		return {
			chip: opts.live ? undefined : { role: 'ready', label: 'healthy' },
			sentence: took ? `Healthy in ${took}` : 'Healthy',
			tone: 'good'
		};
	}
	if (entry.bakeStatus === 'Failed') {
		return {
			chip: opts.live ? undefined : { role: 'failing', label: 'failed' },
			sentence: took ? `Failed after ${took}` : 'Failed',
			tone: 'adverse'
		};
	}
	if (opts.live) {
		const since = Number.isFinite(t0) ? spanLabel(opts.now - t0) : null;
		if (entry.bakeStatus === 'Deploying') return { chip: undefined, sentence: 'Deploying', tone: 'active' };
		return { chip: undefined, sentence: since ? `Checking for ${since}` : 'Checking', tone: 'neutral' };
	}
	return {
		chip: { role: 'unranked', label: 'superseded', title: 'A newer deploy replaced this one before its checks finished.' },
		sentence: 'Superseded before its checks finished',
		tone: 'neutral'
	};
}
