/**
 * FIXTURES F and G - the apps the pipeline's "release switch" is drawn against (release-switch SPEC, "Fixtures").
 *
 *   F `ledger-api`  semver builds 4.40.0-40 .. 4.46.0-46, three releases in flight:
 *       dev      default       on 4.46 CHECKING (baking)
 *       staging  default       on 4.45 at rest
 *       prod     eu-west-1     wave 1 leader, on 4.44 Succeeded
 *                us-east-1     wave 1 follower, DEPLOYING 4.44
 *                ap-south-1    wave 2, still on 4.43 (not reached)
 *   G `search-web`  semver builds 2.1.0-1 .. 2.20.0-20, seventeen releases in flight:
 *       dev on 2.20, staging on 2.12 (both at rest), prod wave 1 eu-central-1 DEPLOYING 2.4,
 *       prod wave 2 us-west-2 at rest on 2.3 (the oldest build not everywhere is 2.4).
 *
 * Same topology mechanism as hello-waves (FIXTURE E in mock-data.ts): one namespace per site, the gates
 * and wave status computed from one site table. Unlike hello-waves they do NOT follow the scenario: the
 * "in flight" state is the point, so calm and incident show the same thing. Every timestamp is relative
 * to the mock clock (`hcAgo`), never to wall-clock aging.
 */
import {
	SOURCE_CLUSTER,
	ckAllowedFrom,
	expandSha,
	hcAgo,
	lockstepCond,
	upstreamPlaces,
	waveBlockerFor,
	waveReadyCond,
	waveStatusFor,
	type WSite
} from './mock-data';
import { setReleaseSwitchApps } from './github-data';

type Place = { ns: string; tier: string; site: string; wave: number; cluster: string; key: string; tag: string; bake: string; msg?: string };
type Release = { tag: string; version: string; revision: string; created: string };

const CHECKING = 'checking';
const DEPLOYING = 'Waiting for health checks to become healthy before starting bake.';

function build(app: string, tagPrefix: string, semverOf: (n: number) => string, first: number, last: number, sites: { tier: string; site: string; wave: number; cluster: string; at: number; bake: string; msg?: string }[]) {
	const releases: Release[] = [];
	for (let n = first; n <= last; n++) {
		const tag = `${tagPrefix}-${String(n).padStart(2, '0')}`;
		releases.push({ tag, version: semverOf(n), revision: expandSha(tag), created: hcAgo((last - n + 1) * 150) });
	}
	const places: Place[] = sites.map((s) => {
		const key = s.tier === 'prod' ? `prod-${s.site}` : s.tier;
		return { ns: `${app}-${key}`, tier: s.tier, site: s.site, wave: s.wave, cluster: s.cluster, key, tag: `${tagPrefix}-${String(s.at).padStart(2, '0')}`, bake: s.bake, msg: s.msg };
	});
	return { app, releases, places };
}

type Fixture = ReturnType<typeof build>;

const LEDGER = build('ledger-api', 'ad', (n) => `4.${n}.0-${n}`, 40, 46, [
	{ tier: 'dev', site: 'default', wave: 1, cluster: 'dev', at: 46, bake: 'InProgress', msg: CHECKING },
	{ tier: 'staging', site: 'default', wave: 1, cluster: 'dev', at: 45, bake: 'Succeeded' },
	{ tier: 'prod', site: 'eu-west-1', wave: 1, cluster: 'prod', at: 44, bake: 'Succeeded' },
	{ tier: 'prod', site: 'us-east-1', wave: 1, cluster: 'dev', at: 44, bake: 'Deploying', msg: DEPLOYING },
	{ tier: 'prod', site: 'ap-south-1', wave: 2, cluster: 'prod', at: 43, bake: 'Succeeded' }
]);

const SEARCH = build('search-web', 'ce', (n) => `2.${n}.0-${n}`, 1, 20, [
	{ tier: 'dev', site: 'default', wave: 1, cluster: 'dev', at: 20, bake: 'Succeeded' },
	{ tier: 'staging', site: 'default', wave: 1, cluster: 'dev', at: 12, bake: 'Succeeded' },
	{ tier: 'prod', site: 'eu-central-1', wave: 1, cluster: 'prod', at: 4, bake: 'Deploying', msg: DEPLOYING },
	{ tier: 'prod', site: 'us-west-2', wave: 2, cluster: 'dev', at: 3, bake: 'Succeeded' }
]);

export const RELEASE_SWITCH_APPS = [LEDGER.app, SEARCH.app] as const;
export const RELEASE_SWITCH_FIXTURES: Fixture[] = [LEDGER, SEARCH];

