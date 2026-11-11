import { availableReleases } from '$lib/releases/registry.svelte';
import type { Environment, Rollout } from '../types';
import { getDisplayVersion, shortenVersion } from './utils';
import { rolloutMatchesEnvironment, sourceClusterName, sourceDashboardURL } from './source-dashboard';
import { getRolloutEnvironmentTheme, type EnvironmentTheme } from './environment-theme';
import { compareEnvironmentNames } from './env-order';
import { href } from './paths';
import type { WaveRole } from '../types/environment-types';
import {
	canonicalTier,
	placeKeyOf,
	roleOf,
	siteOf,
	waveOf,
	waveReady,
	type Tier
} from './view-models/sites-waves';

// Collapse the many shapes `status.source` can take (https URL, ssh URL,
// trailing .git/slash, mixed case) down to one comparable string, so the
// same repo always produces the same key regardless of how a given OCI
// artifact happened to format its source annotation.
function normalizeSource(source: string): string {
	let s = source.trim();
	const sshMatch = s.match(/^[\w.-]+@([\w.-]+):(.+)$/);
	if (sshMatch) {
		s = `${sshMatch[1]}/${sshMatch[2]}`;
	} else {
		s = s.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
	}
	// A `/tree/<branch>` (or `/blob/<branch>/...`) tail names a REF inside
	// the repo, not a different repo — `owner/repo/tree/release-1.2` and
	// `owner/repo` must key identically. (2026-09-10, PR-view fix pass,
	// item 12 — `pkg/githubapp/repo.go`'s doc comment already claimed this
	// function ignores tree tails; it did not, until now.)
	s = s.replace(/\/(tree|blob)\/.*$/, '');
	s = s.replace(/\.git\/?$/, '').replace(/\/+$/, '');
	return s.toLowerCase();
}

// Version identity is scoped per-repository — two unrelated apps can
// coincidentally share a tag/SHA string (e.g. both on "latest" or both
// happening to hash to the same short SHA) without being the same release.
// `status.source` (an OCI-annotation-derived repo URL, optional) is the only
// per-rollout signal for "which repo did this come from" available at
// fleet-list scope. When it's missing, fall back to scoping by app name so
// we never silently merge two apps we can't actually prove share a repo.
//
// A repoKey is an internal, stable grouping key with a `repo:` or `app:`
// discriminator. It is NOT what goes in the URL — see repoBody()/versionPath().
export function repoKeyFromSource(
	source: string | null | undefined,
	fallbackName: string
): string {
	if (source) return `repo:${normalizeSource(source)}`;
	return `app:${fallbackName}`;
}

export function repoKeyFor(rollout: Rollout | null | undefined, fallbackName: string): string {
	return repoKeyFromSource(rollout?.status?.source, fallbackName);
}

// The human-readable body of a repoKey, with the internal discriminator
// stripped. This is what the user sees and what rides in the URL path — e.g.
// "github.com/littlechimera/kuberik-testing" for a linked repo, or the bare
// app name for the no-source fallback. Decoded form (real slashes).
export function repoBody(repoKey: string): string {
	if (repoKey.startsWith('repo:')) return repoKey.slice('repo:'.length);
	if (repoKey.startsWith('app:')) return repoKey.slice('app:'.length);
	return repoKey;
}

export function repoLabel(repoKey: string): string {
	if (repoKey.startsWith('app:')) return `${repoKey.slice('app:'.length)} (no linked repository)`;
	return repoBody(repoKey);
}

/**
 * `repo:github.com/owner/repo` → `{owner, repo}`, or `null` when the key
 * names something other than a GitHub repository (no linked repo, or a
 * different host). ONE parser, so every caller that needs to talk to the
 * GitHub API about a rollout's own repo agrees with `normalizeSource`'s own
 * rules (a `/tree/<branch>` tail stripped, dots kept in the repo name) —
 * `palette-index.ts` used to hand-roll this as a private function, and its
 * own doc comment records the bug a SECOND regex here already caused (a
 * `/tree/` tail it did not strip). Extracted here so `pulls.ts`-adjacent
 * call sites (Home's "Your pull requests" card, the revisions build page's
 * "Pull requests" line) can resolve `owner/repo` the same way the palette
 * does, without duplicating the parse.
 */
