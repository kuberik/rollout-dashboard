/**
 * THE `home-edge` SCENARIO: the pinned incident fixture PLUS a handful of small apps that exist only to reach states no other fixture reaches.
 *
 * Role: a review and test scenario, opt-in like `home-calm` (`MOCK_API=1 MOCK_SCENARIO=home-edge`, or the `kuberik_scenario=edge` cookie). It is the
 * incident fixture untouched with four apps added, so every count the incident tests pin (held, failing, approvals) stays what it is: the new apps are
 * quiet, at rest, or held only by what each one is here to show. Unit tests read the same data through `edgeSource()` (src/lib/testing/edge-source.ts).
 *
 * What each added app is for (the app named is the one place that carries the state; each has a dev place and a prod place, so /envs/prod lists it):
 *   search-indexer  prod runs m1, the source built m2, dev has not taken m2 yet: nothing inbound to prod, so /envs/prod lists it under Behind, "nothing inbound".
 *   mail-relay      prod is PINNED to m1 while m2 is built and waiting on dev: Behind AND held by the pin (item 2, pin).
 *   media-resizer   prod has two sites, a leader on m2 and a follower that did not follow it and still runs m1 (item 2, failed follower).
 *   auth-proxy      prod has two waves; the wave-2 leader waits on wave 1's bake of m2 (WaveReady False): Behind with a paused wave (item 2, paused wave).
 *   deploy-pin-fail a prod place that is pinned AND whose newest deploy failed its bake (item 7, QA68): which state wins.
 *
 * Nothing here is generated at request time except the instants, which `rebasedHomeFixture` moves like every other instant of the fixture.
 */
import type { HomeFixture, K8sObject } from './home-incident';

type Rel = { tag: string; version: string; revision: string; created: string };
const hex = (seed: string) => (seed + 'e0d1c2b3a49586776655443322110ffeeddccbbaa').slice(0, 40).replace(/[^0-9a-f]/g, '0');
/** `hoursAgo` before the fixture's own capture instant, in the fixture's own clock (the rebase moves it with every other instant) */
const at = (f: HomeFixture, hoursAgo: number): string => new Date(Date.parse(f.capturedAt) - hoursAgo * 3600_000).toISOString();
const rel = (f: HomeFixture, tag: string, hoursAgo: number): Rel => ({ tag, version: tag, revision: hex(tag), created: at(f, hoursAgo) });

type Hist = { rel: Rel; hoursAgo: number; bake?: 'Succeeded' | 'Failed'; user?: string };
type PlaceSpec = {
	ns: string;
	app: string;
	env: 'dev' | 'prod';
	/** the site and wave of an Environment that is one of several in its tier */
	site?: string;
	wave?: number;
	role?: 'Leader' | 'Follower';
	leader?: string;
	releases: Rel[];
	history: Hist[];
	candidates?: Rel[];
	pin?: string;
	pinBy?: string;
	blocker?: { reason: string; message: string };
	members?: { environment: string; site: string; wave: number; revision: string; bakeStatus: string }[];
};

function rolloutOf(f: HomeFixture, p: PlaceSpec): K8sObject {
	const cur = p.history[0]!;
	const hist = p.history.map((h, i) => ({
		id: i + 1,
		version: h.rel,
		timestamp: at(f, h.hoursAgo),
		bakeStatus: h.bake ?? 'Succeeded',
		bakeStartTime: at(f, h.hoursAgo - 0.02),
		bakeEndTime: at(f, h.hoursAgo - 0.1),
		triggeredBy: h.user ? { kind: 'User', name: h.user } : { kind: 'System', name: 'System' },
		...(h.bake === 'Failed' ? { bakeStatusMessage: 'error rate 4.2% over 1%' } : {})
	}));
	return {
		apiVersion: 'kuberik.com/v1alpha1',
		kind: 'Rollout',
		metadata: {
			name: p.app,
			namespace: p.ns,
			labels: { environment: p.env },
			annotations: { 'rollout-dashboard.kuberik.com/source-cluster': p.env, ...(p.pin && p.pinBy ? { 'rollout.kuberik.com/deploy-user': p.pinBy } : {}) }
		},
		spec: { releasesImagePolicy: `${p.ns}/${p.app}`, versionHistoryLimit: 20, minBakeTime: '5m', ...(p.pin ? { wantedVersion: p.pin } : {}) },
		status: {
			source: `github.com/exampleco/${p.app}`,
			wantedVersion: p.pin ?? cur.rel.tag,
			currentVersion: cur.rel.tag,
			...(p.history[1] ? { previousVersion: p.history[1].rel.tag } : {}),
			availableReleases: p.releases,
			releaseCandidates: p.candidates ?? [],
			history: hist
		}
	};
}

