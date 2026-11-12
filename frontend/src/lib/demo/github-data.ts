/**
 * GITHUB, MOCKED — LANE 7 (feat/demo-mode).
 *
 * The demo build (`MOCK_API=1`, and the static build kuberik.com embeds) never
 * talks to a real GitHub. Before this file, `/api/auth/github/status` fell
 * through `respond.ts`'s catch-all to `{}` — read as `configured: false,
 * connected: false` by `fetchGithubStatus` — so the navbar wore a permanent
 * "Not configured" badge, the rollout detail commit rollup rendered nothing,
 * and Home's Changes column never appeared. This file answers every GitHub
 * question the product asks with a CONNECTED, populated fixture universe.
 *
 * ⭐ ONE ENTRY POINT: `respondGithub(method, path, search)`. `path` is the
 * request's pathname ONLY (query string split off, cluster prefix already
 * stripped — the same shape `respond.ts`'s own `reqPath` is in after its
 * `stripClusterPrefix`). Returns `null` when the path is not one of ours, so
 * a caller can fall through to whatever else handles the request — this file
 * does not know about `respond.ts`'s routing table and does not need to.
 *
 * ⛔ NOTHING NODE-SPECIFIC. This is bundled into the browser for the static
 * demo build exactly like `mock-data.ts` and `respond.ts` are — no `node:fs`,
 * no `crypto`, no `Math.random`.
 *
 * ⭐ DETERMINISM. Every timestamp in this file derives from `hcNow`
 * (`mock-data.ts`'s own pinned fixture anchor, captured at module load) —
 * never `Date.now()` at request time, which would drift ~12h from every other
 * timestamp in the product on a capture server whose page loaded hours ago.
 * There is no `Math.random()` anywhere in this file either: every choice
 * (author, PR-vs-commit, message, age, filler count) is a deterministic hash
 * of a stable seed string, so two requests for the same thing always answer
 * identically, and a capture run is reproducible byte-for-byte.
 *
 * ⭐ WHY GENERATED, NOT HAND-WRITTEN. `mock-data.ts` is being rewritten by a
 * different lane while this file is authored, so nothing here imports its
 * per-app rollout shapes — only its `hcNow` anchor, which is the one export
 * every lane in this effort treats as stable. Instead, this file hardcodes
 * its own copy of the shas/tags the film's rollouts actually run (read off
 * `mock-data.ts` at the time this was written: hello-world's history,
 * `FLEET`, `HF_BUILDS`/`checkout-edge`, `MR_BUILDS`/`payments-core`,
 * `EM_BUILDS`/`edge-mesh`, `CK_RELEASES`/`checkout-api`, `DEP_RELEASES`/
 * `hello-frontend-app`, `SA_RELEASES`/`standalone-api`) and builds a small
 * "ladder" (oldest→newest release identifier) per app. A landmark `Change` is
 * generated for every step of every ladder, so a compare between two releases
 * that actually appear in a rollout's history always resolves to a REAL,
 * internally-consistent commit range — not a coincidence, the two data sets
 * share their shas by construction.
 */

import {
	hcNow,
	expandSha,
	HF_BUILDS,
	MR_BUILDS,
	MR_OFF_LINE,
	EM_BUILDS,
	FLEET_BACKFILL_DEEPEST_MIN_AGO
} from './mock-data';
import { DEMO_AVATAR_DATA_URI } from './demo-avatar';
import { avatarColor } from '../avatar-colors';
import type { GithubStatus, CommitInfo, CommitsResponse } from '../api/github';
import type { Change, ChangesResponse } from '../api/changes';
import type { PullRequestInfo, PrCheckState } from '../api/pulls';
import type { CommitPull } from '../api/commit-pulls';
import type { Commit } from '../api/commit';

// ── THE RETURN SHAPE ─────────────────────────────────────────────────────
//
// Structurally identical to `respond.ts`'s own `MockResult` minus `stream`
// (GitHub never streams) — redeclared rather than imported so this file has
// no dependency on a sibling that is itself under concurrent rewrite.

export type GithubMockResult = { status: number; headers: Record<string, string>; body: string };

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function json(value: unknown): GithubMockResult {
	return { status: 200, headers: JSON_HEADERS, body: JSON.stringify(value) };
}

function jsonStatus(status: number, value: unknown): GithubMockResult {
	return { status, headers: JSON_HEADERS, body: JSON.stringify(value) };
}

// ── DETERMINISTIC HELPERS — NO Math.random, NO wall-clock reads ──────────

/** FNV-1a over a string, unsigned 32-bit. The one source of "randomness" in
 *  this file — every choice below is `hashStr(someStableSeed) % n`, which is
 *  the same answer on every call, every process, every capture. */
function hashStr(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = (h * 16777619) >>> 0;
	}
	return h >>> 0;
}

function pick<T>(arr: readonly T[], seed: string): T {
	return arr[hashStr(seed) % arr.length];
}

/** A 40-char hex string derived from `seed` — used for filler commits/changes
 *  that have no real ladder sha to reuse. Not cryptographic; just stable. */
function synthSha(seed: string): string {
	let out = '';
	let h = hashStr(seed) || 1;
	for (let i = 0; i < 5; i++) {
		h = (Math.imul(h, 1103515245) + 12345) >>> 0;
		out += h.toString(16).padStart(8, '0');
	}
	return out.slice(0, 40);
}

/** Strips a trailing run of zeros — kept for the one caller
 *  (`identifiersFor`'s normalization) that still needs to compare a ref
 *  against a LITERAL zero-padded form, in case anything upstream of this
 *  mock ever reconstructs that shape by hand rather than through
 *  `expandSha`. */
function stripPad(s: string): string {
	const stripped = s.replace(/0+$/, '');
	return stripped || s;
}

/**
 * ⭐ ROUND 5 QA-5, ITEM 2 (TL, dead build links) — WHY THIS EXISTS.
 *
 * `mock-data.ts`'s release objects do not all spell a ladder step's identity
 * the same way `respondCommit`/`respondCommitPulls` used to require (an
 * EXACT match against `ChangeRecord.mergeCommitSha`, which then held the raw
 * ladder `tag`; it now holds `revisionOf(repo, tag)`, the build's revision):
 *
 *   - `checkout-edge`/`payments-core`/`edge-mesh` set `revision:
 *     expandSha(tag)` — a deterministic 40-char hex expansion that keeps the
 *     tag as a literal prefix only when the tag itself is pure hex. The UI
 *     slices this to 12 chars for the link (`revisionSlug`), so the ref that
 *     actually arrives here is a 12-char PREFIX of `expandSha(tag)`, never
 *     the bare tag.
 *   - `hello-frontend-app` (`DEP_RELEASES`) hardcodes an UNRELATED-LOOKING
 *     40-char hex per tag on purpose (two tags sharing one revision models a
 *     real double-tagged commit — `revision-coverage.ts`'s own fixture
 *     story) — no formula connects it to the tag at all, so it is listed
 *     here verbatim instead of derived.
 *   - `checkout-api`/`standalone-api` (`CK_RELEASES`/`SA_RELEASES`) now also
 *     carry `revision: expandSha(tag)`, added alongside this fix (see
 *     `mock-data.ts`'s own note on those two) — before that they had no
 *     `revision` field at all, so the UI fell back to the human `version`
 *     string ("4.40.0-40") as the link key, which this file could never
 *     answer for either.
 *
 * `identifiersFor` is every spelling a ladder step (`repo`+`tag`) might
 * legitimately arrive as; `refMatches` accepts an exact match OR a prefix
 * either direction against any of them (a short ref against a long
 * identifier — the common case, the UI's own truncation — and a long ref
 * against a short identifier, kept for the bare-tag case that already
 * worked before this fix).
 */
const REVISION_ALIASES: Record<string, Record<string, string>> = {
	'hello-frontend-app': {
		'rel-2': 'e87f059fd602466f1c13e293210b3d2e430504c8',
		'rel-63': '66e4133a4289eec3b88439b2069b617c8435975f',
		'rel-64': '83755067c4c76bc112258b901108ec03699f7f4d',
		'rel-66': '9f10e494d560c1db68aef5203e3afdc5fd9e1e10'
	}
};

/**
 * The git revision a ladder `tag` was built from: what a change's
 * `mergeCommitSha`/`containedIn` must hold, because the product matches a
 * change to a build by revision. A hex tag is already a short sha (its
 * release's `revision` is `expandSha(tag)`, which starts with it); a build
 * tag (`b-42`, `s-10`) gets the `expandSha(tag)` its release carries, and
 * hello-frontend-app's `rel-*` its hardcoded revision (`REVISION_ALIASES`).
 */
function revisionOf(repo: string, tag: string): string {
	const alias = REVISION_ALIASES[repo]?.[tag];
	if (alias) return alias;
	return /^[0-9a-f]+$/i.test(tag) ? tag : expandSha(tag);
}

function identifiersFor(repo: string, tag: string): string[] {
	const ids = [tag, expandSha(tag)];
	const alias = REVISION_ALIASES[repo]?.[tag];
	if (alias) ids.push(alias);
	return ids;
}

function refMatches(repo: string, tag: string, ref: string): boolean {
	const r = ref.toLowerCase();
	const rNorm = stripPad(r);
	return identifiersFor(repo, tag).some((id) => {
		const i = id.toLowerCase();
		if (i === r) return true;
		if (stripPad(i) === rNorm) return true;
		return r.startsWith(i) || i.startsWith(r);
	});
}

/** Matches a ref (whatever the frontend sent as `base`/`head`) against a
 *  ladder entry, permissively — see `refMatches` above for every spelling
 *  this now accepts. */
function findLadderIndex(app: AppFixture, ref: string): number {
	return app.ladder.findIndex((entry) => refMatches(app.repo, entry, ref));
}

/** A small, deterministic per-seed diffstat — used both for a real ladder
 *  transition and for a filler/unknown commit. */
function transitionStat(seed: string): { add: number; del: number; filesN: number } {
	const h = hashStr(seed);
	// ⛔ `>>>` (unsigned), NOT `>>` — `h` can exceed 2^31, and a signed shift
	// on that makes `del` negative half the time (found live: "deletions: -22").
	return { add: 5 + (h % 80), del: (h >>> 3) % 30, filesN: 1 + (h % 4) };
}

