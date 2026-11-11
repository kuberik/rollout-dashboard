/**
 * TESTS ONLY. Hundreds of view-model tests (and the mock fixtures) still author
 * a Rollout as `status.availableReleases` / `releaseCandidates` /
 * `gatedReleaseCandidates`. The product no longer reads those fields (see
 * src/lib/releases/catalogue.ts): releases come from ReleaseSlices plus
 * `status.candidates`. This adapter lets such a hand-built fixture stand in
 * for the catalogue a controller would have produced, by answering the four
 * registry accessors from the fixture's own lists. It applies only to a Rollout
 * that has no `spec.releaseSourceRef` and carries at least one of the lists,
 * and not at all in the suites that test the catalogue itself, so the real
 * rule (no old-field reads, ever) is exercised where it lives.
 */
import { expect, vi } from 'vitest';

type R =
	| { spec?: { releaseSourceRef?: unknown }; status?: Record<string, unknown> }
	| null
	| undefined;

const REAL_SUITES =
	/\/src\/lib\/(releases|demo\/mock-slices)|\/src\/lib\/components\/ReleaseSourceNotice/;

vi.mock('./src/lib/releases/registry.svelte', async (importOriginal) => {
	const real = await importOriginal<typeof import('./src/lib/releases/registry.svelte')>();
	const legacy = (r: R) => {
		if (REAL_SUITES.test(expect.getState().testPath ?? '')) return null;
		if (!r || r.spec?.releaseSourceRef) return null;
		const st = r.status;
		if (!st) return null;
		/* a rollout the product serves in slices shape (a ref, or the no-source condition) is never adapted */
		if (JSON.stringify(st.conditions ?? []).includes('ReleaseSourceRequired')) return null;
		if (!['availableReleases', 'releaseCandidates', 'gatedReleaseCandidates'].some((f) => f in st))
			return null;
		return st;
	};
	return {
		...real,
		releasesOf: (r: R) => {
			const st = legacy(r);
			return st
				? {
						availableReleases: st.availableReleases,
						releaseCandidates: st.releaseCandidates,
						gatedReleaseCandidates: st.gatedReleaseCandidates,
						state: 'ready'
					}
				: real.releasesOf(r as never);
		},
		availableReleases: (r: R) =>
			legacy(r) ? legacy(r)!.availableReleases : real.availableReleases(r as never),
		releaseCandidates: (r: R) =>
			legacy(r) ? legacy(r)!.releaseCandidates : real.releaseCandidates(r as never),
		gatedReleaseCandidates: (r: R) =>
			legacy(r) ? legacy(r)!.gatedReleaseCandidates : real.gatedReleaseCandidates(r as never)
	};
});

/**
 * The browser's catalogue feed ingests every rollouts list it fetches. A test
 * that reads the mock server's `/api/rollouts` (or one rollout's detail) gets
 * the same: the served catalogue is ingested as the response is produced.
 */
vi.mock('./src/lib/demo/respond', async (importOriginal) => {
	const real = await importOriginal<typeof import('./src/lib/demo/respond')>();
	const { ingestListResponse } = await import('./src/lib/releases/feed');
	return {
		...real,
		respond: (...args: Parameters<typeof real.respond>) => {
			const out = real.respond(...args);
			if (REAL_SUITES.test(expect.getState().testPath ?? '')) return out;
			const [method, url] = args;
			if (
				method === 'GET' &&
				/^\/api\/(clusters\/[^/]+\/)?rollouts(\/[^/?]+\/[^/?]+)?(\?.*)?$/.test(url)
			) {
				const list = /rollouts(\?.*)?$/.test(url) ? out : real.respond('GET', '/api/rollouts');
				try {
					ingestListResponse(JSON.parse(list.body ?? '{}'));
				} catch {
					/* not JSON: nothing to ingest */
				}
			}
			return out;
		}
	};
});

/** Same for the pinned-incident server (what dev-mock-api puts in front of respond()). */
vi.mock('./src/lib/demo/home-incident', async (importOriginal) => {
	const real = await importOriginal<typeof import('./src/lib/demo/home-incident')>();
	const { ingestListResponse } = await import('./src/lib/releases/feed');
	return {
		...real,
		respondHomeIncident: (...args: Parameters<typeof real.respondHomeIncident>) => {
			const out = real.respondHomeIncident(...args);
			if (
				out &&
				!REAL_SUITES.test(expect.getState().testPath ?? '') &&
				args[0] === 'GET' &&
				/\/rollouts(\?.*)?$/.test(args[1])
			) {
				try {
					ingestListResponse(JSON.parse(out.body ?? '{}'));
				} catch {
					/* not JSON */
				}
			}
			return out;
		}
	};
});
