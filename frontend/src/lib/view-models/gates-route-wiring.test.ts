import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * THE GATES ROUTE'S BINDINGS, EXACT. The pure helpers (`gatesPinBox`, `peerHeldMap`) are unit-tested; this pins that the route actually
 * feeds them to `RolloutNeighbourhood`, so a hand-rolled copy at the call site (the peer map built from `card.held`, the held list from
 * `reallyHeldHere`, `clearPinDisabled={false}`) fails here instead of shipping.
 */
const src = readFileSync(new URL('../../routes/rollouts/[cluster]/[namespace]/[name]/gates/+page.svelte', import.meta.url), 'utf8');
const hood = src.slice(src.indexOf('<RolloutNeighbourhood'), src.indexOf('/>', src.indexOf('<RolloutNeighbourhood')));

describe('the Gates route wires the shared helpers into the canvas', () => {
	it('the peer map comes from peerHeldMap(peersByEnv) and is passed as peerHeldByEnv', () => {
		expect(src).toMatch(/import \{[^}]*\bpeerHeldMap\b[^}]*\} from '\$lib\/view-models\/home-model'/);
		expect(src).toMatch(/const peerHeldByEnv = \$derived\(peerHeldMap\(peersByEnv\)\);/);
		expect(hood).toMatch(/\{peerHeldByEnv\}/);
		expect(src.match(/peerHeldByEnv/g)!.length).toBe(3); // declaration, the canvas prop, and the peer's state for the chain-wait text (batch4 #76)
	});
	it("a neighbour (and the promotion chip's source link) opens that rollout's own Gates tab", () => {
		expect(hood).toContain("hrefOf={(n) => rolloutPath(n.cluster || cluster, n.namespace, n.name, 'gates')}");
	});
	it('the Held-here node reads gatesPin.heldBuildsOverride', () => {
		expect(hood).toContain('heldBuildsOverride={gatesPin.heldBuildsOverride}');
	});
	it('Clear pin is disabled by gatesPin.clearPinDisabled, never a literal', () => {
		expect(hood).toContain('clearPinDisabled={gatesPin.clearPinDisabled}');
	});
	it('the gate boxes come from gatesPinBox, off the same gatesPin', () => {
		expect(src).toMatch(/const gatesPin = \$derived\(\s*gatesPinBox\(/);
		expect(src).toMatch(/const gateBoxes = \$derived\(gatesPin\.boxes\);/);
	});
});
