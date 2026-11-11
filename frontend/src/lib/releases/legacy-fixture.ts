/**
 * TESTS ONLY. `Rollout` no longer declares the three retired status lists
 * (see types/index.ts), so svelte-check refuses a product read of them. The
 * legacy fixtures (see vitest-setup-legacy-releases.ts) still author them;
 * this gives that one adapter a local type.
 */
import type { Rollout, SchemaRelease } from '../../types';

export type LegacyReleaseLists = {
	availableReleases?: SchemaRelease[];
	releaseCandidates?: SchemaRelease[];
	gatedReleaseCandidates?: SchemaRelease[];
};

/** A fixture Rollout's `status`, typed with the retired lists. */
export const legacyStatus = (r: Rollout): NonNullable<Rollout['status']> & LegacyReleaseLists =>
	(r.status ??= {}) as NonNullable<Rollout['status']> & LegacyReleaseLists;
