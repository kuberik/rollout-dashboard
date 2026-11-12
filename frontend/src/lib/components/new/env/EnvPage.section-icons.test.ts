import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/** Each section header of /envs/<name> has its own icon: "Behind" (apps on an older build) is not the clock of "Today in <env>". */
const src = readFileSync(new URL('./EnvPage.svelte', import.meta.url), 'utf8');
const iconOf = (title: string) => new RegExp(`<SectionHeader title="${title}[^"]*" icon=\\{(\\w+)\\}`).exec(src)?.[1];

describe('EnvPage section icons', () => {
	it('Behind does not share the clock with Today in <env>', () => {
		expect(iconOf('Behind')).toBeTruthy();
		expect(iconOf('Today in ')).toBe('ClockOutline');
		expect(iconOf('Behind')).not.toBe(iconOf('Today in '));
	});
});
