import type { Environment, Rollout } from '../types';

export const ENVIRONMENT_THEME_ANNOTATION = 'dashboard.rollout.kuberik.com/theme';
export const ENVIRONMENT_THEME_COLOR_ANNOTATION = 'dashboard.rollout.kuberik.com/theme-color';
export const ENVIRONMENT_THEME_LABEL_ANNOTATION = 'dashboard.rollout.kuberik.com/theme-label';

type ThemePreset = {
	label: string;
	color: string;
};

export type EnvironmentTheme = ThemePreset & {
	name: string;
	textColor: string;
	borderColor: string;
	surfaceColor: string;
	darkSurfaceColor: string;
	darkTextColor: string;
	/**
	 * The raw environment name (e.g. "staging", "dev", "kuberik-demo").
	 * Pages other than the Navbar should display this as the environment value
	 * (typically inside a JoinedBadge labelled "Environment"), reserving the
	 * canonical preset `label` ("Staging", "Development") for the Navbar only.
	 */
	environmentName: string;
};

const PRESET_THEMES: Record<string, ThemePreset> = {
	dev: { label: 'Development', color: '#16a34a' },
	development: { label: 'Development', color: '#16a34a' },
	prod: { label: 'Production', color: '#d97706' },
	production: { label: 'Production', color: '#d97706' },
	stage: { label: 'Staging', color: '#7c3aed' },
	staging: { label: 'Staging', color: '#7c3aed' },
	test: { label: 'Test', color: '#0891b2' },
	testing: { label: 'Test', color: '#0891b2' }
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

function mixWith(hex: string, mix: '#ffffff' | '#000000', amount: number): string {
	const color = hexToRgb(hex);
	const target = hexToRgb(mix);
	const blend = (channel: number, targetChannel: number) =>
		Math.round(channel * (1 - amount) + targetChannel * amount);
	const toHex = (channel: number) => channel.toString(16).padStart(2, '0');
	return `#${toHex(blend(color.r, target.r))}${toHex(blend(color.g, target.g))}${toHex(
		blend(color.b, target.b)
	)}`;
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
	// Prefer the preset's canonical label (e.g. "Staging") over the raw
	// environmentName ("staging") so labels are consistent regardless of
	// whether the theme came from a rollout annotation or an Environment.
	return preset?.label || environmentName || labelFromThemeName(themeName);
}

function buildEnvironmentTheme(name: string, label: string, environmentName: string, color: string): EnvironmentTheme {
	const normalizedColor = normalizeHexColor(color) ?? '#2563eb';
	return {
		name,
		label,
		environmentName,
		color: normalizedColor,
		textColor: mixWith(normalizedColor, '#000000', 0.18),
		borderColor: mixWith(normalizedColor, '#ffffff', 0.64),
		surfaceColor: mixWith(normalizedColor, '#ffffff', 0.9),
		darkSurfaceColor: mixWith(normalizedColor, '#000000', 0.7),
		darkTextColor: mixWith(normalizedColor, '#ffffff', 0.42)
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

	return buildEnvironmentTheme(themeName, label, rawEnvironmentName, color);
}

export function getEnvironmentThemeStyle(theme: EnvironmentTheme): string {
	return [
		`--rollout-theme-accent: ${theme.color}`,
		`--rollout-theme-text: ${theme.textColor}`,
		`--rollout-theme-border: ${theme.borderColor}`,
		`--rollout-theme-surface: ${theme.surfaceColor}`,
		`--rollout-theme-dark-surface: ${theme.darkSurfaceColor}`,
		`--rollout-theme-dark-text: ${theme.darkTextColor}`
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
