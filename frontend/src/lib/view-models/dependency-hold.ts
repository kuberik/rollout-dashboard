/**
 * Two small reads over a dependency's holds, pulled out of the rollout Overview
 * and Gates routes so they can be unit-tested.
 *
 * Role: they decide how ONE cause (a RolloutDependency) is drawn when the
 * controller also wrote its RolloutGate on the consumer. Neither invents a
 * fact; both only choose which of two existing facts a row prints.
 */
import {
	isDependencyGateCoveredBy,
	type ClassifiedGate,
	type ContractHold
} from './blocking-story';

/**
 * True when every gate refusing a build is a dependency's own gate and some
 * contract hold (EVERY inbound edge holding that build is passed in, not just
 * the first) covers it. The row then reads the contract sentence ("Needs
 * payments-svc ~2.9.0 · has 2.4.1") instead of a generic "held · N rule".
 */
export function dependencyOnlyHold(
	gates: readonly Pick<ClassifiedGate, 'id' | 'kind' | 'subject'>[],
	holds: readonly ContractHold[]
): boolean {
	return (
		holds.length > 0 && gates.length > 0 && gates.every((g) => isDependencyGateCoveredBy(g, holds))
	);
}

export type ProviderScope = { here: number; elsewhere: number };

/**
 * "Holding N here · M elsewhere" for each provider of the Waiting-on card.
 * HERE is builds this environment refuses (`reallyHeldHere`, the signed held
 * predicate), never a build merely queued behind an earlier stage. ELSEWHERE is
 * builds held only in other environments, the same definition the Held builds
 * rollup uses; a build queued here counts in neither, as in the header.
 */
export function providerScopeCounts(
	blocks: readonly {
		providerName: string;
		blocked: readonly { display: string; envs: readonly string[] }[];
	}[],
	reallyHeldHere: readonly {
		build: string;
		contract?: { provider: string };
		contracts?: readonly { provider: string }[];
	}[],
	currentEnvKey: string
): Map<string, ProviderScope> {
	const out = new Map<string, ProviderScope>();
	for (const b of blocks) {
		const hereBuilds = new Set(
			reallyHeldHere
				.filter((h) =>
					(h.contracts ?? (h.contract ? [h.contract] : [])).some(
						(c) => c.provider === b.providerName
					)
				)
				.map((h) => h.build)
		);
		out.set(b.providerName, {
			here: b.blocked.filter((w) => hereBuilds.has(w.display)).length,
			elsewhere: b.blocked.filter(
				(w) => !hereBuilds.has(w.display) && !w.envs.includes(currentEnvKey)
			).length
		});
	}
	return out;
}
