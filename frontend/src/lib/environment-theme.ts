import type { Environment, Rollout } from '../types';

export const ENVIRONMENT_THEME_ANNOTATION = 'dashboard.rollout.kuberik.com/theme';
export const ENVIRONMENT_THEME_COLOR_ANNOTATION = 'dashboard.rollout.kuberik.com/theme-color';
export const ENVIRONMENT_THEME_LABEL_ANNOTATION = 'dashboard.rollout.kuberik.com/theme-label';

/**
 * The six values a chip paints with, in both themes. For the four presets these
 * are CHOSEN Tailwind steps (see `PRESET_RAMPS`); for a hand-picked hex from the
 * `theme-color` annotation they are COMPUTED by `mixWith`, because an arbitrary
 * colour has no ramp to choose from.
 */
export type EnvironmentRamp = {
	textColor: string;
	borderColor: string;
	surfaceColor: string;
	darkSurfaceColor: string;
	darkTextColor: string;
	darkBorderColor: string;
};

type ThemePreset = {
	label: string;
	color: string;
	ramp: EnvironmentRamp;
};

export type EnvironmentTheme = Omit<ThemePreset, 'ramp'> &
	EnvironmentRamp & {
	name: string;
	/**
	 * The raw environment name (e.g. "staging", "dev", "prod-ap-northeast-1").
	 * This is what every env chip in the product prints, via `shortEnvLabel`.
	 *
	 * It differs from `label` in exactly one case: a rollout that declares a
	 * `theme` annotation but has no Environment attached has an empty
	 * `environmentName` and a preset `label`. Everywhere else `label` IS this
	 * name — see `resolveThemeLabel`, which stopped preferring the preset's
	 * canonical word on 2026-08-27 because it collapsed `eu-prod-1`,
	 * `us-prod-2` and `ap-prod-1` onto one string.
	 */
	environmentName: string;
};

