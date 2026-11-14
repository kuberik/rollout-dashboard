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

/**
 * `queued`: builds this provider's blocked link refuses that have reached this
 * environment's queue but are not yet refused HERE (they wait for an earlier
 * stage). The Held builds card lists them under "Waiting for ...", so the
 * Waiting-on card names them as queued, never as "held here". A blocked link
 * (`held`) is what marks the row held, as on the tile.
 */
export type ProviderScope = { here: number; elsewhere: number; queued: number; held: boolean };

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
	currentEnvKey: string,
	/**
	 * The RECONCILED contract links (`reconcileNeighbourhoodHolds().upstream`).
	 * A blocked contract link is the tile's and the header's "holds here": the
	 * dependency refuses those builds whether or not an earlier stage has passed
	 * them. The card must say the same, so when a provider's link is blocked its
	 * refused builds count HERE even if none has reached this environment yet.
	 */
	links: readonly { writer?: string; state: string; node: { name: string }; held: readonly string[] }[] = []
): Map<string, ProviderScope> {
	const linkHeld = new Map<string, Set<string>>();
	for (const l of links) {
		if (l.writer !== 'contract' || l.state !== 'blocked') continue;
		const set = linkHeld.get(l.node.name) ?? new Set<string>();
		for (const b of l.held) set.add(b);
		linkHeld.set(l.node.name, set);
	}
	const out = new Map<string, ProviderScope>();
	for (const b of blocks) {
		const hereBuilds = new Set<string>();
		for (const h of reallyHeldHere) {
			const cs = h.contracts ?? (h.contract ? [h.contract] : []);
			if (cs.some((c) => c.provider === b.providerName)) hereBuilds.add(h.build);
		}
		const linked = linkHeld.get(b.providerName);
		out.set(b.providerName, {
			held: hereBuilds.size > 0 || (linked?.size ?? 0) > 0,
			here: b.blocked.filter((w) => hereBuilds.has(w.display)).length,
			queued: b.blocked.filter(
				(w) => !hereBuilds.has(w.display) && w.envs.includes(currentEnvKey) && linked?.has(w.display)
			).length,
			elsewhere: b.blocked.filter(
				(w) => !hereBuilds.has(w.display) && !w.envs.includes(currentEnvKey)
			).length
		});
	}
	return out;
}
