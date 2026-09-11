/**
 * THE PR-CENTRIC VIEW'S PER-TAB CACHE. Keyed `owner/repo#n`, so `/pr/{owner}/
 * {repo}/{number}` and ⌘K's `pr` result kind share one fetch and one
 * `containedIn` set for the lifetime of the tab — a second PR tab opened in
 * the same session gets its own entry rather than fighting this one.
 *
 * ⛔ NEVER ON A TIMER. `fetchPull`'s own response is cached `staleTime: 5m`
 * (see `api/pulls.ts`'s `pullQueryOptions`) because an open PR can still
 * gain commits and a merged one cannot change its own record — but a build
 * landing on `main` while the page is open is a fact THIS STORE has to
 * catch, and polling `/api/github/pulls/…` on a clock to catch it would be
 * exactly the waste `commitsQueryOptions`' own doc comment warns against for
 * an immutable range. The design doc's answer: re-fetch, DEBOUNCED 5s, only
 * when the caller (the page, which already watches the streamed rollout
 * list) reports a NEW `availableReleases` revision for a matching app that
 * is not already in this entry's own `containedIn` set. `notifyRevisionSeen`
 * is that report; nothing in this file starts an interval.
 */
import { fetchPull, type PullRequestInfo } from '$lib/api/pulls';

const REFETCH_DEBOUNCE_MS = 5000;

export function prMetaKey(owner: string, repo: string, number: number): string {
	return `${owner}/${repo}#${number}`;
}

export class PrMetaEntry {
	readonly key: string;
	readonly owner: string;
	readonly repo: string;
	readonly number: number;
	readonly cluster: string | undefined;

	data = $state<PullRequestInfo | null>(null);
	loading = $state(false);
	error = $state<unknown>(null);
	/** Bumped on every completed fetch — a cheap "when did this last settle". */
	lastFetchedAt = $state<number | null>(null);

	constructor(owner: string, repo: string, number: number, cluster?: string) {
		this.key = prMetaKey(owner, repo, number);
		this.owner = owner;
		this.repo = repo;
		this.number = number;
		this.cluster = cluster;
	}

	/**
	 * `mergeCommitSha` plus every sha `containedIn` names — the set
	 * `pr-pipeline.ts`'s `buildPrPipeline` is built to consume directly.
	 * Recomputed from `data` on read (cheap: at most a few hundred entries),
	 * so it stays reactive without a second `$state` copy to keep in sync.
	 */
	get containedSet(): Set<string> {
		const set = new Set<string>();
		if (!this.data) return set;
		if (this.data.mergeCommitSha) set.add(this.data.mergeCommitSha);
		for (const sha of this.data.containedIn) set.add(sha);
		return set;
	}

	async fetch(): Promise<void> {
		this.loading = true;
		try {
			const data = await fetchPull(this.owner, this.repo, this.number, this.cluster);
			this.data = data;
			this.error = null;
		} catch (e) {
			this.error = e;
		} finally {
			this.loading = false;
			this.lastFetchedAt = Date.now();
		}
	}
}

const entries = new Map<string, PrMetaEntry>();
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Read-only lookup. Does not create an entry — use `ensurePrMeta` for that. */
export function getPrMeta(key: string): PrMetaEntry | undefined {
	return entries.get(key);
}

/**
 * The entry for `owner/repo#n`, creating it (and firing its first fetch) the
 * first time this tab asks for it. Every later call for the same key returns
 * the SAME reactive object, which is what lets ⌘K prefetch a result the
 * `/pr/…` route then reuses without a second network round trip.
 */
export function ensurePrMeta(
	owner: string,
	repo: string,
	number: number,
	cluster?: string
): PrMetaEntry {
	const key = prMetaKey(owner, repo, number);
	let entry = entries.get(key);
	if (!entry) {
		entry = new PrMetaEntry(owner, repo, number, cluster);
		entries.set(key, entry);
		void entry.fetch();
	}
	return entry;
}

/**
 * Report that a matching app's `availableReleases` gained `revision`. If
 * this entry has data and `revision` is already in its `containedSet`, this
 * is a no-op — nothing changed that this entry needs to know about. Otherwise
 * it (re)starts a 5s debounce so a burst of change-stream events for the
 * same build collapses into ONE re-fetch rather than one per event.
 */
export function notifyRevisionSeen(key: string, revision: string): void {
	const entry = entries.get(key);
	if (!entry || !entry.data) return;
	if (entry.containedSet.has(revision)) return;

	const existing = pendingTimers.get(key);
	if (existing) clearTimeout(existing);
	pendingTimers.set(
		key,
		setTimeout(() => {
			pendingTimers.delete(key);
			void entry.fetch();
		}, REFETCH_DEBOUNCE_MS)
	);
}

/** Test seam — drop every cached entry and pending timer. */
export function resetPrMetaStore(): void {
	for (const t of pendingTimers.values()) clearTimeout(t);
	pendingTimers.clear();
	entries.clear();
}