/**
 * ⭐ (2026-10-11, AD round 6) THE ONLY DATE FOR A COMMIT THIS FILE DOES NOT
 * TIE TO A LADDER POSITION — a genuinely unrecognized range
 * (`unknownRangeResponse`), which by definition has no ladder index to
 * anchor to. Floored at `LADDER_MIN_AGE_MS` (below) rather than the old
 * 14-day random spread, so even this honest-fallback commit cannot read as
 * newer than a build that was only just created — the same margin every
 * ladder-anchored commit keeps.
 */
function fallbackCommitDateMs(seed: string): number {
	const h = hashStr(seed);
	return hcNow.getTime() - LADDER_MIN_AGE_MS - (h % (6 * 3_600_000));
}

// ── CHRONOLOGY: EVERY COMMIT DATES AT OR BEFORE ITS OWN BUILD ────────────
//
// ⭐ (2026-10-11, AD round 6) WAS `commitDateFor(seed)` for every ladder
// commit too: a pure hash of the sha within a flat 14-day window, with NO
// relationship to the ladder's own oldest→newest order or to how recently
// that build was actually created elsewhere in the fixture (`mock-data.ts`'s
// own `HF_BUILDS`/`CK_RELEASES`/etc, which this file still does not import —
// see this file's own header on why). Found live: `9a1f4c2` (the NEWEST
// checkout-edge build, built *minutes* ago) read as a commit "10 days ago",
// and a single compare range's own commits ran 10h/3d/2h/1d/10d — newest and
// oldest interleaved at random, and a later entry sometimes dated BEFORE an
// earlier one.
//
// `ladderCommitDateMs` assigns every ladder step a commit age that is
// STRICTLY MONOTONIC with its ladder position (older index ⇒ older commit,
// always — by construction, not by luck) and large enough, even at the
// newest index, that it comfortably precedes every real "built N ago" figure
// this fixture universe hands out elsewhere (checked by hand against every
// app this file curates — `HW_RELEASES`, `CK_RELEASES`, `SA_RELEASES`,
// `DEP_RELEASES`, `HF_BUILDS`, `MR_BUILDS`, `EM_BUILDS` — the tightest
// margin is a few hours; every other app has much more room). The curve is
// quadratic in `1 - frac` (`frac` = how far along the ladder, 0 oldest → 1
// newest) so recent history is dense and old history spreads out, the same
// shape a real repo's commit density has; the ceiling SCALES DOWN for a
// short ladder (`checkout-worker` is 2 steps, not 25) so a two-entry app's
// root commit does not read as older than an app with genuine months of
// history.
const LADDER_MIN_AGE_MS = 6 * 3_600_000; // newest ladder step: ≥6h old
const LADDER_MAX_AGE_MS = 45 * 86_400_000; // oldest step of a long (≥10-step) ladder
const LADDER_MAX_SCALE_STEPS = 10;

function genericLadderDateMs(app: AppFixture, idx: number): number {
	const lastIdx = app.ladder.length - 1;
	if (lastIdx <= 0) return hcNow.getTime() - LADDER_MIN_AGE_MS;
	const frac = idx / lastIdx; // 0 = oldest, 1 = newest
	const scale = Math.min(1, lastIdx / LADDER_MAX_SCALE_STEPS);
	let ceiling = LADDER_MIN_AGE_MS + (LADDER_MAX_AGE_MS - LADDER_MIN_AGE_MS) * scale;
	if (idx >= 1 && app.stepWindowMs !== undefined) ceiling = Math.min(ceiling, app.stepWindowMs);
	const t = 1 - frac; // 1 = oldest, 0 = newest
	const age = LADDER_MIN_AGE_MS + (ceiling - LADDER_MIN_AGE_MS) * t * t;
	return hcNow.getTime() - age;
}

/**
 * A FILLER commit's own date — the 0-1 extra commit `buildRange` bundles
 * ahead of a transition's own headline (see that function's own note). It
 * has to land strictly BETWEEN the previous ladder step's own date and this
 * one's, never equal to either (a filler dated exactly on the headline
 * commit's own instant would print two commits at the identical timestamp,
 * and one dated at or before the PREVIOUS step's instant would un-do this
 * whole file's monotonic guarantee for the sake of one bundled commit).
 * Capped at a 2h look-back (or half the real gap, whichever is smaller) —
 * `ladderCommitDateMs`'s own smallest gap between adjacent steps is several
 * hours (see its own doc comment), so this always has room.
 */
function fillerCommitDateMs(prevMs: number, thisMs: number, seed: string): number {
	const gap = Math.max(0, thisMs - prevMs);
	const maxBack = Math.min(Math.max(0, gap - 60_000), 2 * 3_600_000);
	if (maxBack <= 0) return thisMs;
	const back = (hashStr(seed) % maxBack) + 60_000;
	return thisMs - Math.min(back, gap - 1);
}

// ── AVATARS — DATA URIS, NEVER A NETWORK FETCH ───────────────────────────
//
// The static demo build kuberik.com embeds has no backend and no network at
// all: an `https://avatars.githubusercontent.com/...` `<img src>` would just
// hang or show a broken-image icon on every load, on every screen the film
// visits (the navbar chip, the commits rollup, every change row's author).
// A `data:image/svg+xml` URI is a self-contained image with no request to
// make — chosen over shipping a static PNG asset because it is generated per
// author from ONE function, so every one of the ~8 demo authors gets a
// distinct, deterministic initial-in-a-circle avatar without adding files.

