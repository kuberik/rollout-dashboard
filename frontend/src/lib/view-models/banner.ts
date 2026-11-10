/** Failure-banner title (r39 kit `banner()`): "<app> failed in <tier> · <place>"; the place (region / cluster) only when the tier has several. */
export function failedBannerTitle(app: string, tier: string, place?: string | null): string {
	return `${app} failed in ${tier}${place ? ` · ${place}` : ''}`;
}