function environmentOf(f: HomeFixture, p: PlaceSpec): K8sObject {
	const cur = p.history[0]!;
	const site = p.site ?? 'default';
	const wave = p.wave ?? 1;
	return {
		apiVersion: 'environments.kuberik.com/v1alpha1',
		kind: 'Environment',
		metadata: { name: p.app, namespace: p.ns, annotations: { 'rollout-dashboard.kuberik.com/source-cluster': p.env } },
		spec: { environment: p.env, name: p.app, rolloutRef: { name: p.app }, ...(p.site ? { site: p.site, wave } : {}) },
		status: {
			currentVersion: cur.rel.tag,
			lastStatusChangeTime: at(f, cur.hoursAgo),
			wave: {
				site,
				environment: p.env,
				name: `kuberik-${p.app}`,
				wave,
				role: p.role ?? 'Leader',
				leader: p.leader ?? site,
				selectedRevision: cur.rel.revision,
				members: p.members ?? [{ environment: p.env, site, wave, revision: cur.rel.revision, bakeStatus: cur.bake ?? 'Succeeded' }]
			},
			conditions: [
				p.blocker
					? { type: 'WaveReady', status: 'False', reason: p.blocker.reason, message: p.blocker.message, lastTransitionTime: at(f, cur.hoursAgo) }
					: { type: 'WaveReady', status: 'True', reason: 'Ready', message: 'site may deploy the allowed versions', lastTransitionTime: at(f, cur.hoursAgo) },
				{ type: 'LockstepConsistent', status: 'True', reason: 'Consistent', message: 'all members agree on lockstep', lastTransitionTime: at(f, cur.hoursAgo) }
			]
		}
	};
}

