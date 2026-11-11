import { it, expect } from 'vitest';
import { homePage } from './home-page';
import { rollouts } from './data';

const none = new Set<string>();
const FOREIGN = 'hello-frontend-app';
const cards = (P: ReturnType<typeof homePage>, app: string) => P.asks.filter((a) => a.app === app);

it('a starred app whose failure is not the viewer\'s is a Home ask with Roll back, and leaves Fleet trouble', () => {
	const base = homePage('incident', none);
	expect(cards(base, FOREIGN)).toHaveLength(0);
	const P = homePage('incident', new Set([FOREIGN]));
	expect(P.asks.length).toBe(base.asks.length + 1);
	const card = cards(P, FOREIGN).find((a) => a.failed);
	expect(card).toBeDefined();
	expect(card!.rollbackHref).toBeTruthy();
	expect(rollouts('incident', new Set([FOREIGN])).rows.find((r) => r.app === FOREIGN && r.group === 'failed')?.action?.label).toBe('Roll back');
	expect(P.fleet.trouble.some((t) => t.app === FOREIGN && t.failing)).toBe(false);
});

it('starring an app whose failure is already yours changes nothing and gives one card', () => {
	const base = homePage('incident', none);
	const mine = base.asks.find((a) => a.failed)!;
	const P = homePage('incident', new Set([mine.app]));
	expect(P.asks.length).toBe(base.asks.length);
	expect(cards(P, mine.app)).toHaveLength(cards(base, mine.app).length);
});

it('un-starring restores the original asks', () => {
	const base = homePage('incident', none).asks.length;
	expect(homePage('incident', new Set([FOREIGN])).asks.length).toBe(base + 1);
	expect(homePage('incident', none).asks.length).toBe(base);
});