// ⭐ (2026-10-11, dialogs AD round 7 fix) THE PALETTE LIVES IN
// `../avatar-colors.ts` NOW — shared with `Avatar.svelte`'s own no-`src`
// fallback, so a demo author drawn here and a real person with no GitHub
// picture render as the identical filled disc (same hash, same hues). That
// file's own doc comment has the full story, including why the OLD
// hand-picked list here (`#261386` navy among them) failed both of its
// constraints — too close to a status/env hue AND too dark for its white
// initial to clear 3:1 contrast on the dark card.
function avatarDataUri(name: string, forceColor?: string): string {
	const color = forceColor ?? avatarColor(name);
	const initial = (name.replace(/[^a-zA-Z]/g, '')[0] ?? '?').toUpperCase();
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">` +
		`<rect width="64" height="64" rx="32" fill="${color}"/>` +
		`<text x="32" y="43" font-family="system-ui,-apple-system,sans-serif" font-size="28" ` +
		`font-weight="600" fill="#fff" text-anchor="middle">${initial}</text></svg>`;
	return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// ── THE DEMO IDENTITY ─────────────────────────────────────────────────────

/**
 * ⭐ THE CONNECTED USER IS A REAL PERSON. (2026-09-18, the owner's own ask.)
 *
 * Every screen the film opens shows this login in the navbar chip and as the
 * author of the changes the demo calls "yours", and an invented persona
 * behind a generated initial-in-a-circle read as a fixture in exactly the
 * frames meant to read as a product somebody uses.
 *
 * The LOGIN is what the product prints, because `GithubStatus` carries a
 * login and no display name — the real backend's `/api/auth/github/status`
 * has none to give, so inventing a `name` field here would be a mock that
 * the product cannot honour.
 *
 * ⛔ The avatar is the account's real picture, embedded — `demo-avatar.ts`
 * has the why. The hashed initial is still what every OTHER author gets;
 * only the signed-in person has a face. (The old `#1d4ed8` forcing, chosen
 * so the one always-on-screen avatar read as the product's own blue, has
 * nothing left to apply to.) */
export const DEMO_LOGIN = 'danielreed';
/** The persona's display name, for the one fixture field that wants a person
 *  rather than an account. (2026-09-28: a stock persona, not the owner's own
 *  account — demo-avatar.ts has the picture and the reason.) */
export const DEMO_PERSON = 'Daniel Reed';
const DEMO_AVATAR = DEMO_AVATAR_DATA_URI;

/** The signed-in person's commits carry their real face, like every other
 *  surface that names them; everyone else keeps the generated initial. One
 *  function so a new author-rendering call site cannot pick the wrong one.
 *  (The product-facing version of this same rule — a bare login resolving
 *  to the SIGNED-IN account's photo wherever one is drawn — is
 *  `lib/github-avatar.ts`'s `avatarForLogin`, qa11 2026-10-11.) */
export function avatarFor(login: string): string {
	return login === DEMO_LOGIN ? DEMO_AVATAR : avatarDataUri(login);
}

/**
 * ⭐ (2026-10-10, squad-changes demo-data trim) NEVER THE VIEWER. This used
 * to include `DEMO_LOGIN` and let a ~1-in-8 `pick()` roll hand the viewer
 * authorship on top of the separate flat probability every call site also
 * rolled — the two compounded to 68 of 102 demo changes reading as
 * `danielreed`'s own, which made "/changes" > "Your changes" ("29 of 41 not
 * everywhere") read as the whole feed, not a slice of it. The viewer's
 * authorship is now ENTIRELY decided by `VIEWER_AUTHORED` (below) — pinned,
 * not hashed — so this pool is the complete roster for every OTHER author,
 * and never needs a separate "was it the viewer" check at any call site.
 * Every name is Western, matching `DEMO_PERSON`'s own roster convention.
 */
const AUTHORS = [
	'sam-oliver',
	'jmatthews',
	'mark-collins',
	'paul-stevens',
	'nick-keller',
	'anna-ward',
	'tom-becker'
] as const;

const FILLER_MESSAGES = [
	'Update dependency lockfile',
	'Fix lint warnings',
	'Add missing test coverage',
	'Refactor internal helper for clarity',
	'Update README',
	'Tidy up error messages',
	'Bump CI runner image'
] as const;

// ── PER-APP FIXTURES ──────────────────────────────────────────────────────
//
// One `AppFixture` per rollout name the mock fleet runs (`mock-data.ts`'s own
// `ROLLOUT_NAME`/`FLEET`/`HF_APP`/`MR_APP`/`EM_APP`/`CK_APP`/`DEP_APP`/
// `SA_APP`). `ladder` is oldest→newest, copied from that file's own release
// ordering; `headline(idx)` names the human commit that shipped `ladder[idx]`
// (idx ≥ 1 — there is no "commit that produced" the ladder's first entry,
// only ones that produced every step after it).

type AppFixture = {
	owner: string;
	repo: string;
	ladder: string[];
	headline: (idx: number) => string;
	/**
	 * ⭐ ROUND 5 QA-5, ITEM 2 (TL, dead build links) — tags a real environment
	 * deploys that are DELIBERATELY NOT on `ladder` at all. `mock-data.ts`'s
	 * `MR_OFF_LINE` is the one existing case: `prod-eu-central` runs it so
	 * that `divergedFromLine` reads it as off the release line entirely, not
	 * merely behind — the whole point is that no later ladder step's
	 * `containedIn` ever lists it. Giving it a `ChangeRecord` of its own
	 * (never inserted into `ladder`, so `respondCommits`/`buildRange` and
	 * every ladder-indexed comparison are unaffected) is what makes its own
	 * `/changes` page resolve instead of 404ing — the orphan nature is the
	 * fixture's STORY, not a reason to leave the link dead.
	 */
	orphans?: string[];
	/**
	 * ⭐ (2026-10-09, TL request) The title for `ladder[0]`'s own
	 * `ChangeRecord` — the root commit `landmarkChanges` synthesizes below,
	 * since `headline(idx)` is only ever defined for `idx ≥ 1` (see that
	 * field's own comment). Without this, the record fell back to
	 * `` `Deploy ${ladder[0]}` `` — a placeholder-looking title (e.g. "Deploy
	 * b3c4d5e") that reads as unfinished fixture data rather than a real
	 * commit. Defaults to "Initial commit" when an app has nothing more
	 * specific to say.
	 */
	rootTitle?: string;
	/** `true` for `curated()` (one hand-written title per ladder step, no two
	 *  steps sharing a sentence by construction), `false` for `pooled()`
	 *  (picked from a small pool, which can repeat across enough steps —
	 *  `github-data.test.ts`'s own chronology/no-duplicate-titles census
	 *  scopes itself to the apps this is true for, the ones the AD's own
	 *  "every curated rollout" actually named). */
	curated: boolean;
	/** Every ladder step lands via a PR (hello-waves: the stepped story's change needs a stable PR number). */
	allPr?: boolean;
	/**
	 * (squad-rollout diff, AD round 7, 2026-10-11) Caps how old any ladder
	 * step AFTER the root may be. `ladderCommitDateMs` spreads a long ladder
	 * over 45 days, but checkout-edge's scaffold (`ladder[0]`) was first
	 * deployed ~30 days ago (`HF_LANES` prod history), so its later steps read
	 * as commits merged before the app ever ran anywhere. The root keeps its
	 * own (older) date: the scaffold commit predates its first deploy.
	 */
	stepWindowMs?: number;
};

function curated(
	owner: string,
	repo: string,
	ladder: string[],
	headlines: string[],
	orphans?: string[],
	rootTitle?: string
): AppFixture {
	return {
		owner,
		repo,
		ladder,
		headline: (idx) => headlines[idx - 1] ?? `Deploy ${ladder[idx]}`,
		orphans,
		rootTitle,
		curated: true
	};
}

function pooled(
	owner: string,
	repo: string,
	ladder: string[],
	pool: readonly string[],
	orphans?: string[],
	rootTitle?: string,
	/** sha -> its own title, for a build the hash-pick would give a title another build in the
	 *  ladder already has (payments-core c0d3e88 and f4a2c19 both drew "partial refunds"). */
	titleOverrides?: Record<string, string>
): AppFixture {
	return {
		owner,
		repo,
		ladder,
		headline: (idx) => titleOverrides?.[ladder[idx]] ?? pick(pool, `${repo}-${ladder[idx]}-headline`),
		orphans,
		rootTitle,
		curated: false
	};
}

const OWNER = 'exampleco';

const APPS: Record<string, AppFixture> = {
	'hello-world': curated(
		OWNER,
		'hello-world',
		// ⭐ `e2c9b47` IS THE NEWER BUILD THE DEMO DEPLOYS (state.ts's
		// `buildHwDetail`). Without it on the ladder the deploy dialog — the
		// one a film records — headlines the change `Release commit for build
		// e2c9b47`, the fallback for a build this fixture has never heard of.
		['b3c4d5e', '7c8d9e0', 'e4f5a6b', 'a1b2c3d', 'f68d0ac', 'e2c9b47'],
		[
			'Add health check endpoint and readiness probe',
			'Fix database connection pooling',
			'Add /metrics endpoint for prometheus scraping',
			'Bump base image to node:20-alpine and tune GC settings',
			'Cache product lookups for 60s and halve p99 on the catalogue page'
		],
		undefined,
		// Matches `mock-data.ts`'s own history entry for this sha (`message:
		// 'Initial release'`) — the two must agree, since both describe the
		// same commit.
		'Initial release'
	),
	'orders-api': curated(
		OWNER,
		'orders-api',
		['7d2918a', '01ab7c9', '7c14e2a', 'e936e6f'],
		[
			'Add pagination to orders list endpoint',
			'Fix decimal rounding in order totals',
			'Add idempotency key support to order creation'
		]
	),
	/**
	 * ⭐ (2026-10-10, truth-bug fix) THE TWO TITLES BELOW ARE NOT ARBITRARY —
	 * they have to agree with `respond.ts`'s own `CW_MANIFESTS` (the diff
	 * page's actual YAML for this pair): `a02f1c4`'s manifest ADDS a
	 * `PAYMENT_WEBHOOK_RETRY_BUDGET` env var over `3f1ed09`'s, so "Add retry
	 * budget to payment webhook" is the one title that line is actually
	 * about. This repo used to have TWO independent, disagreeing guesses at
	 * this commit's title (this file's old headline, "Add dead-letter queue
	 * for failed checkout events", and `mock-data.ts`'s/`mock-details.ts`'s
	 * now-deleted `commitMessage` field, "Add retry budget to payment
	 * webhook") — this file is the one place left, so it has to be the one
	 * that is actually true of the diff.
	 */
	'checkout-worker': curated(
		OWNER,
		'checkout-worker',
		['3f1ed09', 'a02f1c4'],
		['Add retry budget to payment webhook'],
		undefined,
		'Bump connection pool size'
	),
	'checkout-api': curated(
		OWNER,
		'checkout-api',
		['b-40', 'b-41', 'b-42', 'b-43', 'b-44', 'b-45'],
		[
			'Add support for split payments',
			'Fix inventory hold expiry race',
			'Improve checkout session validation',
			'Add support for saved payment methods',
			'Fix tax calculation for EU regions'
		],
		undefined,
		// ⭐ (2026-10-11, AD round 6, item 4) `b-40`/`4.40.0-40` — the generic
		// `curated()` default ("Initial commit") read as a placeholder on the
		// one surface (`unknownRangeResponse`'s root fallback, above) that
		// shows it with nothing else on the row to say which app it belongs
		// to.
		'Initial checkout-api release'
	),
	'hello-frontend-app': curated(
		OWNER,
		'hello-frontend-app',
		['rel-2', 'rel-63', 'rel-64', 'rel-66'],
		[
			'Bump API contract to 2.63.0',
			'Fix loading state flash on slow networks',
			'Improve accessibility of nav menu'
		]
	),
	'standalone-api': curated(
		OWNER,
		'standalone-api',
		['s-10', 's-11', 's-12'],
		['Add ledger reconciliation job', 'Fix off-by-one in balance calculation']
	),
	'recommender-svc': curated(
		OWNER,
		'recommender-svc',
		['88c0e51', '4b9c2e1'],
		['Retrain ranking model on latest interaction data']
	),
	/**
	 * ⭐ (2026-10-10, truth-bug fix) WAS `pooled()`. Picking a headline by
	 * `hash(sha) % 6` across 25 ladder steps GUARANTEES collisions by the
	 * pigeonhole principle alone — confirmed live: "Fix CORS headers for
	 * mobile app origin" and "Add rate limiting per API key" each landed on
	 * two different shas, so the commits list under a wide compare printed
	 * the same sentence twice and `/changes` carried two unrelated rows with
	 * one title. `mock-data.ts`'s now-deleted `HF_COMMIT_TITLES` already had
	 * 25 distinct, hand-written titles for this exact ladder (one per sha,
	 * no repeats, several tied to this app's own incident narrative —
	 * `62d1c05`'s "retry budget" is deliberately the build `prod`'s Failed
	 * entry runs) — curated here instead of re-inventing a second set, so
	 * every surface that used to read `HF_COMMIT_TITLES` keeps the exact
	 * sentence it already showed.
	 */
	'checkout-edge': {
		...curated(
			OWNER,
			'checkout-edge',
			[
				'2c8b409',
				'3e9d780',
				'55f1a2c',
				'c3a9f22',
				'b7e0d41',
				'd09e6f4',
				'62d1c05',
				'ae40b18',
				'77ac9e3',
				'1b7fe25',
				'93c04da',
				'e8a52f7',
				'0d6c31b',
				'5c7b2da',
				'81e3f09',
				'cb18a4e',
				'36fd2b1',
				'a07e5c8',
				'bd94f13',
				'20b6d7f',
				'e51c9a4',
				'7f38e0d',
				'c62a913',
				'4d0b7e8',
				'9a1f4c2'
			],
			[
				'Add dark mode support to checkout widget', // 3e9d780
				'Bump dependency lockfile', // 55f1a2c
				'Fix pagination bug in order history', // c3a9f22
				'Add edge cache warmup job', // b7e0d41
				'Reduce checkout latency further', // d09e6f4
				// ⭐ (2026-10-11, AD round 6, item 3) WAS "Add retry budget to
				// payment webhook" — THE EXACT TITLE `checkout-worker`'s own
				// `a02f1c4` already carries (two steps up this file). Different
				// repo, different commit, same sentence — a reader who has seen
				// the incident scenario's `a02f1c4` and then opens the calm
				// scenario's `62d1c05` would read the identical cause for two
				// unrelated builds. Kept the "retry budget" theme (this IS still
				// the build `prod`'s inserted Failed entry runs — the incident
				// still reads as caused by the change it names) but named a
				// different target, so the two sentences no longer collide.
				'Add retry budget to the edge proxy', // 62d1c05
				'Tune connection pool size', // ae40b18
				'Add request tracing headers', // 77ac9e3
				'Fix memory leak in session cache', // 1b7fe25
				'Add feature flag for express checkout', // 93c04da
				'Fix currency rounding in cart summary', // e8a52f7
				'Add rate limiting to checkout endpoint', // 0d6c31b
				'Bump node runtime to 20', // 5c7b2da
				'Add idempotency key to checkout API', // 81e3f09
				'Fix flaky health check timeout', // cb18a4e
				'Reduce checkout latency p99', // 36fd2b1
				'Add circuit breaker for payments-svc calls', // a07e5c8
				'Upgrade otel collector sidecar', // bd94f13
				'Remove deprecated discount code path', // 20b6d7f
				'Add structured logging to checkout handler', // e51c9a4
				'Tune edge cache TTL for checkout flow', // 7f38e0d
				'Fix off-by-one in cart totals', // c62a913
				'Bump go to 1.23', // 4d0b7e8
				'Add retry budget to payment client' // 9a1f4c2
			],
			undefined,
			// ⭐ ladder[0] (`2c8b409`) never gets a `headline(idx)` call (idx ≥ 1
			// only) — this is `HF_COMMIT_TITLES['2c8b409']`'s own title, kept
			// unchanged.
			'Initial checkout-edge scaffold'
		),
		// Scaffold first deployed ~30d ago: later steps stay inside 28d.
		stepWindowMs: 28 * 86_400_000
	},
	'payments-core': pooled(
		OWNER,
		'payments-core',
		[
			'47f0c6a',
			'b58a7d1',
			'3c92e04',
			'8ad1f57',
			'e6b4d92',
			'71ce0b3',
			'2a55f0c',
			'9b7e410',
			'c0d3e88',
			'f4a2c19'
		],
		[
			'Add support for 3DS2 authentication',
			'Fix currency rounding for JPY transactions',
			'Add webhook signature verification',
			'Improve idempotency for refund requests',
			'Add support for partial refunds',
			'Fix race condition in ledger reconciliation'
		],
		// `mock-data.ts`'s `MR_OFF_LINE` — see `AppFixture.orphans`'s own note.
		['d0ff17e'],
		undefined,
		// r34 tabs-nb r3 (#7): c0d3e88 drew f4a2c19's title from the pool.
		{ c0d3e88: 'Fix partial refund rounding' }
	),
	'edge-mesh': pooled(
		OWNER,
		'edge-mesh',
		['cf03e2d', '16d8b70', 'a92c6f4', '5e1a903'],
		[
			'Add regional failover for mesh sidecars',
			'Tune mTLS handshake timeout',
			'Fix mesh config drift detection',
			'Add per-region traffic shaping'
		]
	),
	/**
	 * `hello-waves-app` (FIXTURE E, the sites-and-waves demo) — the repo its Rollouts' `status.source`
	 * already names. c6f19d2 is the change the stepped story `/api/demo/waves?step=` walks
	 * (waves-story.ts); 0f1f88a and 4ff7a58 are the older builds the prod sites still run.
	 */
	'hello-waves-app': {
		...curated(
			OWNER,
			'hello-waves',
			['4ff7a58', '0f1f88a', 'c6f19d2'],
			['Add region config to the health endpoint', 'Cache region config at startup']
		),
		allPr: true
	},
	/**
	 * ⭐ DESIGN REVIEW 4, ITEM A (2026-10-09, TL "GO" decision, changes-slug
	 * lane) — THE ONE REPO FOUR SERVICES SHARE. Every other entry in this
	 * map is one app, one repo — which is exactly why `LandingGrid`'s own
	 * "≥2 services in one change" render, and its one-fill-per-row rule,
	 * had never been exercised against real demo data (every `/changes/
	 * <repo>/...` page this lane could reach showed "No release for this
	 * commit": the fixture's own shas never matched any rollout's own
	 * `availableReleases`/`history` revision for any app but `hello-world`,
	 * confirmed live against `payments-core`/`checkout-worker`/etc. before
	 * adding this).
	 *
	 * `platform-telemetry` is a NEW repo, ADDITIVE — no existing app's own
	 * repo or ladder changes. Four BRAND NEW rollout identities
	 * (`telemetry-collector`/`-forwarder`/`-indexer`/`-worker`, below in
	 * `mock-data.ts`'s `mockFleetRollouts`) consume it, never reusing an
	 * existing app's name, so nothing already on the fleet (Home's counts,
	 * the gate story, `deps-story.ts`, the incident's own checkout-worker
	 * failure, hello-world's promote/rollback engine, or any rollout the
	 * landing film's own capture scripts open) changes shape.
	 */
	'platform-telemetry': curated(
		OWNER,
		'platform-telemetry',
		['7b3c9f1', '4a8d2e6'],
		['Bump the shared platform-telemetry client to v3']
	)
};

/**
 * FIXTURES F and G (release-switch-fixtures.ts), OPT-IN: not in `APPS`, so with the flag off every route answers as it did without them.
 * `setReleaseSwitchApps(true)` (called by `setReleaseSwitchFixtures`) adds them to the changes feed and the commit ranges.
 */
const RELEASE_SWITCH_GH: Record<string, AppFixture> = {
	/** FIXTURE F (release-switch-fixtures.ts): semver builds, three releases in flight. */
	'ledger-api': curated(
		OWNER,
		'ledger-api',
		['ad-40', 'ad-41', 'ad-42', 'ad-43', 'ad-44', 'ad-45', 'ad-46'],
		['Add idempotency keys to ledger writes', 'Fix double-entry rounding on multi-currency posts', 'Batch settlement exports by account', 'Add audit trail for manual adjustments', 'Cap statement pagination at 500 rows', 'Fix stale balance read after reversal'],
		undefined,
		'Initial ledger-api release'
	),
	/** FIXTURE G (release-switch-fixtures.ts): twenty semver builds, seventeen in flight. */
	'search-web': curated(
		OWNER,
		'search-web',
		['ce-01', 'ce-02', 'ce-03', 'ce-04', 'ce-05', 'ce-06', 'ce-07', 'ce-08', 'ce-09', 'ce-10', 'ce-11', 'ce-12', 'ce-13', 'ce-14', 'ce-15', 'ce-16', 'ce-17', 'ce-18', 'ce-19', 'ce-20'],
		['Add query suggestions to the search box', 'Fix pagination reset on filter change', 'Debounce the search input', 'Highlight matched terms in results', 'Add keyboard navigation to the result list', 'Fix empty state flash on slow networks', 'Persist the selected facet in the URL', 'Add synonym support for product names', 'Fix mobile filter drawer scroll lock', 'Cache facet counts for 30s', 'Add did-you-mean for misspelled queries', 'Fix result ordering for ties', 'Add category breadcrumbs to results', 'Lazy load result thumbnails', 'Fix focus loss after clearing the query', 'Add recent searches', 'Tune ranking for in-stock items', 'Fix RTL layout of the filter bar', 'Add search analytics events'],
		undefined,
		'Initial search-web release'
	)
};
let releaseSwitchOn = false;
const appOf = (name: string): AppFixture | undefined => APPS[name] ?? (releaseSwitchOn ? RELEASE_SWITCH_GH[name] : undefined);
const activeApps = (): AppFixture[] => (releaseSwitchOn ? [...Object.values(APPS), ...Object.values(RELEASE_SWITCH_GH)] : Object.values(APPS));

/**
 * Test-only: the rollout `name` (the same string a `/api/rollouts/:ns/:name/
 * commits` URL carries) for every app this file curates — i.e. every
 * `ladder` step has its OWN hand-written title, not one picked from a
 * shared pool. `github-data.test.ts`'s own chronology/no-duplicate-titles
 * census walks these; nothing in the product itself should import this —
 * `respondGithub` is the one entry point everything else uses.
 */
export const CURATED_ROLLOUT_NAMES: readonly string[] = Object.entries(APPS)
	.filter(([, app]) => app.curated)
	.map(([name]) => name);

/** Test-only: `name` → its full oldest→newest ladder, for the same curated
 *  apps `CURATED_ROLLOUT_NAMES` lists — what `github-data.test.ts` walks to
 *  build every consecutive-pair and root→newest compare request. */
export const CURATED_LADDERS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
	CURATED_ROLLOUT_NAMES.map((name) => [name, APPS[name].ladder])
);