/** the places of the edge apps, built against the fixture's clock */
export function edgePlaces(f: HomeFixture): PlaceSpec[] {
	const out: PlaceSpec[] = [];
	/* search-indexer: dev and prod run m1, the source built m2, dev has not taken it yet */
	{
		const m1 = rel(f, 'si-1', 30), m2 = rel(f, 'si-2', 3);
		out.push({ ns: 'search-indexer-dev', app: 'search-indexer', env: 'dev', releases: [m1, m2], history: [{ rel: m1, hoursAgo: 28 }], candidates: [m2] });
		out.push({ ns: 'search-indexer-prod', app: 'search-indexer', env: 'prod', releases: [m1, m2], history: [{ rel: m1, hoursAgo: 26 }] });
	}
	/* mail-relay: prod pinned to m1 by a person while m2 exists */
	{
		const m1 = rel(f, 'mr-1', 40), m2 = rel(f, 'mr-2', 5);
		out.push({ ns: 'mail-relay-dev', app: 'mail-relay', env: 'dev', releases: [m1, m2], history: [{ rel: m2, hoursAgo: 4 }, { rel: m1, hoursAgo: 38 }] });
		out.push({ ns: 'mail-relay-prod', app: 'mail-relay', env: 'prod', releases: [m1, m2], history: [{ rel: m1, hoursAgo: 36 }], candidates: [m2], pin: m1.tag, pinBy: 'sarahmiller' });
	}
	/* media-resizer: prod us-east leads on m2; eu-west is a follower that still runs m1 (it did not follow) */
	{
		const m1 = rel(f, 'mz-1', 50), m2 = rel(f, 'mz-2', 6);
		const members = [
			{ environment: 'prod', site: 'us-east', wave: 1, revision: m2.revision, bakeStatus: 'Succeeded' },
			{ environment: 'prod', site: 'eu-west', wave: 1, revision: m1.revision, bakeStatus: 'Succeeded' }
		];
		out.push({ ns: 'media-resizer-dev', app: 'media-resizer', env: 'dev', releases: [m1, m2], history: [{ rel: m2, hoursAgo: 5 }, { rel: m1, hoursAgo: 48 }] });
		out.push({ ns: 'media-resizer-prod-us-east', app: 'media-resizer', env: 'prod', site: 'us-east', wave: 1, role: 'Leader', leader: 'us-east', releases: [m1, m2], history: [{ rel: m2, hoursAgo: 4 }, { rel: m1, hoursAgo: 46 }], members });
		out.push({ ns: 'media-resizer-prod-eu-west', app: 'media-resizer', env: 'prod', site: 'eu-west', wave: 1, role: 'Follower', leader: 'us-east', releases: [m1, m2], history: [{ rel: m1, hoursAgo: 45 }], members });
	}
	/* auth-proxy: prod wave 1 is baking m2, wave 2 waits for that bake */
	{
		const m1 = rel(f, 'ap-1', 20), m2 = rel(f, 'ap-2', 2);
		const members = [
			{ environment: 'prod', site: 'us-east', wave: 1, revision: m2.revision, bakeStatus: 'InProgress' },
			{ environment: 'prod', site: 'ap-south', wave: 2, revision: m1.revision, bakeStatus: 'Succeeded' }
		];
		out.push({ ns: 'auth-proxy-dev', app: 'auth-proxy', env: 'dev', releases: [m1, m2], history: [{ rel: m2, hoursAgo: 1.5 }, { rel: m1, hoursAgo: 19 }] });
		out.push({ ns: 'auth-proxy-prod-us-east', app: 'auth-proxy', env: 'prod', site: 'us-east', wave: 1, role: 'Leader', leader: 'us-east', releases: [m1, m2], history: [{ rel: m2, hoursAgo: 0.4 }, { rel: m1, hoursAgo: 18 }], members });
		out.push({ ns: 'auth-proxy-prod-ap-south', app: 'auth-proxy', env: 'prod', site: 'ap-south', wave: 2, role: 'Leader', leader: 'ap-south', releases: [m1, m2], history: [{ rel: m1, hoursAgo: 17 }], candidates: [m2], members, blocker: { reason: 'WaitingFor', message: 'prod/us-east bake on ' + m2.revision.slice(0, 7) } });
	}
	/* deploy-pin-fail: prod is pinned to dp-2 and its newest deploy of it failed the bake; dp-3 waits behind the pin */
	{
		const m1 = rel(f, 'dp-1', 60), m2 = rel(f, 'dp-2', 12), m3 = rel(f, 'dp-3', 3);
		out.push({ ns: 'deploy-pin-fail-dev', app: 'deploy-pin-fail', env: 'dev', releases: [m1, m2, m3], history: [{ rel: m3, hoursAgo: 2 }, { rel: m2, hoursAgo: 11 }] });
		out.push({ ns: 'deploy-pin-fail-prod', app: 'deploy-pin-fail', env: 'prod', releases: [m1, m2, m3], history: [{ rel: m2, hoursAgo: 9, bake: 'Failed', user: 'sarahmiller' }, { rel: m1, hoursAgo: 58 }], candidates: [m3], pin: m2.tag, pinBy: 'sarahmiller' });
	}
	return out;
}

/** the incident fixture with the edge apps added; the fixture's own objects are untouched */
export function withEdgeCases(f: HomeFixture): HomeFixture {
	const places = edgePlaces(f);
	return { ...f, rollouts: [...f.rollouts, ...places.map((p) => rolloutOf(f, p))], environments: [...f.environments, ...places.map((p) => environmentOf(f, p))] };
}
