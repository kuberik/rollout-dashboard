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
	const failedRows = (app: string) => rollouts('incident').rows.filter((r) => r.app === app && r.group === 'failed');
	const mine = base.asks.find((a) => a.failed && failedRows(a.app).every((r) => r.needsYou))!;
	expect(mine, 'the fixture has a failure that is already the viewer\'s').toBeTruthy();
	const cardsBefore = base.asks.filter((a) => a.app === mine.app).length, rowsBefore = failedRows(mine.app).length, badge = inbox('incident').count;
	expect(cardsBefore, 'one card before starring').toBe(1);
	toggleStar(mine.app, true);
	const P = homePage('incident');
	expect(P.asks.filter((a) => a.app === mine.app), 'still one card for the app (yours and starred are one)').toHaveLength(1);
	expect(failedRows(mine.app)).toHaveLength(rowsBefore);
	expect(P.asks.length).toBe(base.asks.length);
	expect(new Set(P.asks.map((a) => a.key ?? `${a.app}|${a.href}`)).size, 'no two cards share a key').toBe(P.asks.length);
	expect(inbox('incident').count).toBe(badge);
});

it('un-starring restores the original asks and badge', () => {
	const n = homePage('incident').asks.length, b = inbox('incident').count;
	toggleStar(FOREIGN, true);
	expect(homePage('incident').asks.length).toBe(n + 1);
	toggleStar(FOREIGN, false);
	expect(homePage('incident').asks.length).toBe(n);
	expect(inbox('incident').count).toBe(b);
});