// ── /api/auth/github/status ───────────────────────────────────────────────

function respondGithubStatus(): GithubMockResult {
	const status: GithubStatus = {
		configured: true,
		connected: true,
		login: DEMO_LOGIN,
		avatarUrl: DEMO_AVATAR
	};
	return json(status);
}

// ── /api/rollouts/:namespace/:name/commits ────────────────────────────────

/**
 * Changes the signed-in viewer wrote, pinned rather than hashed, so "your
 * changes" carries the states that matter most (squad-changes AD round 2: no
 * scenario ever gave the viewer a blocked change) WITHOUT the viewer owning
 * most of the demo's changes (squad-changes demo-data trim, 2026-10-10 — see
 * `AUTHORS`'s own note: this set is now the ONLY source of viewer
 * authorship, nothing hashed on top of it).
 *
 * a02f1c4 is the checkout-worker build that FAILS in staging in incident
 * (and wide); 4a8d2e6 is platform-telemetry #20, held for approval in prod
 * in incident, failed in prod in wide (`state.ts`'s `TM_ALWAYS_FAILED_KEY`
 * is the `wide`-only exemption that makes that so — verified live for this
 * round, see `pr20-scenario.test.ts`). The other five spread the remaining
 * viewer changes across five more repos — hello-world, orders-api,
 * checkout-api, hello-frontend-app, recommender-svc — one real ladder step
 * each, so "your changes" reads as a handful of real contributions across
 * the fleet rather than a monoculture. Seven total, well inside the 6-8
 * budget `github-data.viewer-share.test.ts` pins.
 *
 * Authorship is the same in every scenario; the scenario decides the state,
 * so calm Home's Needs you is untouched.
 */
const VIEWER_AUTHORED: ReadonlySet<string> = new Set([
	'a02f1c4',
	'4a8d2e6',
	'a1b2c3d',
	'7c14e2a',
	'b-42',
	'rel-64',
	'4b9c2e1'
]);

/** The one place "is this sha the viewer's" is decided — see
 *  `VIEWER_AUTHORED`'s own doc for why nothing else may assign `DEMO_LOGIN`. */