export function githubOwnerRepo(repoKey: string): { owner: string; repo: string } | null {
	if (!repoKey.startsWith('repo:')) return null;
	const body = repoBody(repoKey);
	const [host, owner, ...rest] = body.split('/');
	if (host !== 'github.com' || !owner || rest.length === 0) return null;
	return { owner, repo: rest.join('/') };
}

// URL path form of a repoKey: the repo body as real path segments (each
// segment individually encoded, slashes kept as separators) so the version
// detail URL reads like
//   /revisions/github.com/littlechimera/kuberik-testing/87a11cc
// instead of one opaque percent-encoded blob.
export function repoSlug(repoKey: string): string {
	return repoBody(repoKey)
		.split('/')
		.map((seg) => encodeURIComponent(seg))
		.join('/');
}

// Single source of truth for linking to the revision detail page. The repo
// path and version become the trailing segments of a rest-param route
// (/revisions/[...slug]); the detail page splits the last segment back off as
// the version.
//
// (2026-09-03, vocabulary pass) `/versions` renamed to `/revisions` — see
// `src/routes/versions/+page.ts`, which now redirects the old address here.
export function versionPath(repoKey: string, version: string): string {
	return href(`/revisions/${repoSlug(repoKey)}/${encodeURIComponent(version)}`);
}

// ── REVISION IS THE IDENTITY, THE LABEL IS ONLY A NAME FOR IT ────────────
//
// A build has two names: the git REVISION it was built from, and whatever
// each service labels that build (`1.66.0-66`, `2.66.0-66`, or the short sha
// itself when no semver annotation exists). The revision is the same string
// for every service; the label is not. Keying the version pages by the label
// therefore fragmented one commit into as many rows as it had labels — `/versions`
// printed `9f10e49` three times with three different ranks, because the rank
// was measuring position in a list of LABEL strings rather than a ladder.
//
// So the canonical URL is keyed by revision. `versionPath` survives for the
// case where no revision is known (and for old links, which the detail page
// resolves and rewrites), but nothing new should be built on it.

/**
 * URL form of a revision: TWELVE characters, not seven.
 *
 * A 7-char sha is a display convention, not a unique key — git itself only
 * guarantees uniqueness at the length it computes per repository, and this
 * page is happy to grow to thousands of builds. 12 is git's own default for
 * `core.abbrev` on a large repo. The page still DISPLAYS 7; only the URL
 * carries the longer form, and the detail page resolves any prefix.
 */
/**
 * A real git revision is HEX. `revisionSlug`/`shortRevision` both exist to
 * shorten exactly that shape — when `revision-ledger.ts`'s own `releasesByKey`
 * has no `b.revision` annotation to key by, it falls back to `b.version` (a
 * semver-ish label like `4.43.0-43`), and that string rides through every
 * caller that holds a "revision" as if it were one. U-16 (2026-10-08, polish
 * pass): `shortRevision('4.43.0-43')` blindly sliced to the first 7
 * characters — `'4.43.0-'`, a trailing dash with the digits after it cut off
 * — and that truncated label became the change page's own `h1` and
 * `<title>`. Neither helper should touch a string that is not actually hex;
 * a label's own shortening (if any) belongs to `shortenVersion`, not here.
 */
function looksLikeHexRevision(s: string): boolean {
	return /^[0-9a-f]+$/i.test(s);
}

export function revisionSlug(revision: string): string {
	if (!looksLikeHexRevision(revision)) return revision;
	return revision.length > 12 ? revision.slice(0, 12) : revision;
}

/** Short display form. Seven characters, everywhere the sha is shown — but
 *  only for a real hex revision; see `looksLikeHexRevision`'s doc above. */
export function shortRevision(revision: string): string {
	if (!looksLikeHexRevision(revision)) return revision;
	return revision.length > 7 ? revision.slice(0, 7) : revision;
}

/**
 * ⭐ THE ONE PLACE A RAW OCI TAG BECOMES THE BUILD NAME THE PRODUCT PRINTS.
 *
 * `spec.wantedVersion` is a TAG —
 * `main-1787999329-991829b6ab3bdb0100ac0a44d8867460732159f7` — while every
 * other surface in the product names that same build `991829b`, the
 * `version` annotation `getDisplayVersion` reads. A live critique caught
 * `/apps` printing the 60-character form inside its pin banner: sixty
 * characters of tag in a sentence an operator has to read at 3am, naming a
 * build they cannot match against anything else on screen.
 *
 * The resolution is a LOOKUP, not a regex: the tag's display name lives in
 * the rollout's own `availableReleases` (and, for a build that has aged out
 * of that list, its deploy history). `shortenVersion` is the fallback for a
 * tag this rollout has never heard of — a hand-typed custom version — and it
 * keeps the tag's shape rather than inventing a sha.
 *
 * THE LONG FORM IS NOT DISCARDED, it is demoted: two builds of the same
 * commit share a display version and differ only in the tag's timestamp, so
 * every caller that shortens should keep the tag reachable in a `title`.
 */
