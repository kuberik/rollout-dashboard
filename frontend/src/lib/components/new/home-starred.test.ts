import { it, expect, afterEach } from 'vitest';
import { homePage } from './home-page';
import { rolloutsPage } from './rollouts-page';
import { inbox, rollouts, needsYouCount } from './data';
import { stars, toggleStar } from '$lib/stores/stars.svelte';

/* needsYou means the same on every surface and a starred app counts as the viewer's: rollouts() reads stars.apps by default. */
const FOREIGN = 'hello-frontend-app';
afterEach(() => stars.apps.clear());
const asks = (app: string) => homePage('incident').asks.filter((a) => a.app === app);

it("a starred app whose failure is not the viewer's: Home ask with Roll back, /rollouts Attention, badge +1", () => {
	const asksBefore = homePage('incident').asks.length;
	const badgeBefore = inbox('incident').count;
	expect(asks(FOREIGN)).toHaveLength(0);
	toggleStar(FOREIGN, true);
	const P = homePage('incident');
	expect(P.asks.length).toBe(asksBefore + 1);
	expect(asks(FOREIGN).find((a) => a.failed)?.rollbackHref).toBeTruthy();
	expect(P.fleet.trouble.some((t) => t.app === FOREIGN && t.failing)).toBe(false);
	expect(rolloutsPage('incident').attention.some((a) => a.app === FOREIGN)).toBe(true); // /rollouts lists every failure; it must still list this one
	const R = rollouts('incident').rows.find((r) => r.app === FOREIGN && r.group === 'failed')!;
	expect(R.needsYou).toBe(true);
	expect(R.action?.label).toBe('Roll back');
	expect(inbox('incident').count).toBe(badgeBefore + 1);
	expect(needsYouCount('incident')).toBe(badgeBefore + 1);
});

it('starring an app whose failure is already yours changes nothing and gives one card', () => {
	const base = homePage('incident');
	const mine = base.asks.find((a) => a.failed)!;
	toggleStar(mine.app, true);
	const P = homePage('incident');
	expect(P.asks.length).toBe(base.asks.length);
	expect(P.asks.filter((a) => a.app === mine.app)).toHaveLength(base.asks.filter((a) => a.app === mine.app).length);
});

it('un-starring restores the original asks and badge', () => {
	const n = homePage('incident').asks.length, b = inbox('incident').count;
	toggleStar(FOREIGN, true);
	expect(homePage('incident').asks.length).toBe(n + 1);
	toggleStar(FOREIGN, false);
	expect(homePage('incident').asks.length).toBe(n);
	expect(inbox('incident').count).toBe(b);
});