function authorForSha(sha: string, seed: string): string {
	return VIEWER_AUTHORED.has(sha) ? DEMO_LOGIN : pick(AUTHORS, seed);
}

/**
 * ⭐ (2026-10-11, squad-changes "Median merge→prod" fix; revised 2026-10-12
 * per QA — see below) A HANDFUL OF SHAS MUST MERGE JUST BEFORE THEIR OWN
 * FIRST DEPLOY, NOT DAYS BEFORE IT (or, for a few, long enough BEFORE a
 * much-later one that a bake-time gap in between stays plausible).
 * `landmarkChanges`' generic `mergedAtMs` formula ages a change by its
 * LADDER POSITION alone (older position ⇒ merged longer ago), which has
 * nothing to do with when any particular environment actually deployed it.
 * For most ladder steps that's harmless — nobody reads one change's own
 * merge→prod span in isolation, or checks that a deploy never predates its
 * own merge — but two things DO read exactly that: `changesSummary`'s
 * "Median merge→prod" KPI (`/changes`) over the VIEWER's own changes, and
 * `github-data.merge-order.test.ts`'s own causality invariant over the
 * WHOLE feed. Pinned here, keyed by sha, read by `landmarkChanges` INSTEAD
 * of the generic formula.
 *
 * ⛔ `7c14e2a` WAS PINNED TO A FLAT "100 MINUTES AGO" (2026-10-11). QA's
 * probe caught the result: `FLEET`'s own `orders-api/staging` entry has
 * ALREADY been running this exact build for `22 * 60` minutes
 * (`deployedAgoMin`, `mock-data.ts`) — a build cannot be deployed 22 hours
 * before the commit that produced it merges. Pinned here BEFORE that
 * deploy instead (22h15m ago), which also fixes `e936e6f` (orders-api's
 * NEXT ladder step, `#90`, deployed to `orders-api/dev` 4h12m ago per the
 * SAME `FLEET` entry) the same way — pinned a little before ITS OWN first
 * deploy, and (necessarily, since it is the later ladder step) after
 * `7c14e2a`'s own pin.
 *
 * ⚠️ NOT HARMLESS EVERYWHERE, IT TURNS OUT (2026-10-11, requirement A's own
 * repo-by-repo audit). `checkout-edge`/`payments-core`/`edge-mesh` ("pooled"
 * apps, `HF_BUILDS`/`MR_BUILDS`/`EM_BUILDS`) hand-author their OWN real
 * build-creation clock, completely independent of this generic
 * ladder-position formula — and `firstProdLeadMs`'s own fix (requirement A)
 * is PROVEN exactly often enough on these apps' dense, closely-packed
 * history to surface the mismatch: a build created 3-15 days ago (the real
 * clock) paired with a "merged 20+ days ago" guess (this formula, which has
 * never heard of that clock) prints a "typical to prod" of hundreds of
 * hours — `edge-mesh` 302h, `payments-core` 311h, `checkout-edge` 501h,
 * every one of them implausible against the SAME app's own deploy ages.
 * `REAL_BUILD_CREATED_MIN_AGO` below is the general fix: wherever a ladder
 * sha's own real creation minute is known, read it instead of guessing.
 */
const EXPLICIT_MERGE_MINUTES_AGO: Readonly<Record<string, number>> = {
	// orders-api#89 (the viewer's own change) — `orders-api/staging` has run
	// this build for `22 * 60` = 1320 minutes (`FLEET`, `mock-data.ts`);
	// pinned 15 minutes before that. Lead to `orders-api/prod` (deployed 2
	// minutes ago, the SAME `FLEET`) reads ~22h, a plausible "baked in
	// staging most of a day before promoting" story, not the old ~1.6h.
	'7c14e2a': 22 * 60 + 15,
	// orders-api#90 — `e936e6f` is the ladder step AFTER `7c14e2a`, deployed
	// to `orders-api/dev` 4h12m (252 min) ago (the SAME `FLEET` entry).
	// Pinned 15 minutes before THAT deploy — after `7c14e2a`'s own pin
	// above, as ladder order requires (`floorMs`'s own clamp holds this
	// even if the two numbers here were ever edited out of order).
	e936e6f: 252 + 15,
	// recommender-svc#28 — `recommender-svc/dev` has run `4b9c2e1` for 6h
	// (`FLEET`, `mock-data.ts`), exactly the generic curve's newest-step age,
	// so the merge tied with the deploy instant. Pinned 15 minutes before it.
	'4b9c2e1': 6 * 60 + 15,
	// hello-world-prod's own head is `a1b2c3d`, deployed `hcAgo(120)`
	// (`mock-promote.ts`'s `HW_CURRENT.prod`) — merge 160 minutes ago reads
	// as a ~40-minute merge→prod lead.
	//
	// ⛔ WAS `160` (2026-10-11). Upstream's `demo/chain-order` fix
	// (`mock-promote.ts`) gives EVERY env a previous-version history
	// entry via the SAME `hcAgo(ago[env] + 6*60)` formula — `staging`'s
	// own entry for THIS exact sha (`HW_PREVIOUS.staging`, which must stay
	// `a1b2c3d`: `chain-order.test.ts`'s rule 1 requires prod's current
	// build to appear in staging's own history) lands ~385 minutes ago,
	// 225 minutes before a `160`-minutes-ago merge could have produced it
	// — caught by `github-data.merge-order.test.ts`'s causality pass.
	// Pinned past that deploy instead (`385 + 15`).
	a1b2c3d: 400,
	// ⭐ (2026-10-12, QA causality pass). The REST of `hello-world`'s ladder
	// has its OWN real build clock too — `mock-data.ts`'s `FIXTURES`
	// `default/hello-world` dev history (NOT `REAL_BUILD_CREATED_MIN_AGO`,
	// which only covers the three "pooled" apps) — and until this pass only
	// `a1b2c3d` read it. Without these, the gap between `mock-promote.ts`'s
	// `prod`/`staging` history entries and `e4f5a6b`'s own containedIn
	// (which includes `a1b2c3d`) let `e4f5a6b` inherit a PROVEN prod
	// landing too — correctly, since `a1b2c3d` genuinely does carry it —
	// but at whatever absurd age the generic ladder-position formula
	// guessed (15-17 days) rather than its own real one. Each pinned a
	// short stretch before the OLDEST real deploy of it anywhere:
	// `7c8d9e0` Succeeded 24h (1440m) ago in DEV, but `mock-promote.ts`'s
	// own `prod` backfill entry for this exact sha is timestamped even
	// OLDER (27h/1620m ago) — the pin must predate THAT. `e4f5a6b` Failed
	// 5h (300m) ago in dev, but (being ladder-earlier than `a1b2c3d`, and
	// so carried by the SAME `staging`/`prod` entries that carry it) must
	// also predate `a1b2c3d`'s own pin below. `f68d0ac` Succeeded 16m ago
	// (dev's current), `e2c9b47` created 5m ago (`HW_RELEASES`, dev's own
	// queued build).
	'7c8d9e0': 1620 + 15,
	e4f5a6b: 420,
	f68d0ac: 16 + 10,
	e2c9b47: 5 + 10
};

/**
 * ONE COMMIT DATE PER (repo, ladder step) — read by `buildRange`'s
 * `makeCommit` AND `landmarkChanges`' `mergedAtMs`, so a commit printed in a
 * compare range and the same commit in the `/changes` feed carry the same
 * instant. The generic curve is `genericLadderDateMs` (monotonic in ladder
 * position, AD round 6); the causality pins WIN wherever they apply:
 * `EXPLICIT_MERGE_MINUTES_AGO`, then `REAL_BUILD_CREATED_MIN_AGO` (a merge
 * 5-45 min before the build's real creation), then
 * `FLEET_BACKFILL_DEEPEST_MIN_AGO` (a floor: only ever makes it older), and
 * finally a running floor keeps each step strictly after the previous one
 * (ladder order is containment order). The root is at least 31 days old so
 * it predates `DENSITY_LANES`' deepest backfill of that same sha, but is
 * never younger-looking than the generic curve says.
 */
const ladderDatesCache = new WeakMap<AppFixture, number[]>();
function ladderDatesFor(app: AppFixture): number[] {
	const hit = ladderDatesCache.get(app);
	if (hit) return hit;
	const out: number[] = [];
	for (let i = 0; i < app.ladder.length; i++) {
		const sha = app.ladder[i];
		let ms: number;
		if (i === 0) {
			const seed = `${app.repo}-${sha}-root`;
			const ageDays = Math.max(0, 31 + (hashStr(seed + 'age') % 4));
			const pinned = hcNow.getTime() - ageDays * 86_400_000 - (hashStr(seed + 'h') % 86_400_000);
			ms = Math.min(pinned, genericLadderDateMs(app, 0));
		} else {
			const seed = `${app.repo}-${sha}`;
			const realCreatedMinAgo = REAL_BUILD_CREATED_MIN_AGO.get(sha);
			ms = EXPLICIT_MERGE_MINUTES_AGO[sha]
				? hcNow.getTime() - EXPLICIT_MERGE_MINUTES_AGO[sha] * 60_000
				: realCreatedMinAgo != null
					? hcNow.getTime() - (realCreatedMinAgo + 5 + (hashStr(seed + 'buildlag') % 40)) * 60_000
					: genericLadderDateMs(app, i);
			const deepest = FLEET_BACKFILL_DEEPEST_MIN_AGO.get(sha);
			if (deepest != null) ms = Math.min(ms, hcNow.getTime() - (deepest + 60) * 60_000);
			ms = Math.max(ms, out[i - 1] + 60_000);
		}
		out.push(ms);
	}
	ladderDatesCache.set(app, out);
	return out;
}

function ladderCommitDateMs(app: AppFixture, idx: number): number {
	return ladderDatesFor(app)[idx] ?? genericLadderDateMs(app, idx);
}