/**
 * THE ENV IDENTITY RAMP — RESTORED TO THE ORIGINAL (2026-08-25).
 *
 * From the human, after four rounds of hue-solving: *"they need to fit in with
 * the rest of the colors of the pages. i don't know why you changed them in the
 * first place. the one we had originally before you started doing changes were
 * completely fine."*
 *
 * `dev #16a34a` / `staging #7c3aed` / `prod #d97706` / `test #0891b2`.
 *
 * ⛔ **THE SEEDS ARE FIXED AND MUST NOT MOVE.** Everything below chooses
 * SUPPORTING values in each seed's own hue family; none of it re-opens the seed
 * question.
 *
 * Deleted 2026-08-25: `bandColor` / `--rollout-theme-band`. It existed only to
 * preserve the OLD 90% surface for `.environment-theme-band` once the surface
 * was solved to a stronger chroma. `app.css` reads `--rollout-theme-surface`.
 *
 * ── 2026-08-27 · COMPUTED → CHOSEN ─────────────────────────────────────────
 *
 * **The five supporting values used to be COMPUTED from the seed:**
 *
 *     textColor        = mixWith(seed, '#000000', 0.18)
 *     borderColor      = mixWith(seed, '#ffffff', 0.64)
 *     surfaceColor     = mixWith(seed, '#ffffff', 0.90)
 *     darkSurfaceColor = mixWith(seed, '#000000', 0.70)
 *     darkTextColor    = mixWith(seed, '#ffffff', 0.42)
 *
 * Five derivations × four environments = **twenty colours that exist in no
 * palette**, with no designed relationship to one another. They are two
 * arbitrary points on a line from the seed, and that is why `prod` ink measured
 * **4.18:1** and `dev` **4.33:1** against their own fills at 10px — both under
 * the 4.5 floor. Nobody chose those pairs. Meanwhile the 127 Tailwind colour
 * classes elsewhere in `src` have never had a contrast failure, because Tailwind
 * ships designed contrast relationships between the steps of a ramp.
 *
 * **The presets now carry CHOSEN steps.** Same four hue families, same seeds,
 * but ink / border / fill are real Tailwind v4 steps in BOTH themes. Measured
 * after, at the shipped 10px, each ink over its OWN rendered fill:
 *
 *   | env     | light before → after | dark before → after |
 *   |---------|----------------------|---------------------|
 *   | dev     | 4.32 → **4.80**      | 7.50 → **12.37**    |
 *   | staging | 6.84 → **8.57**      | 5.93 → **10.99**    |
 *   | prod    | 4.18 → **8.82**      | 7.64 → **13.55**    |
 *   | test    | 4.74 → **5.12**      | 7.08 → **11.56**    |
 *
 * **DARK IS NOT DERIVED FROM LIGHT, AND NEVER WAS.** The dark chip ground is
 * `gray-800 #1e2939`, which is itself chromatic — OKLCH C 0.0335 at hue 257.7,
 * i.e. BLUE — and `.dark .chip-env` paints the fill at 28% alpha over it. A warm
 * identity CANCELS there (prod's rendered dark fill measured C 0.0036, hue 286 —
 * it had crossed neutral into violet) while a violet one ADDS. So the dark steps
 * are chosen against that ground, independently of the light ones.
 *
 * **Three step choices are not the "consistent" one, and each has a number:**
 *
 * · `prod.borderColor` is `amber-200`, not `amber-300` like its peers' 300s.
 *   `amber-300` measures C 0.1688 — equal to the alarm's own `border-amber-500`
 *   (0.1728) — which would destroy the chroma separation across the
 *   `[PROD][STUCK]` seam, and it puts the 144px `prod-ap-northeast-1` chip on
 *   `/rollouts` at 1.16x under the alarm instead of 1.26x.
 * · `prod.darkTextColor` is `amber-100`, not `amber-200`. **`amber-200` is the
 *   alarm's own dark ink** (`dark:text-amber-200`) and identity may not print in
 *   the alarm's ink.
 * · `staging.darkBorderColor` is `violet-900`, not `violet-800`. `violet-800` is
 *   C 0.2320, the highest chroma in the whole palette, and staging is the
 *   loudest dark identity in the product: at `violet-800` the alarm ratio falls
 *   to 1.16x, at `violet-900` it is 1.22x (it was 1.20x before this pass).
 *
 * **`prod.textColor` IS `amber-900`, the same token the alarm prints in.** That
 * is deliberate and it costs zero new colour values: what separates an identity
 * chip from the alarm is the FILL — 10.6x the chroma — which is the mechanism
 * `DESIGN.md` already names as the reason `alarm` is the only chip with one.
 * Measured across the seam, prod vs alarm: border dEok 0.145 → **0.178**, fill
 * 0.214 → **0.225**. Both improved.
 *
 * **Tailwind's amber ramp is not iso-hue and that is why prod's supporting steps
 * look "off-hue" next to the seed.** amber-600 is hue 58.3, amber-700 45.4,
 * amber-200 95.8: the dark end is orange-red and the light end is yellow. There
 * is no desaturated tan step, so prod's old 64%-white border (#f1cea5, hue 71.2,
 * C 0.0668) is a colour the ramp simply does not contain. Do not "fix" the hue
 * drift by inventing a mix again — that is the loop this pass exits.
 *
 * WHAT THIS PALETTE COLLIDES WITH, AND WHERE THE FIX GOES.
 *
 * Two of these four seeds share a hue family with a STATUS colour. That is a
 * real adjacency and it is why the redesign moved them. It is not a reason to
 * move them again: identity is fixed by the human, so the collision is now a
 * constraint on the STATUS mark, and it is resolved there.
 *
 * · `prod #d97706` is amber, the `stuck` alarm's family. Resolved in
 *   `Chip.svelte`: `alarm` keeps amber and keeps being the loudest object on
 *   any row, because it is the ONLY chip with a fill AND a glyph AND a
 *   coloured border. `rank` (`−N`) gave amber up and took red — see the note on
 *   `TONE.rank`. So no text-only chip competes with prod's hue any more.
 * · `dev #16a34a` is a green, the `Succeeded` family. Resolved by geometry, not
 *   by hue: the success mark is a filled DISC or a check RING, never a chip,
 *   and an env chip is a bordered rectangle that always prints its own name.
 *   The rule is now "one green for STATE; identity is a separate axis and is
 *   told apart by shape".
 *
 * ⚠️ **AND IT IS NOT "SAME HUE" — IT IS THE SAME VALUE (measured 2026-08-28).**
 * `dev.textColor` below is `#008236`, which IS `green-700`, byte for byte the
 * token `BakeStatusIcon`, the status dot and the verdict ring print in. On
 * `/activity` the two co-occur 447 times, on `/` 219 times, on the same rows;
 * `DESIGN.md` had recorded this as a 0.2 degree hue gap. The ink separation
 * between DEV identity and `Succeeded` state is ZERO, so SHAPE is carrying all
 * of it rather than most of it. The `utils.test.ts` guard covers the chip's
 * FILL, which is a different channel. NOT CHANGED — the seeds are closed by the
 * human and `dev`'s ink reaches `/` and `/rollouts`, which are protected.
 *
 * ⚠️ **THE SAME IS TRUE OF PROD, IN LIGHT ONLY.** `prod.textColor` `#7b3306` is
 * `amber-900`, which is exactly what `Chip`'s `alarm` prints its light ink in.
 * That is deliberate (see the header) and it MUST NOT be "unified" onto one
 * shared constant, because the two objects SWAP ownership of amber-900 between
 * themes: in dark `#7b3306` is the ALARM'S FILL and prod's ink steps to
 * `amber-100`. A shared token would be right in one theme and wrong in the
 * other. Nor may these values stop being hex literals — `oklabChroma()` parses
 * hex and silently returns a fallback BLUE for anything else, and
 * `utils.test.ts` asserts ~20 of them literally.
 *
 * Do not re-solve either by nudging these four values. That is the loop this
 * revert exists to exit.
 */
