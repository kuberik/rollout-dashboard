import { describe, expect, it } from 'vitest';
import { avatarForLogin } from './github-avatar';

/**
 * ⭐ ONE LOOKUP, SAME ANSWER EVERYWHERE. (qa11, 2026-10-11.) `danielreed`
 * used to render with a real photo on `CommitSummary`/`ChangeVersionModal`
 * and a generated monogram on the diff rail's `triggeredBy` and `commit`
 * rows — the SAME login, four call sites, two different pictures. Every
 * caller that has a bare login and the signed-in account's own
 * `fetchGithubStatus` result now goes through this one function.
 */
describe('avatarForLogin: one answer for the same login, everywhere', () => {
	const status = { login: 'danielreed', avatarUrl: 'data:image/png;base64,AAAA' };

	it('the signed-in login resolves to the signed-in account photo', () => {
		expect(avatarForLogin('danielreed', status)).toBe('data:image/png;base64,AAAA');
	});

	it('matches case-insensitively, the way GitHub logins do', () => {
		expect(avatarForLogin('DanielReed', status)).toBe('data:image/png;base64,AAAA');
	});

	it('the diff rail triggeredBy call and the diff rail commit-author call agree for the identical login', () => {
		// Simulates `diff/[version]/+page.svelte`'s two independent `<Avatar>`
		// call sites — `entry.triggeredBy.name` and `commit.author` — both
		// resolving the SAME login through the SAME function.
		const triggeredByAvatar = avatarForLogin('danielreed', status);
		const commitAuthorAvatar = avatarForLogin('danielreed', status);
		expect(triggeredByAvatar).toBe(commitAuthorAvatar);
		expect(triggeredByAvatar).toBe('data:image/png;base64,AAAA');
	});

	it('any other login draws no photo (the monogram fallback), never a stranger\'s picture', () => {
		expect(avatarForLogin('sam-oliver', status)).toBeUndefined();
	});

	it('no signed-in account (not connected, or no avatar yet) draws no photo', () => {
		expect(avatarForLogin('danielreed', null)).toBeUndefined();
		expect(avatarForLogin('danielreed', { login: 'danielreed', avatarUrl: null })).toBeUndefined();
		expect(avatarForLogin('danielreed', { login: null, avatarUrl: 'data:x' })).toBeUndefined();
	});

	it('an empty or missing login draws no photo', () => {
		expect(avatarForLogin('', status)).toBeUndefined();
		expect(avatarForLogin(null, status)).toBeUndefined();
		expect(avatarForLogin(undefined, status)).toBeUndefined();
	});
});