/**
 * ⭐ (2026-10-11, squad-changes "Median merge→prod" fix, requirement A). The
 * "pooled" high-frequency fixtures (`checkout-edge`, `payments-core`,
 * `edge-mesh`) each hand-author their OWN build-creation clock —
 * `HF_BUILDS`/`MR_BUILDS`(+`MR_OFF_LINE`)/`EM_BUILDS`, every one `[sha,
 * createdMinutesAgo]` — which is also the clock their deploy LANES
 * (`HF_LANES`/`MR_LANES`/edge-mesh's own) stamp `status.history` from. A
 * ladder sha with a known entry here merges a short, plausible stretch
 * BEFORE its own real creation minute (deterministic 5-45m jitter — these
 * are busy, frequently-deploying apps; a build follows its merge by
 * minutes, not days) instead of the generic ageDays formula below, which
 * was tuned for the CURATED apps that have no such clock and MUST guess.
 * Every ladder sha outside these three fixtures (every `curated` app) is
 * unaffected — this map simply has no entry for them.
 */
const REAL_BUILD_CREATED_MIN_AGO: ReadonlyMap<string, number> = new Map<string, number>([
	...HF_BUILDS,
	...MR_BUILDS,
	MR_OFF_LINE,
	...EM_BUILDS
]);

/**
 * ⭐ (2026-10-11, AD round 6) NO PLACEHOLDER SHAS. Most apps' ladder tags
 * already look like a real git sha (`a02f1c4`, `2c8b409`) — a handful use a
 * human release tag instead (`checkout-api`'s `b-43`, `standalone-api`'s
 * `s-10`, `hello-frontend-app`'s `rel-2`), which is the right BUILD
 * identifier (`getDisplayVersion` turns it into "4.43.0-43" everywhere a
 * build is named) and the wrong COMMIT sha — an art director found `b-43`
 * printed as if it were one. `expandSha` already derives a stable 40-char
 * hex per tag for the revision-matching machinery below (`identifiersFor`);
 * this reuses it, sliced to the usual 7, for DISPLAY ONLY — every matching
 * function (`refMatches`/`identifiersFor`) still keys off the RAW tag, so
 * this never touches lookups, only what a response prints as a commit's own
 * id. */
const HEX_SHA_RE = /^[0-9a-f]{7,40}$/i;
function commitShaFor(tag: string): string {
	return HEX_SHA_RE.test(tag) ? tag : expandSha(tag).slice(0, 7);
}

function makeCommit(
	owner: string,
	repo: string,
	message: string,
	sha: string,
	dateMs: number
): CommitInfo {
	const author = authorForSha(sha, `${sha}-${message}`);
	const displaySha = commitShaFor(sha);
	return {
		sha: displaySha,
		message,
		author,
		authorUrl: `https://github.com/${author}`,
		avatarUrl: avatarFor(author),
		commitDate: new Date(dateMs).toISOString(),
		url: `https://github.com/${owner}/${repo}/commit/${displaySha}`
	};
}

function sameCommitsResponse(): CommitsResponse {
	return {
		direction: 'same',
		ahead: 0,
		behind: 0,
		commits: [],
		additions: 0,
		deletions: 0,
		changedFiles: 0
	};
}

/**
 * ⭐ THE HONEST-FALLBACK RULE FOR AN UNKNOWN RANGE. Neither `base` nor `head`
 * (or the app itself) is one this fixture universe recognises — a real range
 * ALWAYS has at least the one commit that produced `head`, and the only
 * honest thing to say about its ancestry, not knowing it, is exactly that:
 * one commit, forward, non-empty. Never a 404/500 (the range is real even if
 * this fixture can't source it) and never a fabricated multi-commit history
 * (that would be inventing facts this mock has no basis for).
 *
 * ⭐ (2026-10-11, AD round 6, item 4) `head` STILL NAMES A REAL ROOT. A range
 * that could not be resolved because `base` is unknown (no older build to
 * diff against — a rollout's very first deploy) is exactly the
 * `rootPairIndices`/bare-single-sha-lookup case `build-title.ts` already
 * names on the frontend; this is the SAME case on the mock's own side. When
 * `head` is a known app's `ladder[0]`, this answers with that build's real
 * `rootTitle` instead of the generic "Release commit for build X" — the gap
 * that left `checkout-edge`'s `2c8b409` and `checkout-api`'s `b-40`
 * (`4.40.0-40`) titleless on any surface that only ever calls the RANGE
 * endpoint, never the bare one.
 */
function unknownRangeResponse(base: string, head: string, app?: AppFixture): CommitsResponse {
	const owner = app?.owner ?? OWNER;
	const repo = app?.repo ?? 'unknown-service';
	const stat = transitionStat(`${base}-${head}-unknown`);
	const shortHead = (head || 'unknown').slice(0, 7);
	const isRoot = !!app && app.ladder.length > 0 && refMatches(app.repo, app.ladder[0], head || '');
	/* r34 rollouts r6 T5 (ONE TITLE PER SHA): a build whose range cannot be resolved (no older build to diff against: a11c202, 4a8d2e6, a11c909) used to headline
	   the generic "Release commit for build X" while the bare-commit route (`respondCommit`) named it from the same ALL_CHANGES record. The record wins here too. */
	const known = !isRoot && head ? ALL_CHANGES.find((c) => c.owner === owner && c.repo === repo && (refMatches(repo, c.mergeCommitSha, head) || refMatches(repo, c.headSha, head))) : undefined;
	const message = isRoot
		? (app!.rootTitle ?? 'Initial commit')
		: known ? known.title : `Release commit for build ${shortHead}`;
	const sha = head || synthSha(base + head);
	const dateMs = isRoot
		? ladderCommitDateMs(app!, 0)
		: fallbackCommitDateMs(`${base}-${head}-unknown-date`);
	return {
		direction: 'forward',
		ahead: 1,
		behind: 0,
		commits: [known ? { ...makeCommit(owner, repo, message, sha, dateMs), author: known.author, authorUrl: `https://github.com/${known.author}`, avatarUrl: avatarFor(known.author) } : makeCommit(owner, repo, message, sha, dateMs)],
		additions: stat.add,
		deletions: stat.del,
		changedFiles: stat.filesN
	};
}

function buildRange(
	app: AppFixture,
	loIdx: number,
	hiIdx: number,
	direction: 'forward' | 'rollback'
): CommitsResponse {
	const commits: CommitInfo[] = [];
	let additions = 0;
	let deletions = 0;
	let filesN = 0;
	// ⭐ (2026-10-11, AD round 6) NO TWO FILLER COMMITS IN ONE RANGE SHARE A
	// TITLE. `FILLER_MESSAGES` is one small pool shared by every hop in this
	// range — picking independently per hop can and did repeat a sentence
	// ("Refactor internal helper for clarity" twice over `checkout-api`'s own
	// 5-hop root→newest compare, caught live by `github-data.test.ts`'s own
	// chronology census). Tracked per CALL (one compare request), not
	// globally: the same filler sentence is still free to reappear in a
	// DIFFERENT compare, which is fine — only one range's own list has to
	// read as distinct commits.
	const usedFillerMessages = new Set<string>();
	function pickFillerMessage(seed: string): string {
		const start = hashStr(seed) % FILLER_MESSAGES.length;
		for (let k = 0; k < FILLER_MESSAGES.length; k++) {
			const msg = FILLER_MESSAGES[(start + k) % FILLER_MESSAGES.length];
			if (!usedFillerMessages.has(msg)) {
				usedFillerMessages.add(msg);
				return msg;
			}
		}
		// Every pool entry already used in this range (more fillers than the
		// pool has sentences) — fall back to the hashed pick; a repeat here is
		// the honest answer once the pool is exhausted, not a bug to hide.
		return FILLER_MESSAGES[start];
	}
	for (let i = loIdx + 1; i <= hiIdx; i++) {
		const toSha = app.ladder[i];
		const seed = `${app.repo}-${toSha}`;
		const thisDateMs = ladderCommitDateMs(app, i);
		const prevDateMs = ladderCommitDateMs(app, i - 1);
		// A deploy can bundle more than one commit — 0 or 1 filler commits
		// ahead of the transition's own headline, so a single-hop range still
		// sometimes reads as 2-3 commits rather than always exactly one.
		const fillerCount = hashStr(seed + 'fc') % 2;
		for (let f = 0; f < fillerCount; f++) {
			const fseed = `${seed}-f${f}`;
			commits.push(
				makeCommit(
					app.owner,
					app.repo,
					pickFillerMessage(fseed),
					synthSha(fseed),
					fillerCommitDateMs(prevDateMs, thisDateMs, fseed)
				)
			);
		}
		// ⭐ (2026-10-11, AD round 8, item 2) THE INTERMEDIATE LADDER STEP'S
		// OWN TAG IS NOT ITS COMMIT'S SHA HERE — ONLY THE RANGE'S HEAD IS.
		// `app.ladder[i]` doubles as two different identities in this
		// fixture: a RELEASE TAG (what a deploy's own history row names,
		// `rollout.status.history[k].version.revision`) and, via this loop,
		// "a commit inside SOME OTHER transition's range." A rollout whose
		// deploys don't walk the ladder in strict order (a failed deploy
		// skips ahead, then a rollback lands behind it, then a later deploy
		// catches up — exactly `checkout-edge`'s own `62d1c05` scenario)
		// can have its SKIPPED ladder steps be releases that get their own,
		// separate, fully-detailed history row elsewhere on the very same
		// page. Reusing that row's exact sha as "just a commit" inside a
		// DIFFERENT build's range read as the same build appearing twice —
		// "62d1c05's commit list includes the LATER builds b7e0d41 and
		// d09e6f4." The range's own HEAD (`i === hiIdx`) still must be the
		// real tag (`respondGithub`'s contract — the last commit names the
		// build actually reached, `github-data.test.ts`'s own assertion);
		// every earlier step keeps its real HEADLINE (still the honest
		// description of what that step changed) but gets a synthetic sha,
		// the same `synthSha` the filler commits above already use — never
		// collidable with a real ladder tag.
		const stepSha = i === hiIdx ? toSha : synthSha(`${seed}-step`);
		commits.push(makeCommit(app.owner, app.repo, app.headline(i), stepSha, thisDateMs));
		const stat = transitionStat(seed);
		additions += stat.add;
		deletions += stat.del;
		filesN += stat.filesN;
	}
	const total = commits.length;
	// `commits` is capped at 6 (the task's own "1-6 commits" budget) — kept as
	// the LAST 6 (closest to the compare's own head), the same truncation
	// direction GitHub's real compare API uses. `ahead`/`behind` and the
	// diffstat total the FULL uncapped range, exactly like the real API keeps
	// an exact commit count independent of how many it lists.
	const capped = total > 6 ? commits.slice(-6) : commits;
	return {
		direction,
		ahead: direction === 'forward' ? total : 0,
		behind: direction === 'rollback' ? total : 0,
		commits: capped,
		additions,
		deletions,
		changedFiles: filesN
	};
}

