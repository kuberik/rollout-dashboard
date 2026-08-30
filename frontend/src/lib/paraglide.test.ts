import { describe, expect, it } from 'vitest';
import * as messages from '$lib/paraglide/messages';

/**
 * THE COMPILER EXITS 0 WHEN IT COMPILES NOTHING.
 *
 * When paraglide cannot load its inlang plugins it reports zero messages,
 * writes an empty stub over the compiled output, and returns success. The
 * frontend then builds, tests pass, and every translated string is gone —
 * a corruption that has cost this project twice and was both times mistaken
 * for something else (the Node version, then the CDN allowlist).
 *
 * The plugins are vendored under `project.inlang/plugins/` so no fetch
 * happens at all. This test is the alarm for the day that stops being true:
 * it fails loudly instead of shipping an empty runtime.
 */
describe('paraglide compiled output', () => {
	it('exports the messages compiled from messages/en.json', () => {
		expect(typeof messages.hello_world).toBe('function');
		expect(messages.hello_world({ name: 'en' })).toBe('Hello, en from en!');
	});
});
