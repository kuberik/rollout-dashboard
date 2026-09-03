import type { Environment, Rollout } from '../types';
import { getDisplayVersion, shortenVersion } from './utils';
import { rolloutMatchesEnvironment, sourceClusterName, sourceDashboardURL } from './source-dashboard';
import { getRolloutEnvironmentTheme, type EnvironmentTheme } from './environment-theme';
import { compareEnvironmentNames } from './env-order';

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
	return `/revisions/${repoSlug(repoKey)}/${encodeURIComponent(version)}`;
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
export function revisionSlug(revision: string): string {
	return revision.length > 12 ? revision.slice(0, 12) : revision;
}

/** Short display form. Seven characters, everywhere the sha is shown. */
export function shortRevision(revision: string): string {
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
	for (const rel of rollout?.status?.availableReleases ?? []) {
		if (rel.tag === tag) return getDisplayVersion(rel);
	}
	for (const h of rollout?.status?.history ?? []) {
		if (h.version?.tag === tag) return getDisplayVersion(h.version);
	}
	return shortenVersion(tag);
}

/** Single source of truth for linking to a revision's detail page. */
export function revisionPath(repoKey: string, revision: string): string {
	return `/revisions/${repoSlug(repoKey)}/${encodeURIComponent(revisionSlug(revision))}`;
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
	for (const rel of status?.availableReleases ?? []) {
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

export type AppCell = {
	envName: string;
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
	const boundAppNames = new Set<string>();

	for (const env of environments) {
		const appName = env.spec?.rolloutRef?.name;
		if (!appName) continue;
		boundAppNames.add(appName);
		const rollout = rollouts.find((r) => rolloutMatchesEnvironment(r, env));
		if (!rollout) continue;
		let group = groups.get(appName);
		if (!group) {
			group = { appName, hasEnvironmentBinding: true, cells: [] };
			groups.set(appName, group);
		}
		const repoKey = repoKeyFor(rollout, appName);
		group.cells.push({
			envName: env.spec?.environment || '',
			environment: env,
			rollout,
			theme: getRolloutEnvironmentTheme(rollout, env),
			sourceURL: sourceDashboardURL(env),
			sourceCluster: sourceClusterName(env),
			repoKey,
			repoLabel: repoLabel(repoKey)
		});
	}

	// Fallback: rollouts with no Environment binding at all — group by rollout
	// name, one cell per namespace it appears in.
	for (const rollout of rollouts) {
		const name = rollout.metadata?.name;
		if (!name || boundAppNames.has(name)) continue;
		let group = groups.get(name);
		if (!group) {
			group = { appName: name, hasEnvironmentBinding: false, cells: [] };
			groups.set(name, group);
		}
		const repoKey = repoKeyFor(rollout, name);
		group.cells.push({
			envName: rollout.metadata?.namespace || '',
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