function respondCommits(name: string, base: string, head: string): GithubMockResult {
	const app = appOf(name);
	if (!base || !head) return json(unknownRangeResponse(base, head, app));
	if (base === head) return json(sameCommitsResponse());
	if (!app) return json(unknownRangeResponse(base, head));
	const baseIdx = findLadderIndex(app, base);
	const headIdx = findLadderIndex(app, head);
	if (baseIdx === -1 || headIdx === -1) return json(unknownRangeResponse(base, head, app));
	if (headIdx === baseIdx) return json(sameCommitsResponse());
	if (headIdx > baseIdx) return json(buildRange(app, baseIdx, headIdx, 'forward'));
	return json(buildRange(app, headIdx, baseIdx, 'rollback'));
}

// ── /api/github/changes, /api/github/pulls/:o/:r/:n, commit→pulls ───────
//
// One shared record type feeds all three endpoints, generated ONCE at module
// load: a landmark `Change` for every ladder transition above (so a change
// row and a commits-endpoint compare over the SAME two shas can never
// disagree about what shipped) plus a handful of unrelated "filler" changes
// per repo purely for calendar spread and repo-count volume.

type ChangeRecord = {
	owner: string;
	repo: string;
	kind: 'pr' | 'commit';
	number?: number;
	title: string;
	author: string;
	mergedAtMs: number;
	mergeCommitSha: string;
	headSha: string;
	base: string;
	changedFiles: number;
	containedIn: string[];
	containedInAll: boolean;
};

const prCounters = new Map<string, number>();
function nextPrNumber(repo: string): number {
	const start = 12 + (hashStr(repo) % 80);
	const cur = prCounters.get(repo) ?? start;
	prCounters.set(repo, cur + 1);
	return cur;
}

/** One `Change` per step of `app.ladder` (idx ≥ 1). `containedIn` is every
 *  LATER ladder entry plus this one — a release ladder is monotonic, so any
 *  build at or after this position necessarily carries this change. This is
 *  what lets `buildPrPipeline` correctly read which environments (each
 *  running a specific ladder sha) have already picked the change up, rather
 *  than guessing. */
function landmarkChanges(app: AppFixture): ChangeRecord[] {
	const out: ChangeRecord[] = [];
	const lastIdx = app.ladder.length - 1;
	// ⭐ ROUND 5 QA-5, ITEM 1 (TL, dead build links) — ADDITIVE: `ladder[0]`,
	// THE OLDEST STEP, NEVER HAD ITS OWN RECORD. The loop below starts at
	// `i = 1` by design (each iteration names the TRANSITION INTO that
	// index) — so index 0, the ladder's own starting point, never got a
	// `ChangeRecord` at all. A rollout genuinely still running that oldest
	// build (any env not yet promoted past it) links its build to a commit
	// `respondCommit` could never find — `/changes/<repo>/<ladder[0]>`
	// opened a dead "is not in <repo>" page. This is a SEPARATE record
	// (`kind: 'commit'`, never `'pr'`) appended AFTER the loop below, so it
	// never touches `nextPrNumber`'s own counter — every existing PR number
	// this fixture already hands out (including platform-telemetry's own
	// #20) is unchanged.
	// ⭐ (2026-10-11, squad-changes "Median merge→prod" fix, requirement C —
	// "MERGE ORDER"). `floorMs` — the monotonic guard that keeps every
	// ladder step's own `mergedAtMs` strictly after the PREVIOUS step's
	// final (already-clamped) one, regardless of which of the three
	// formulas below computed it. Ladder position already IS containment
	// order (`containedIn: app.ladder.slice(i)` — a later position
	// necessarily contains every earlier one), so merge order must agree
	// with it or `firstProdLeadMs`/`containment()` read a build as
	// containing a change that, calendar-wise, hadn't been written yet.
	// `EXPLICIT_MERGE_MINUTES_AGO`'s own pin is exactly the failure
	// case this guards: a single ladder step jumping to an explicit pin
	// out of turn used to leave its OWN successors (computed independently,
	// by the generic formula or `REAL_BUILD_CREATED_MIN_AGO`) still dated
	// calendar-BEFORE it. One running floor, walked in ladder order, makes
	// that impossible by construction — see
	// `github-data.merge-order.test.ts` for the invariant this exists to
	// hold, over the WHOLE feed, not just the explicitly-pinned shas.
	if (lastIdx >= 0) {
		const rootSha = app.ladder[0];
		const seed = `${app.repo}-${rootSha}-root`;
		const author = authorForSha(rootSha, seed + 'a2');
		out.push({
			owner: app.owner,
			repo: app.repo,
			kind: 'commit',
			number: undefined,
			title: app.rootTitle ?? 'Initial commit',
			author,
			mergedAtMs: ladderCommitDateMs(app, 0),
			mergeCommitSha: revisionOf(app.repo, rootSha),
			headSha: revisionOf(app.repo, rootSha),
			base: 'main',
			changedFiles: transitionStat(seed).filesN,
			containedIn: app.ladder.map((t) => revisionOf(app.repo, t)),
			containedInAll: false
		});
	}
	for (let i = 1; i <= lastIdx; i++) {
		const sha = app.ladder[i];
		const seed = `${app.repo}-${sha}`;
		const isPr = app.allPr || hashStr(seed + 'kind') % 10 < 7; // ~70% land via a PR (allPr: every step)
		const author = authorForSha(sha, seed + 'a2');
		const mergedAtMs = ladderCommitDateMs(app, i);
		const stat = transitionStat(seed);
		out.push({
			owner: app.owner,
			repo: app.repo,
			kind: isPr ? 'pr' : 'commit',
			number: isPr ? nextPrNumber(app.repo) : undefined,
			title: app.headline(i),
			author,
			mergedAtMs,
			mergeCommitSha: revisionOf(app.repo, sha),
			headSha: revisionOf(app.repo, sha),
			base: 'main',
			changedFiles: stat.filesN,
			// ⛔ WAS `true` (U-18, 2026-10-08, ic-frontend-polish-dash-changes's
			// find). `containedInAll` means `containedIn` was TRUNCATED, so a
			// release outside it is not PROVEN absent — `containment()`
			// (pr-pipeline.ts) then falls back to "created after merge ⇒
			// contained", which reads any not-yet-deployed newer release as
			// already carrying this change (every environment painted
			// "promoting" for a build that is only queued in dev). `app.ladder.
			// slice(i)` is the COMPLETE tail, not a truncation — `false` is the
			// honest answer: a release not in this list really doesn't have it.
			containedIn: app.ladder.slice(i).map((t) => revisionOf(app.repo, t)),
			containedInAll: false
		});
	}
	return out;
}

/** `n` changes with no release evidence anywhere — realistic "no release yet"
 *  chatter (never counted as "not affected" per the product's own "no
 *  release means not affected" rule) that exists purely to spread the
 *  calendar and repo counts out so `/changes` and Home's Changes column look
 *  worked-on rather than sparse. */
function fillerChanges(app: AppFixture, n: number): ChangeRecord[] {
	const out: ChangeRecord[] = [];
	for (let i = 0; i < n; i++) {
		const seed = `${app.repo}-filler-${i}`;
		const sha = synthSha(seed);
		const isPr = hashStr(seed + 'kind') % 10 < 6;
		const author = authorForSha(sha, seed + 'a2');
		const ageDays = hashStr(seed + 'age') % 29;
		const mergedAtMs = hcNow.getTime() - ageDays * 86_400_000 - (hashStr(seed + 'h') % 86_400_000);
		out.push({
			owner: app.owner,
			repo: app.repo,
			kind: isPr ? 'pr' : 'commit',
			number: isPr ? nextPrNumber(app.repo) : undefined,
			title: pick(FILLER_MESSAGES, seed),
			author,
			mergedAtMs,
			mergeCommitSha: sha,
			headSha: sha,
			base: 'main',
			changedFiles: 1 + (hashStr(seed + 'f') % 3),
			// See `landmarkChanges`'s identical U-18 note just above — `[sha]`
			// is the complete answer for a filler change too, never truncated.
			containedIn: [sha],
			containedInAll: false
		});
	}
	return out;
}

/** One `ChangeRecord` per `AppFixture.orphans` entry — a real deployed sha
 *  that is NOT on `ladder` (see that field's own doc comment). `containedIn`
 *  is `[sha]` only, same as a filler: an orphan is off the release line by
 *  definition, so no later release may claim to contain it. */
function orphanChanges(app: AppFixture): ChangeRecord[] {
	return (app.orphans ?? []).map((sha) => {
		const seed = `${app.repo}-${sha}-orphan`;
		const author = authorForSha(sha, seed + 'a2');
		const ageDays = Math.max(0, 28 + (hashStr(seed + 'age') % 4));
		// ⭐ (2026-10-12, QA) `REAL_BUILD_CREATED_MIN_AGO`'s own doc comment
		// already claimed every real-build-clock sha reads it instead of
		// guessing — this function was the one place that didn't. `d0ff17e`
		// (`MR_OFF_LINE`, payments-core's off-the-line build) was aging
		// 28-31 days purely by this generic formula while its own real
		// creation (`MR_CREATED`) is 5h ago and its one deploy
		// (`prod-eu-central`) landed minutes later — a 681h "typical to
		// prod" sample that had nothing to do with when it actually merged.
		const realCreatedMinAgo = REAL_BUILD_CREATED_MIN_AGO.get(sha);
		const mergedAtMs =
			realCreatedMinAgo != null
				? hcNow.getTime() - (realCreatedMinAgo + 5 + (hashStr(seed + 'buildlag') % 40)) * 60_000
				: hcNow.getTime() - ageDays * 86_400_000 - (hashStr(seed + 'h') % 86_400_000);
		return {
			owner: app.owner,
			repo: app.repo,
			kind: 'commit' as const,
			number: undefined,
			title: `Deploy ${sha}`,
			author,
			mergedAtMs,
			mergeCommitSha: revisionOf(app.repo, sha),
			headSha: revisionOf(app.repo, sha),
			base: 'main',
			changedFiles: transitionStat(seed).filesN,
			containedIn: [revisionOf(app.repo, sha)],
			containedInAll: false
		};
	});
}

