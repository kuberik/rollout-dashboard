import type { Environment, Rollout } from '../types';
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
//   /versions/github.com/littlechimera/kuberik-testing/87a11cc
// instead of one opaque percent-encoded blob.
export function repoSlug(repoKey: string): string {
	return repoBody(repoKey)
		.split('/')
		.map((seg) => encodeURIComponent(seg))
		.join('/');
}

// Single source of truth for linking to the version detail page. The repo path
// and version become the trailing segments of a rest-param route
// (/versions/[...slug]); the detail page splits the last segment back off as
// the version.
export function versionPath(repoKey: string, version: string): string {
	return `/versions/${repoSlug(repoKey)}/${encodeURIComponent(version)}`;
}

// Convenience for inline call sites that hold a rollout but not a repoKey.
export function versionPathForRollout(
	rollout: Rollout | null | undefined,
	fallbackName: string,
	version: string
): string {
	return versionPath(repoKeyFor(rollout, fallbackName), version);
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