const PRESET_RAMPS = {
	/** green-700 / green-300 / green-50 · green-950 / green-800 / green-200 */
	dev: {
		textColor: '#008236',
		borderColor: '#7bf1a8',
		surfaceColor: '#f0fdf4',
		darkSurfaceColor: '#032e15',
		darkBorderColor: '#016630',
		darkTextColor: '#b9f8cf'
	},
	/** violet-800 / violet-300 / violet-50 · violet-950 / violet-900 / violet-200 */
	staging: {
		textColor: '#5d0ec0',
		borderColor: '#c4b4ff',
		surfaceColor: '#f5f3ff',
		darkSurfaceColor: '#2f0d68',
		darkBorderColor: '#4d179a',
		darkTextColor: '#ddd6ff'
	},
	/** amber-900 / amber-200 / amber-50 · amber-950 / amber-800 / amber-100 */
	prod: {
		textColor: '#7b3306',
		borderColor: '#fee685',
		surfaceColor: '#fffbeb',
		darkSurfaceColor: '#461901',
		darkBorderColor: '#973c00',
		darkTextColor: '#fef3c6'
	},
	/** cyan-700 / cyan-300 / cyan-50 · cyan-950 / cyan-800 / cyan-200 */
	test: {
		textColor: '#007595',
		borderColor: '#53eafd',
		surfaceColor: '#ecfeff',
		darkSurfaceColor: '#053345',
		darkBorderColor: '#005f78',
		darkTextColor: '#a2f4fd'
	}
} satisfies Record<string, EnvironmentRamp>;

