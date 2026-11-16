import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkHoldSentence } from './check-hold-sentence';

describe('checkHoldSentence', () => {
	it('failing now: releases when the check passes; recovered: the failed rollout needs a retry or a new build', () => {
		expect(checkHoldSentence(false)).toBe('Releases when the check starts passing');
		expect(checkHoldSentence(true)).toBe('The check passes again; a retry or a new build releases it');
	});
	it('the Gates tab and the app page read this one helper, never a copy of the sentence', () => {
		for (const f of ['src/lib/components/new/data.ts', 'src/lib/components/new/app/app-model.ts']) {
			const src = readFileSync(f, 'utf8');
			expect(src).not.toContain("'Releases when the check starts passing'");
			expect(src).toContain('checkHoldSentence(');
		}
	});
});
