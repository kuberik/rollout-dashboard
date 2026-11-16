/** Failure-banner title: "<app> failed in <tier> · <place>"; the place (region / cluster) only when the tier has several. A check failing NOW makes it "failing" (the word the Attention rollup counts); a deploy failure, or checks that have all recovered, stays "failed". */
export function failedBannerTitle(app: string, tier: string, place?: string | null, failingNow = false): string {
	return `${app} ${failingNow ? 'failing' : 'failed'} in ${tier}${place ? ` · ${place}` : ''}`;
}
