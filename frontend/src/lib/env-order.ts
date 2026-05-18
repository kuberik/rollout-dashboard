// Canonical environment tier ordering: dev → test → staging → prod.
// Anything we can't classify lands between staging and prod (alphabetical).
const TIER_BUCKETS: Array<{ rank: number; pattern: RegExp }> = [
	{ rank: 0, pattern: /^(dev|development|local)$/i },
	{ rank: 1, pattern: /(dev|development)/i },
	{ rank: 2, pattern: /^(test|qa|qe|integration)$/i },
	{ rank: 3, pattern: /(test|qa|qe|integration)/i },
	{ rank: 4, pattern: /^(stage|staging|preprod|preview)$/i },
	{ rank: 5, pattern: /(stage|staging|preprod|preview)/i },
	{ rank: 7, pattern: /^(prod|production|live)$/i },
	{ rank: 8, pattern: /(prod|production|live)/i }
];

const UNKNOWN_RANK = 6;

export function getEnvironmentRank(name: string | undefined | null): number {
	if (!name) return UNKNOWN_RANK;
	for (const bucket of TIER_BUCKETS) {
		if (bucket.pattern.test(name)) return bucket.rank;
	}
	return UNKNOWN_RANK;
}

export function compareEnvironmentNames(a: string, b: string): number {
	const ra = getEnvironmentRank(a);
	const rb = getEnvironmentRank(b);
	if (ra !== rb) return ra - rb;
	return a.localeCompare(b);
}

export function sortEnvironmentNames(names: string[]): string[] {
	return [...names].sort(compareEnvironmentNames);
}
