/** The banners hand their recovered flag to the check line (the ring), at every call site that knows it. */
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
it('StatementBanner passes `recovered` to both check lines', () => {
	expect(read('StatementBanner.svelte').match(/<FailedCheckLine [^>]*\{recovered\}/g)).toHaveLength(2);
});
it.each([
	['new/FailureBanner.svelte', 'recovered={!!b.recovered}'],
	['new/change/ChangeDetail.svelte', 'recovered={!!lead?.row?.failure?.recovered}'],
	['new/Facia.svelte', 'recovered={recoveredFail}'],
	['new/app/AppDetail.svelte', 'recovered={!!failRow.failure?.recovered}']
])('%s sets it on its failed banner', (f, expr) => {
	expect(read(f)).toContain(expr);
});