export function displayVersionForTag(
	rollout: Rollout | null | undefined,
	tag: string | null | undefined
): string {
	if (!tag) return '';
	for (const rel of availableReleases(rollout) ?? []) {
		if (rel.tag === tag) return getDisplayVersion(rel);
	}
	for (const h of rollout?.status?.history ?? []) {
		if (h.version?.tag === tag) return getDisplayVersion(h.version);
	}
	return shortenVersion(tag);
}

/** Single source of truth for linking to a revision's detail page. */
export function revisionPath(repoKey: string, revision: string): string {
	return href(`/revisions/${repoSlug(repoKey)}/${encodeURIComponent(revisionSlug(revision))}`);
}

// ── THE `/changes` PATH HELPERS ──────────────────────────────────────────
//
// CHANGES-2026-09-10.md §1: `/revisions/<repoSlug>` → `/changes/<repoSlug>`
// (a repo's own "what runs where" page, kept — §3's "KEPT, as
// `/changes/<repo>`") and `/revisions/<repoSlug>/<key>` → `/changes/<repoSlug>/<key>`
// (a single build/sha's page, now unified with the PR-keyed change page —
// §3's "the change page is ONE page kind"). These are ADDITIVE: the
// `/revisions/*` helpers above are untouched (L3 owns the redirect wiring
// and the old routes stay live as 308s), so nothing that already links
// through `revisionPath`/`versionPath`/`buildPath` breaks while this lane
// lands first.

/** `/changes/<repoSlug>` — the repo's own page (§3, "KEPT, as `/changes/<repo>`"). */
export function changeRepoPath(repoKey: string): string {
	return href(`/changes/${repoSlug(repoKey)}`);
}

/**
 * `/changes/<repoSlug>/<revisionSlug-or-version>` — the build/sha form of
 * the change page (§3: a bare sha maps onto the same route a PR does).
 * Mirrors `buildPath`'s own revision-first, label-fallback precedence
 * exactly, so a caller that already resolves a revision does not have to
 * re-derive which spelling wins.
 */
export function changeBuildPath(
	repoKey: string,
	revision: string | null | undefined,
	version: string
): string {
	const key = revision ? revisionSlug(revision) : version;
	return href(`/changes/${repoSlug(repoKey)}/${encodeURIComponent(key)}`);
}

// ── THE MARK'S FAMILY WORD ───────────────────────────────────────────────
//
// CHANGES-2026-09-10.md §2a: a `LandingMark` prints the environment's
// FAMILY — `DEV` / `STG` / `PRD` / `TEST` — never the raw name. Live data
// has `hello-world-staging` / `hello-world-prod` (19/16 characters), which
// `.chip`'s real 8.5-character budget destroys into indistinguishable
// truncated strings; three prod regions would render as the same eight
// characters. The full environment name survives in the mark's `title`,
// never here.
//
// Deliberately INDEPENDENT of `EnvironmentTheme` (which can be `null` — a
// rollout can carry no theme/annotation/Environment at all) and of the
// preset machinery in `environment-theme.ts`: this only ever needs the
// environment's own NAME, and every `PrCell` always has one. Pattern order
// matches `environment-theme.ts`'s own `ENVIRONMENT_MATCHERS` (prod checked
// first) so an ambiguous name like `prod-test-1` resolves to the same
// family a `.chip-env` would tint it — one rule, not two.
type EnvFamilyKey = 'prod' | 'dev' | 'staging' | 'test';

const FAMILY_PATTERNS: { key: EnvFamilyKey; pattern: RegExp }[] = [
	{ key: 'prod', pattern: /prod|production|live/i },
	{ key: 'dev', pattern: /dev|development/i },
	{ key: 'staging', pattern: /stag|preprod|preview/i },
	{ key: 'test', pattern: /test|qa|qe|integration/i }
];