const PRESET_THEMES: Record<string, ThemePreset> = {
	dev: { label: 'Development', color: '#16a34a', ramp: PRESET_RAMPS.dev },
	development: { label: 'Development', color: '#16a34a', ramp: PRESET_RAMPS.dev },
	prod: { label: 'Production', color: '#d97706', ramp: PRESET_RAMPS.prod },
	production: { label: 'Production', color: '#d97706', ramp: PRESET_RAMPS.prod },
	stage: { label: 'Staging', color: '#7c3aed', ramp: PRESET_RAMPS.staging },
	staging: { label: 'Staging', color: '#7c3aed', ramp: PRESET_RAMPS.staging },
	test: { label: 'Test', color: '#0891b2', ramp: PRESET_RAMPS.test },
	testing: { label: 'Test', color: '#0891b2', ramp: PRESET_RAMPS.test }
};

const ENVIRONMENT_MATCHERS: { pattern: RegExp; preset: keyof typeof PRESET_THEMES }[] = [
	{ pattern: /prod|production/i, preset: 'prod' },
	{ pattern: /dev|development/i, preset: 'dev' },
	{ pattern: /staging|stage/i, preset: 'staging' },
	{ pattern: /test|testing/i, preset: 'test' }
];

const HEX_COLOR_REGEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function normalizeThemeName(value: string): string {
	return value.trim().toLowerCase();
}

function normalizeHexColor(value: string): string | null {
	const trimmed = value.trim();
	if (!HEX_COLOR_REGEX.test(trimmed)) return null;
	if (trimmed.length === 4) {
		const [, r, g, b] = trimmed;
		return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
	}
	return trimmed.toLowerCase();
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
	const normalized = normalizeHexColor(hex);
	if (!normalized) return { r: 37, g: 99, b: 235 };
	return {
		r: parseInt(normalized.slice(1, 3), 16),
		g: parseInt(normalized.slice(3, 5), 16),
		b: parseInt(normalized.slice(5, 7), 16)
	};
}

/**
 * OKLab chroma of an sRGB hex, 0..~0.37. MEASUREMENT ONLY — nothing in this
 * module derives a colour from it any more, and no runtime code calls it. It
 * stays because the palette invariants in `utils.test.ts` are stated as
 * measurements ("no identity mark is louder than the alarm fill"), and a rule
 * that can be measured in CI is the only kind that survives another redesign.
 *
 * OKLCH chroma is the axis Tailwind v4 states its palette on, so `amber-200`
 * (`oklch(.924 .12 95.746)`) reads back as ~0.115 here and the ceilings in
 * `DESIGN.md` are directly comparable.
 */