/** The semver catalogue (oldest first) of one fixture app, tags + versions. */
export const releaseSwitchCatalogue = (app: string) => (RELEASE_SWITCH_FIXTURES.find((f) => f.app === app)?.releases ?? []).map((r) => ({ tag: r.tag, version: r.version }));

const sitesOf = (f: Fixture): (WSite & { place: Place })[] =>
	f.places.map((p) => ({ tier: p.tier, site: p.site, wave: p.wave, revision: f.releases.find((r) => r.tag === p.tag)!.revision, bake: p.bake, place: p }));

function historyOf(f: Fixture, p: Place) {
	const head = f.releases.findIndex((r) => r.tag === p.tag);
	const tags = f.releases.slice(0, head + 1).reverse();
	return tags.map((r, i) => ({
		id: tags.length - i,
		version: { tag: r.tag, version: r.version, revision: r.revision, created: r.created },
		timestamp: hcAgo(8 + (f.releases.length - 1 - f.releases.indexOf(r)) * 150),
		bakeStatus: i === 0 ? p.bake : 'Succeeded',
		...(i === 0 && p.msg ? { bakeStatusMessage: p.msg } : {})
	}));
}

function environmentsOf(f: Fixture) {
	const sites = sitesOf(f);
	return sites.map((x) => {
		const p = x.place;
		return {
			apiVersion: 'environments.kuberik.com/v1alpha1',
			kind: 'Environment',
			metadata: { name: f.app, namespace: p.ns, annotations: { [SOURCE_CLUSTER]: p.cluster } },
			spec: { environment: p.tier, name: f.app, site: p.site, ...(p.tier === 'prod' ? { wave: p.wave } : {}), rolloutRef: { name: f.app } },
			status: {
				currentVersion: p.tag,
				lastStatusChangeTime: hcAgo(6),
				wave: waveStatusFor(f.app, sites, x),
				conditions: [waveReadyCond(waveBlockerFor(sites, x)), lockstepCond()],
				...(p.tier !== 'dev' ? { rolloutGateRef: { name: `promotion-${p.key}` } } : {})
			}
		};
	});
}

function rolloutsOf(f: Fixture) {
	const envs = environmentsOf(f);
	const hist = new Map(f.places.map((p) => [p.key, historyOf(f, p)] as const));
	return f.places.map((p) => {
		const ups = upstreamPlaces(envs, f.app, p.key);
		const allowed = ckAllowedFrom(p.tag, ups, (u) => (hist.get(u) ?? []).filter((h) => h.bakeStatus === 'Succeeded').map((h) => h.version.tag));
		const newer = f.releases.slice(f.releases.findIndex((r) => r.tag === p.tag) + 1).map((r) => r.tag);
		return {
			apiVersion: 'kuberik.com/v1alpha1',
			kind: 'Rollout',
			metadata: { name: f.app, namespace: p.ns, labels: { environment: p.tier }, annotations: { [SOURCE_CLUSTER]: p.cluster } },
			spec: { releasesImagePolicy: `${p.ns}/${f.app}`, versionHistoryLimit: 25, minBakeTime: '3m' },
			status: {
				source: `github.com/exampleco/${f.app}`,
				availableReleases: f.releases,
				wantedVersion: p.tag,
				currentVersion: p.tag,
				history: hist.get(p.key),
				gates: ups.length ? [{ name: `promotion-${p.key}`, kind: 'promotion', allowedVersions: allowed, passing: newer.every((t) => allowed.includes(t)) }] : []
			}
		};
	});
}

let enabled = false;
/**
 * OPT-IN. The apps exist only after `setReleaseSwitchFixtures(true)` (dev-mock-api.ts calls it at plugin start when
 * `MOCK_FIXTURES=release-switch`; the demo build never does). Call it BEFORE the state is built (`resetDemoState`).
 * Off, every route answers as it did without them: same apps, same Dependencies edges, same banners.
 */
export function setReleaseSwitchFixtures(on: boolean): void {
	enabled = on;
	setReleaseSwitchApps(on);
}
export const mkReleaseSwitchEnvironments = () => (enabled ? RELEASE_SWITCH_FIXTURES.flatMap(environmentsOf) : []);
export const mkReleaseSwitchRollouts = () => (enabled ? RELEASE_SWITCH_FIXTURES.flatMap(rolloutsOf) : []);
export const isReleaseSwitchNs = (ns: string) => RELEASE_SWITCH_APPS.some((a) => ns.startsWith(`${a}-`));