/**
 * ⭐ (2026-10-08, U-13 vocabulary fix) THE FULL FAMILY NAME, NEVER AN
 * ABBREVIATION. This used to be `STG`/`PRD` — a THIRD spelling for staging/
 * prod beside the chips' own `STAGING`/`PROD` (Home, Rollouts) and whatever
 * the environment's own name literally is. The canonical vocabulary (TL
 * ruling, `lib/CLAUDE.md`'s dated addition) retires every environment-name
 * abbreviation: uppercase, full word, everywhere a family is drawn —
 * `DEV`/`STAGING`/`PROD`/`TEST`. Every caller (`landing-grid.ts`'s marks,
 * `ChangeLine.svelte`'s meter, `PipelineRow.svelte`'s row label,
 * `PipelineCard.svelte`'s prod/non-prod split) reads this one word, so the
 * rename is this one map, not per-caller surgery.
 */
const FAMILY_WORD: Record<EnvFamilyKey, string> = {
	dev: 'DEV',
	staging: 'STAGING',
	prod: 'PROD',
	test: 'TEST'
};

/**
 * The mark's family word for an environment name. No preset match → the
 * environment's own name, uppercased, UNABBREVIATED (no 3-letter
 * truncation — see this function's own fix-pass note above; the previous
 * "first three letters" fallback was itself a silent abbreviation this pass
 * retires) — still named in full in the mark's `title` too, never silently
 * dropped.
 */
export function envFamilyWord(envName: string): string {
	for (const { key, pattern } of FAMILY_PATTERNS) {
		if (pattern.test(envName)) return FAMILY_WORD[key];
	}
	return envName.toUpperCase();
}

/**
 * The git revision a rollout knows this display version by, or null.
 *
 * Looks in `availableReleases` first (the release line, which always carries
 * the OCI-annotation revision) and falls back to deploy history, so a build
 * that has aged out of the release list is still resolvable.
 */
export function revisionFor(
	rollout: Rollout | null | undefined,
	displayVersion: string | null | undefined
): string | null {
	if (!rollout || !displayVersion) return null;
	const status = rollout.status;
	for (const rel of availableReleases(rollout) ?? []) {
		if (rel.revision && getDisplayVersion(rel) === displayVersion) return rel.revision;
	}
	for (const h of status?.history ?? []) {
		const v = h.version;
		if (v?.revision && getDisplayVersion(v) === displayVersion) return v.revision;
	}
	return null;
}

/**
 * The canonical link for a build: revision-keyed when we know the revision,
 * label-keyed only as a fallback. Every call site should go through this or
 * through `versionPathForRollout`, so that adding a resolution source later
 * is one edit rather than fourteen.
 */
export function buildPath(
	repoKey: string,
	revision: string | null | undefined,
	version: string
): string {
	return revision ? revisionPath(repoKey, revision) : versionPath(repoKey, version);
}

// Convenience for inline call sites that hold a rollout but not a repoKey.
// It resolves the revision INTERNALLY, which is why the URL migration to
// revision keys touched none of the nine call sites that use it.
export function versionPathForRollout(
	rollout: Rollout | null | undefined,
	fallbackName: string,
	version: string
): string {
	return buildPath(repoKeyFor(rollout, fallbackName), revisionFor(rollout, version), version);
}

/**
 * `versionPathForRollout`'s `/changes` sibling — CHANGES-2026-09-10.md §1's link
 * sweep. Same resolution (repoKey via `repoKeyFor`, revision via `revisionFor`),
 * routed through `changeBuildPath` instead of the superseded `buildPath`/
 * `revisionPath`/`versionPath` trio, so a caller holding a rollout+version keeps
 * one call instead of re-deriving the repoKey/revision pair by hand.
 */
export function changePathForRollout(
	rollout: Rollout | null | undefined,
	fallbackName: string,
	version: string
): string {
	return changeBuildPath(repoKeyFor(rollout, fallbackName), revisionFor(rollout, version), version);
}

export type AppCell = {
	/**
	 * The PLACE this cell is (`placeKey`): the tier while the tier has at most
	 * one live site, `${tier}-${site}` once it has several. Identity and the
	 * label come from here; order and filters use `tier`.
	 */
	envName: string;
	/** Canonical tier (dev/test/staging/prod), null for a name that cannot be placed or an unbound rollout. */
	tier: Tier | null;
	/** The site, null for an unbound rollout. */
	site: string | null;
	wave: number | null;
	/** Reported role (Leader/Follower), null before the first reconcile or when unbound. */
	role: WaveRole | null;
	/** WaveReady: true/false, or null when the controller reported none. */
	ready: boolean | null;
	environment: Environment | null;
	rollout: Rollout;
	theme: EnvironmentTheme | null;
	sourceURL: string;
	sourceCluster: string;
	repoKey: string;
	repoLabel: string;
};