const buildAllChanges = (): ChangeRecord[] =>
	activeApps()
		.flatMap((app) => [...landmarkChanges(app), ...fillerChanges(app, 3), ...orphanChanges(app)])
		.sort((a, b) => b.mergedAtMs - a.mergedAtMs);
let ALL_CHANGES: ChangeRecord[] = buildAllChanges();
/** Turn the release-switch fixture apps (FIXTURES F and G) in or out of the feed. */
export function setReleaseSwitchApps(on: boolean): void {
	if (on === releaseSwitchOn) return;
	releaseSwitchOn = on;
	ALL_CHANGES = buildAllChanges();
}

/**
 * ⭐ (2026-10-11, AD round 6, item 2) `mergeCommitSha`/`headSha` ON
 * `ChangeRecord` STAY THE RAW LADDER TAG — `refMatches`/`identifiersFor`
 * (and every `ALL_CHANGES.find` in this file) key off that exact tag, alias
 * lookups included, so changing what is STORED would break matching for
 * `hello-frontend-app`'s own alias table. `commitShaFor` is applied here
 * instead, at the one boundary where a `ChangeRecord` turns into what a
 * reader actually sees — the same "real tag in, real-looking sha out" split
 * `makeCommit` already keeps for a compare range's own commits.
 */
function toApiChange(c: ChangeRecord): Change {
	const displaySha = commitShaFor(c.mergeCommitSha);
	return {
		owner: c.owner,
		repo: c.repo,
		kind: c.kind,
		number: c.number,
		title: c.title,
		htmlUrl:
			c.kind === 'pr'
				? `https://github.com/${c.owner}/${c.repo}/pull/${c.number}`
				: `https://github.com/${c.owner}/${c.repo}/commit/${displaySha}`,
		author: c.author,
		mergedAt: new Date(c.mergedAtMs).toISOString(),
		mergeCommitSha: displaySha,
		headSha: commitShaFor(c.headSha),
		base: c.base,
		changedFiles: c.changedFiles,
		containedIn: c.containedIn,
		containedInAll: c.containedInAll
	};
}

function respondChanges(days: number): GithubMockResult {
	const cutoff = hcNow.getTime() - days * 86_400_000;
	const changes = ALL_CHANGES.filter((c) => c.mergedAtMs >= cutoff).map(toApiChange);
	const repos = [...new Set(ALL_CHANGES.map((c) => `${c.owner}/${c.repo}`))];
	const response: ChangesResponse = {
		user: DEMO_LOGIN,
		repos,
		since: new Date(cutoff).toISOString(),
		changes
	};
	return json(response);
}

// ── /api/github/pulls/:owner/:repo/:number ────────────────────────────────

function respondPull(owner: string, repo: string, number: number): GithubMockResult {
	const match = ALL_CHANGES.find(
		(c) => c.kind === 'pr' && c.owner === owner && c.repo === repo && c.number === number
	);
	const repoKnown = ALL_CHANGES.some((c) => c.owner === owner && c.repo === repo);
	if (!match) {
		// Mirrors the real 404 shape `pulls.ts`'s `fetchPull` branches on:
		// `scope: 'repo'` (no service on this cluster deploys this repo at
		// all) vs `scope: 'pr'` (repo is real, this PR number is not).
		return jsonStatus(404, { error: 'not_found', scope: repoKnown ? 'pr' : 'repo' });
	}
	const htmlUrl = `https://github.com/${owner}/${repo}/pull/${number}`;
	const openLagMs = (2 + (hashStr(`${owner}${repo}${number}open`) % 48)) * 3_600_000;
	const checksState: PrCheckState = 'success';
	const pull: PullRequestInfo = {
		number,
		title: match.title,
		htmlUrl,
		author: match.author,
		state: 'merged',
		mergedAt: new Date(match.mergedAtMs).toISOString(),
		// Display-only, same split `toApiChange`'s own note explains — the
		// matching above already ran against `match`'s raw tag.
		mergeCommitSha: commitShaFor(match.mergeCommitSha),
		base: match.base,
		containedIn: match.containedIn,
		containedInAll: match.containedInAll,
		// The fixture computes containment for every environment it knows, so it
		// is never the backend's "could not tell" (main #37/#43 rollback guard).
		containedInUnknown: false,
		openedAt: new Date(match.mergedAtMs - openLagMs).toISOString(),
		headSha: commitShaFor(match.headSha),
		changedFiles: match.changedFiles,
		checks: {
			state: checksState,
			total: 1 + (hashStr(`${repo}${number}checks`) % 4),
			failed: 0,
			url: `${htmlUrl}/checks`
		}
	};
	return json(pull);
}

// ── /api/github/repos/:owner/:repo/commits/:sha ────────────────────────────
//
// ⭐ ADDED (U-17, 2026-10-08, from ic-frontend-polish-dash-changes's find).
// Only `/commits/:sha/pulls` existed — fine for a sha that landed via a PR,
// since the page then has that PR's own title/merge sentence to show. A
// bare commit (`kind: 'commit'` in `landmarkChanges`/`fillerChanges`, ~30%
// of landmarks and every filler) has no PR, `commits/:sha/pulls` answers
// `[]`, and the change page had NOTHING else to ask — it printed the raw
// sha as its own h1 instead of a subject. This answers from the same
// `ALL_CHANGES` record a sha already has (title, author, merge time,
// containedIn/containedInAll), the one source every other GitHub route
// here already reads from.
function respondCommit(owner: string, repo: string, sha: string): GithubMockResult {
	// ⭐ ROUND 5 QA-5, ITEM 2 — `refMatches`, NOT `===`. `c.mergeCommitSha` is
	// always the raw ladder tag (`landmarkChanges`/`fillerChanges` set it from
	// `app.ladder[i]` directly); `sha` is whatever the UI actually linked
	// with, which for several apps is a 12-char slice of `expandSha(tag)` or
	// a hand-picked alias, never the bare tag itself. See `refMatches`'s own
	// doc comment for the full list of spellings this now accepts.
	const match = ALL_CHANGES.find(
		(c) =>
			c.owner === owner &&
			c.repo === repo &&
			(refMatches(repo, c.mergeCommitSha, sha) || refMatches(repo, c.headSha, sha))
	);
	if (!match) return jsonStatus(404, { error: 'not_found' });
	// Display-only, same split `toApiChange`'s own note explains — the
	// `refMatches` lookup above already ran against `match`'s raw tag.
	const displaySha = commitShaFor(match.mergeCommitSha);
	const commit: Commit = {
		sha: displaySha,
		subject: match.title,
		author: match.author,
		committedAt: new Date(match.mergedAtMs).toISOString(),
		htmlUrl: `https://github.com/${owner}/${repo}/commit/${displaySha}`,
		containedIn: match.containedIn,
		containedInAll: match.containedInAll
	};
	return json(commit);
}

// ── /api/github/repos/:owner/:repo/commits/:sha/pulls ─────────────────────

function respondCommitPulls(owner: string, repo: string, sha: string): GithubMockResult {
	const repoKnown = ALL_CHANGES.some((c) => c.owner === owner && c.repo === repo);
	if (!repoKnown) {
		return jsonStatus(404, { error: 'not_found' });
	}
	// An empty result is not an error (module doc, `commit-pulls.ts`) — most
	// shas (every filler and every bare-commit-kind landmark) genuinely have
	// no associated pull request, and 200 + `[]` is the honest answer.
	const matches: CommitPull[] = ALL_CHANGES.filter(
		(c) =>
			c.kind === 'pr' &&
			c.owner === owner &&
			c.repo === repo &&
			refMatches(repo, c.mergeCommitSha, sha)
	).map((c) => ({
		number: c.number as number,
		title: c.title,
		htmlUrl: `https://github.com/${owner}/${repo}/pull/${c.number}`,
		state: 'merged',
		mergedAt: new Date(c.mergedAtMs).toISOString(),
		author: c.author
	}));
	return json(matches);
}

// ── THE ONE ENTRY POINT ────────────────────────────────────────────────────

const COMMITS_RE = /^\/api\/rollouts\/([^/]+)\/([^/]+)\/commits$/;
const PULL_RE = /^\/api\/github\/pulls\/([^/]+)\/([^/]+)\/(\d+)$/;
const COMMIT_PULLS_RE = /^\/api\/github\/repos\/([^/]+)\/([^/]+)\/commits\/([^/]+)\/pulls$/;
const COMMIT_RE = /^\/api\/github\/repos\/([^/]+)\/([^/]+)\/commits\/([^/]+)$/;

/**
 * `path` is the request's pathname alone (no query string), already stripped
 * of any `/api/clusters/<cluster>` prefix — the same normalization
 * `respond.ts`'s own `stripClusterPrefix` + `url.split('?')[0]` already does
 * for every other route, so wiring this in is two lines: try this first (or
 * last), use its result if non-null.
 */
export function respondGithub(
	method: string,
	path: string,
	search: URLSearchParams
): GithubMockResult | null {
	void method; // every route here is a GET; kept for signature symmetry with `respond()`

	if (path === '/api/auth/github/status') return respondGithubStatus();

	const commitsMatch = path.match(COMMITS_RE);
	if (commitsMatch) {
		const name = commitsMatch[2];
		return respondCommits(name, search.get('base') ?? '', search.get('head') ?? '');
	}

	if (path === '/api/github/changes') {
		const days = Number(search.get('days') ?? '30') || 30;
		return respondChanges(days);
	}

	const pullMatch = path.match(PULL_RE);
	if (pullMatch) {
		return respondPull(pullMatch[1], pullMatch[2], Number(pullMatch[3]));
	}

	const commitPullsMatch = path.match(COMMIT_PULLS_RE);
	if (commitPullsMatch) {
		return respondCommitPulls(commitPullsMatch[1], commitPullsMatch[2], commitPullsMatch[3]);
	}

	const commitMatch = path.match(COMMIT_RE);
	if (commitMatch) {
		return respondCommit(commitMatch[1], commitMatch[2], commitMatch[3]);
	}

	return null;
}
