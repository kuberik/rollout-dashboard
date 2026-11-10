import { describe, it, expect } from 'vitest';
import { factRest, STATE_WORD } from './change-cards';

describe('change-cards: the fact line folds the verb into the state word', () => {
	it('an approval names what it waits for, once', () => {
		expect(factRest('Waiting for approval in 2 prod regions', 'approval')).toBe('approval in 2 prod regions');
	});
	it("the viewer's own approval drops the place the journey strip names and the trailing 'waiting'", () => {
		expect(factRest('Waiting for your approval · prod-ap-south · 1 of 5 regions waiting', 'approval')).toBe('your approval · 1 of 5 regions');
	});
	it('checking and deploying keep their preposition', () => {
		expect(factRest('Checking in us-east-2', 'checking')).toBe('in us-east-2');
		expect(factRest('Deploying to dev', 'deploying')).toBe('to dev');
	});
	it('every state has a word', () => {
		expect(Object.values(STATE_WORD).every(Boolean)).toBe(true);
	});
});
