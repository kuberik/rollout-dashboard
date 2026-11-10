import { it, expect } from 'vitest';
import fs from 'node:fs';
import { heldHereOfDetail } from './held-here';

/* Round 2 B5 (live hub, hello-world-app prod): some of the queued candidates only wait for staging; the app page counts what is held HERE. */
it('live hello-world-app prod: held here is fewer than every queued candidate, and the rest are waiting for an earlier stage', () => {
	const d = JSON.parse(fs.readFileSync('src/lib/components/new/fixtures/qa-live-detail-hwa-prod.json', 'utf8'));
	const h = heldHereOfDetail(d)!;
	const cands = d.rollout.status.releaseCandidates.length;
	expect(h.count).toBeGreaterThan(0);
	expect(h.count + h.waiting).toBe(cands);
	expect(h.count).toBeLessThan(cands);
});
