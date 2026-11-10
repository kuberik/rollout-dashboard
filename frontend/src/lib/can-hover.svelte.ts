import { MediaQuery } from 'svelte/reactivity';

/**
 * ⭐ HOVER TOOLTIPS ONLY WHERE THERE IS A HOVER. (2026-10-07, site critic.)
 *
 * On a touch screen a flowbite `Tooltip` opens on the tap that pressed the
 * button and stays: "Reset health checks and failed tests…" sat over the
 * failure panel after a Retry on a phone. A tooltip that repeats a button's
 * label is a pointer affordance, so it renders only under `(hover: hover)`.
 * A tooltip that is the ONLY place a fact lives (a `?` help icon) instead
 * switches to `trigger="click"` on touch — a deliberate tap, not a side
 * effect of pressing something else.
 *
 * Defaults to true for SSR / no matchMedia, which is the old behaviour.
 */
export const canHover = new MediaQuery('(hover: hover)', true);