export type AppGroup = {
	appName: string;
	hasEnvironmentBinding: boolean;
	cells: AppCell[];
};

// Groups every rollout into "apps" the same way a single app's detail page does
// (src/routes/apps/[name]/+page.svelte), but for the whole fleet at once:
// prefer Environment.spec.rolloutRef bindings, falling back to grouping bare
// rollouts by name when no Environment resource references them.
export function groupRolloutsByApp(
	rollouts: Rollout[],
	environments: Environment[]
): Map<string, AppGroup> {
	const groups = new Map<string, AppGroup>();
	// ⛔ U-12 (2026-10-08, stuck lane, cross-lane coordination with
	// `routes/apps/+page.svelte` and `routes/environments/+page.svelte`'s
	// unbound-rollout counts — messaged to the owning IC, see commit).
	// TRACKS BOUND ROLLOUT INSTANCES, NOT APP NAMES. The fallback loop below
	// used to skip any rollout whose NAME had EVER been bound to an
	// environment ANYWHERE in the fleet (`boundAppNames.has(name)`), so a
	// second, unrelated rollout sharing that name — a fixture in a
	// different namespace, e.g. `orders-prod/orders-api` beside the real
	// `orders-api-dev/staging/prod` fleet app — vanished from this map
	// entirely: not bound (no `Environment` actually matches IT), and not
	// counted as unbound either (its name read as "already bound" to the
	// loop below). Measured live: `/rollouts?unlinked=1` lists 6 rollouts
	// with no Environment record; `/apps` and `/environments` both read 5,
	// because this one never got a cell in either branch. Tracking the
	// ROLLOUT OBJECT each `Environment` actually resolved to (rather than
	// the name it asked for) is the precise fact the fallback loop needs.
	const boundRollouts = new Set<Rollout>();

	for (const env of environments) {
		const appName = env.spec?.rolloutRef?.name;
		if (!appName) continue;
		const rollout = rollouts.find((r) => rolloutMatchesEnvironment(r, env));
		if (!rollout) continue;
		boundRollouts.add(rollout);
		let group = groups.get(appName);
		if (!group) {
			group = { appName, hasEnvironmentBinding: true, cells: [] };
			groups.set(appName, group);
		}
		const repoKey = repoKeyFor(rollout, appName);
		group.cells.push({
			envName: env.spec?.environment ? placeKeyOf(env, environments) : '',
			tier: canonicalTier(env.spec?.environment),
			site: siteOf(env),
			wave: waveOf(env),
			role: roleOf(env),
			ready: waveReady(env).ready,
			environment: env,
			rollout,
			theme: getRolloutEnvironmentTheme(
				rollout,
				env,
				env.spec?.environment ? placeKeyOf(env, environments) : null
			),
			sourceURL: sourceDashboardURL(env),
			sourceCluster: sourceClusterName(env),
			repoKey,
			repoLabel: repoLabel(repoKey)
		});
	}

	// Fallback: rollouts with no Environment binding at all — group by rollout
	// name, one cell per namespace it appears in. Skips only a rollout
	// INSTANCE this function already placed above — a same-named rollout
	// that got no cell of its own still reaches here and falls into the
	// bound group under that name, `environment: null`, correctly flagged
	// as the one thing about it this page cannot show.
	for (const rollout of rollouts) {
		const name = rollout.metadata?.name;
		if (!name || boundRollouts.has(rollout)) continue;
		let group = groups.get(name);
		if (!group) {
			group = { appName: name, hasEnvironmentBinding: false, cells: [] };
			groups.set(name, group);
		}
		const repoKey = repoKeyFor(rollout, name);
		group.cells.push({
			envName: rollout.metadata?.namespace || '',
			tier: null,
			site: null,
			wave: null,
			role: null,
			ready: null,
			environment: null,
			rollout,
			theme: getRolloutEnvironmentTheme(rollout),
			sourceURL: sourceDashboardURL(rollout),
			sourceCluster: sourceClusterName(rollout),
			repoKey,
			repoLabel: repoLabel(repoKey)
		});
	}

	for (const group of groups.values()) {
		group.cells.sort((a, b) => compareEnvironmentNames(a.envName, b.envName));
	}

	return groups;
}
