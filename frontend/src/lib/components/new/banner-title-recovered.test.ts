/** The /changes banner says "failed" once every check of its lead failure has recovered: the title follows the shared failing-now rule. */
import { describe, it, expect, vi } from 'vitest';

vi.mock('./rollouts-page', async (importOriginal) => ({ ...(await importOriginal<typeof import('./rollouts-page')>()), failingNowOf: () => false }));

import { changesPage } from './changes-page';

describe('the Changes banner title word, recovered branch', () => {
	it('reads failed (not failing) when no check of the lead row fails now', () => {
		expect(changesPage('incident').banner!.title).toBe('invoice-api failed in prod · eu-west');
	});
});
