/**
 * ONE ICON PER DESTINATION. The sidebar, the phone tab bar and the command
 * palette's page rows all draw a top-level page with the glyph from this map,
 * so a page can never wear two icons, or borrow another page's (visual audit
 * #19: the palette's "Rollouts" row drew Activity's clock while the sidebar
 * drew the grid). Keyed by the page's app path.
 *
 * ⛔ D-32 (2026-10-08): Changes is `CodePullRequestOutline` (the palette's
 * glyph for a change), never the tag, which means a build.
 */
import {
	HomeOutline,
	GridOutline,
	RocketOutline,
	LayersOutline,
	ClockOutline,
	CodePullRequestOutline
} from 'flowbite-svelte-icons';

export const NAV_ICON = {
	'/': HomeOutline,
	'/rollouts': GridOutline,
	'/changes': CodePullRequestOutline,
	'/environments': LayersOutline,
	'/apps': RocketOutline,
	'/activity': ClockOutline,
	// `/me` is a list of the viewer's pull requests: the change glyph.
	'/me': CodePullRequestOutline
} as const;

export type NavPath = keyof typeof NAV_ICON;