export function oklabChroma(hex: string): number {
	const { r, g, b } = hexToRgb(hex);
	const toLinear = (channel: number) => {
		const c = channel / 255;
		return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
	};
	const lr = toLinear(r);
	const lg = toLinear(g);
	const lb = toLinear(b);
	const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
	const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
	const s = Math.cbrt(0.088302462 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
	const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
	return Math.hypot(a, bb);
}

/**
 * ⚠️ **THE FOUR PRESETS DO NOT GO THROUGH THIS FUNCTION ANY MORE.** It exists for
 * exactly one caller — `computedRamp()`, the fallback for a hand-picked
 * `theme-color` annotation, which has no ramp to choose steps from. Reaching for
 * it to "derive" a preset value is the defect this pass removed; see the header.
 */
export function mixWith(hex: string, mix: string, amount: number): string {
	const color = hexToRgb(hex);
	const target = hexToRgb(mix);
	const blend = (channel: number, targetChannel: number) =>
		Math.round(channel * (1 - amount) + targetChannel * amount);
	const toHex = (channel: number) => channel.toString(16).padStart(2, '0');
	return `#${toHex(blend(color.r, target.r))}${toHex(blend(color.g, target.g))}${toHex(
		blend(color.b, target.b)
	)}`;
}

/**
 * THE ARBITRARY-COLOUR PATH. An `Environment` may carry
 * `dashboard.rollout.kuberik.com/theme-color: '#0ea5e9'`, and a hand-picked hex
 * has no ramp — there are no steps to choose. So it keeps the ORIGINAL computed
 * derivation, byte for byte, including the dark border, which used to be
 * produced in CSS as `color-mix(accent 38%, gray-700)` and is now stated here so
 * the light and dark border come from one place.
 *
 * A custom env therefore renders EXACTLY as it did before this pass. The
 * presets never reach this function: `getRolloutEnvironmentTheme` passes
 * `preset.ramp` whenever the colour came from a preset rather than from an
 * annotation.
 */
function computedRamp(color: string): EnvironmentRamp {
	return {
		textColor: mixWith(color, '#000000', 0.18),
		borderColor: mixWith(color, '#ffffff', 0.64),
		surfaceColor: mixWith(color, '#ffffff', 0.9),
		darkSurfaceColor: mixWith(color, '#000000', 0.7),
		darkTextColor: mixWith(color, '#ffffff', 0.42),
		// gray-700 is `.dark .chip-env`'s old border mix target.
		darkBorderColor: mixWith(color, '#364153', 0.62)
	};
}

function labelFromThemeName(name: string): string {
	return name
		.split(/[-_\s]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

function presetNameFromEnvironmentName(environmentName: string): keyof typeof PRESET_THEMES | null {
	const match = ENVIRONMENT_MATCHERS.find(({ pattern }) => pattern.test(environmentName));
	return match?.preset ?? null;
}

function resolveThemeLabel({
	annotationLabel,
	environmentName,
	inlineThemeColor,
	preset,
	themeName,
	themeValue
}: {
	annotationLabel?: string;
	environmentName?: string;
	inlineThemeColor: string | null;
	preset?: ThemePreset;
	themeName: string;
	themeValue?: string;
}): string {
	if (annotationLabel) return annotationLabel;
	if (themeValue && preset) return preset.label;
	if (themeValue && inlineThemeColor) return environmentName || 'Custom';
	if (themeName === 'custom') return environmentName || 'Custom';
	// ── AN ENVIRONMENT'S LABEL IS ITS OWN NAME (2026-08-27) ────────────────
	//
	// This line used to read `preset?.label || environmentName || …`, i.e. it
	// preferred the PRESET's canonical word. That collapsed every distinct
	// environment whose name merely *matched* a preset pattern onto one string:
	// `eu-prod-1`, `us-prod-2` and `ap-prod-1` all resolved to `Production`,
	// three environments and one indistinguishable mark. It is the same defect
	// class as the 12ch truncation that rendered three regions as `PROD-US…`,
	// and it is why `utils.test.ts` has asserted `eu-prod-1` / `development-west`
	// here since before the palette work.
	//
	// The rule, stated once:
	//   · an explicit `theme-label` annotation wins (branch 1);
	//   · an explicit `theme` annotation NAMES the theme, and the identity
	//     deliberately does not come from the environment's name, so the
	//     preset's word is printed — otherwise a green chip would read
	//     `eu-prod-1` (branch 2, asserted by "lets a theme annotation override
	//     the inferred environment theme");
	//   · otherwise the identity was INFERRED from — or merely recoloured on
	//     top of — the environment's own name, so print that name.
	//
	// The preset label survives only as the fallback for a rollout that carries
	// a theme with no Environment attached.
	//
	// VISUAL DELTA: none. No env chip in the product prints `theme.label` —
	// they all print `shortEnvLabel(theme)`, which reads `environmentName`
	// first, so the chips already showed the real name. The one live consumer
	// is the Navbar breadcrumb chip's `title`, whose own comment says "The full
	// name is in `title`" while the code handed it the preset word instead.
	return environmentName || preset?.label || labelFromThemeName(themeName);
}

function buildEnvironmentTheme(
	name: string,
	label: string,
	environmentName: string,
	color: string,
	ramp?: EnvironmentRamp
): EnvironmentTheme {
	const normalizedColor = normalizeHexColor(color) ?? '#2563eb';
	return {
		name,
		label,
		environmentName,
		color: normalizedColor,
		...(ramp ?? computedRamp(normalizedColor))
	};
}

export function getRolloutEnvironmentTheme(
	rollout?: Rollout | null,
	environment?: Environment | string | null
): EnvironmentTheme | null {
	const annotations = rollout?.metadata?.annotations;
	const environmentName = typeof environment === 'string' ? environment : environment?.spec?.environment;

	const themeValue = annotations?.[ENVIRONMENT_THEME_ANNOTATION]?.trim();
	const colorValue = annotations?.[ENVIRONMENT_THEME_COLOR_ANNOTATION]?.trim();
	if (!themeValue && !colorValue && !environmentName) return null;

	const inferredPresetName = environmentName ? presetNameFromEnvironmentName(environmentName) : null;
	const themeName = themeValue
		? normalizeThemeName(themeValue)
		: (inferredPresetName ?? (colorValue ? 'custom' : ''));
	const preset = themeName ? PRESET_THEMES[themeName] : undefined;
	const customColor = colorValue ? normalizeHexColor(colorValue) : null;
	const inlineThemeColor = themeValue ? normalizeHexColor(themeValue) : null;
	const color = customColor ?? inlineThemeColor ?? preset?.color;
	if (!color) return null;

	const label = resolveThemeLabel({
		annotationLabel: annotations?.[ENVIRONMENT_THEME_LABEL_ANNOTATION]?.trim(),
		environmentName,
		inlineThemeColor,
		preset,
		themeName,
		themeValue
	});
	// Raw environment name for display in pages other than the Navbar.
	// Only sources we treat as a *real* environment value: Environment.spec.environment,
	// or an explicit theme-label annotation. We do NOT fall back to the preset
	// label here, because a rollout with no Environment shouldn't be shown as
	// having one — match the detail page, which only renders the env badge when
	// environment.spec.environment is present.
	const rawEnvironmentName =
		environmentName || annotations?.[ENVIRONMENT_THEME_LABEL_ANNOTATION]?.trim() || '';

	// THE PRESETS NEVER GO THROUGH `mixWith`. The chosen ramp is used exactly
	// when the colour came FROM the preset — i.e. no `theme-color` annotation and
	// no inline hex in the `theme` annotation overrode it. Anything hand-picked
	// falls through to `computedRamp()`, which is the original derivation.
	const ramp = preset && !customColor && !inlineThemeColor ? preset.ramp : undefined;

	return buildEnvironmentTheme(themeName, label, rawEnvironmentName, color, ramp);
}

export function getEnvironmentThemeStyle(theme: EnvironmentTheme): string {
	return [
		`--rollout-theme-accent: ${theme.color}`,
		`--rollout-theme-text: ${theme.textColor}`,
		`--rollout-theme-border: ${theme.borderColor}`,
		`--rollout-theme-surface: ${theme.surfaceColor}`,
		`--rollout-theme-dark-surface: ${theme.darkSurfaceColor}`,
		`--rollout-theme-dark-text: ${theme.darkTextColor}`,
		// Added 2026-08-27. The dark border used to be produced in CSS as
		// `color-mix(--rollout-theme-accent 38%, gray-700)`, i.e. computed from the
		// seed and washed toward the blue card ground — which is exactly why prod's
		// dark edge measured a muddy C 0.0612 at hue 67. It is a chosen step now.
		// Consumers: `.dark .chip-env` and `.dark .environment-theme-badge`.
		`--rollout-theme-dark-border: ${theme.darkBorderColor}`
	].join('; ');
}

// Canonical short labels for the well-known env presets. Used wherever we
// display the env badge so 'PRODUCTION' / 'DEVELOPMENT' don't blow out
// tight cards and chips. Anything not in this map falls back to the raw
// environment name or theme key.
const ENV_SHORT_LABEL: Record<string, string> = {
	development: 'dev',
	production: 'prod',
	staging: 'staging',
	testing: 'test'
};

export function shortEnvLabel(input: EnvironmentTheme | string | null | undefined): string {
	if (!input) return '';
	const candidate = (
		typeof input === 'string'
			? input
			: input.environmentName || input.name || input.label || ''
	).toLowerCase();
	return ENV_SHORT_LABEL[candidate] || candidate;
}
