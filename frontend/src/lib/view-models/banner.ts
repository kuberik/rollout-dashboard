/** Failure-banner title: "<app> failed in <tier> · <place>"; the place (region / cluster) only when the tier has several. A check failing NOW makes it "failing" (the word the Attention rollup counts); a deploy failure, or checks that have all recovered, stays "failed". */
export function failedBannerTitle(app: string, tier: string, place?: string | null, failingNow = false): string {
	return `${app} ${failingNow ? 'failing' : 'failed'} in ${tier}${place ? ` · ${place}` : ''}`;
}

/** A banner title as a lead and an unbreakable place: the text after the last " · " (a region such as `eu-west-1`) must not break at its hyphens, so it is its own no-wrap run. No separator, no place. */
export function titleParts(title: string): { lead: string; place: string | null } {
	const at = title.lastIndexOf(' · ');
	return at < 0 ? { lead: title, place: null } : { lead: title.slice(0, at + 3), place: title.slice(at + 3) };
}
