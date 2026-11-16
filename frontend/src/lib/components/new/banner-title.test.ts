/** One failure gets one title word: the /changes banner follows the /rollouts banner's failing / failed rule. */
import { describe, it, expect } from 'vitest';
import { changesPage } from './changes-page';
import { bannerOf, failingNowOf } from './rollouts-page';

describe('the Changes banner title word', () => {
	it('says failing while a check fails now, the same word as the /rollouts banner for that row', () => {
		const b = changesPage('incident').banner!;
		const row = b.p.ride.row!;
		expect(failingNowOf(row)).toBe(true);
		expect(b.title).toBe('invoice-api failing in prod · eu-west');
		expect(bannerOf(row).title).toBe(b.title);
	});
	it('failingNowOf: every check recovered, or no checks, is failed', () => {
		const row = (verdicts: string[]) => ({ failure: { pool: verdicts.map((verdict) => ({ verdict })) } }) as never;
		expect(failingNowOf(row(['recovered', 'passing']))).toBe(false);
		expect(failingNowOf(row(['recovered', 'failing']))).toBe(true);
		expect(failingNowOf({ failure: null } as never)).toBe(false);
	});
});
