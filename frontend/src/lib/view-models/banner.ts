/** Failure-banner title: "<app> failed in <tier> · <place>"; the place (region / cluster) only when the tier has several. A check failing NOW makes it "failing" (the word the Attention rollup counts); a deploy failure, or checks that have all recovered, stays "failed". */
export function failedBannerTitle(app: string, tier: string, place?: string | null, failingNow = false): string {
	return `${app} ${failingNow ? 'failing' : 'failed'} in ${tier}${place ? ` · ${place}` : ''}`;
}

/** A banner title as a lead and an unbreakable tail: the last word before the last " · " through the end ("prod · eu-west-1") is one no-wrap run, so the region never breaks at its hyphens and the separator never ends or starts a line. No separator, no tail. */
export function titleParts(title: string): { lead: string; place: string | null } {
	const at = title.lastIndexOf(' · ');
	if (at < 0) return { lead: title, place: null };
	const from = title.lastIndexOf(' ', at - 1) + 1;
	return { lead: title.slice(0, from), place: title.slice(from) };
}
