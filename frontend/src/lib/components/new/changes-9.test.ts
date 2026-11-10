import { describe, it, expect } from 'vitest';
import * as D from './data';
import { rides, spanLabel, actionWords } from './change-view';
import { heldShown } from './change-truth';

describe('changes-9', () => {
	it('Z2: a group counts the held builds it shows, never the gate queue', () => {
		for (const s of ['incident', 'calm'] as const) {
			const C = D.changes(s, { rolledBackLands: true }); const R = D.rollouts(s);
			const rs = rides(C.items.filter((i) => !i.rolledBack), R.rows, C.lead?.key ?? null);
			const inv = rs.find((r) => r.app === 'invoice-api' && r.items.length === 4)!;
			expect(heldShown(inv.items)).toBe(1);
			expect(spanLabel(inv.items.length, heldShown(inv.items))).toBe('4 changes · 1 held build');
		}
	});
	it('Z7: an approval button says Approve (it acts in place)', () => {
		expect(actionWords({ kind: 'approve' } as never, null)).toBe('Approve');
	});
});
