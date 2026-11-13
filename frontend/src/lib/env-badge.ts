/**
 * THE ONE PLACE an environment name becomes a joined badge `<PROD | eu-west-1>`.
 * (Owner, 2026-11-02: "something like a joined badge <PROD | eu-west-1> where
 * left part is colored… for now assume the env will have the right prefix and
 * we can split it.")
 *
 * The name is split at its FIRST "-". The prefix is the TIER (left half, small
 * caps), the remainder is the PLACE (right half, normal ink). No hyphen means
 * the name is a tier on its own and the badge has a left half only.
 *
 * When the API starts shipping tier and region as separate fields, replace
 * `splitEnvName` — nothing else in the product parses an environment name for
 * display.
 */
const TIER_ALIAS: Record<string, string> = {
	production: 'prod',
	development: 'dev',
	testing: 'test',
	stage: 'staging'
};

export interface EnvBadgeParts {
	/** Lower-case tier word, always present (`prod`); the badge uppercases it in CSS. */
	tier: string;
	/** The place after the first "-" (`eu-west-1`), or null for a bare tier. */
	place: string | null;
}

export function splitEnvName(name: string): EnvBadgeParts {
	const raw = (name ?? '').trim();
	// A folded set of regions is a COUNT, not a name: "5 prod regions" is [PROD | 5 regions], and a part of the set is the same
	// count: "3 of 5 prod regions" is [PROD | 3 of 5 regions] (visual audit #17: it used to fall through to ONE tier half, an
	// uppercase coloured sentence "3 OF 5 PROD REGIONS" beside the joined [PROD | eu-west] chips in the same card).
	const set = /^(\d+(?:\s+of\s+\d+)?)\s+([a-z]+)\s+(regions?)$/i.exec(raw);
	if (set) {
		const t = set[2].toLowerCase();
		return { tier: TIER_ALIAS[t] ?? t, place: `${set[1].replace(/\s+/g, ' ')} ${set[3].toLowerCase()}` };
	}
	const i = raw.indexOf('-');
	const head = (i < 0 ? raw : raw.slice(0, i)).toLowerCase();
	const place = i < 0 ? '' : raw.slice(i + 1);
	return { tier: TIER_ALIAS[head] ?? head, place: place || null };
}
