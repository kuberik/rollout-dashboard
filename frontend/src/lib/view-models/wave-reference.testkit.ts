/**
 * The old reference shape, re-created on the wave fixture. (waves lane C, 2026-11-03)
 *
 * The demo's checkout-api is now five prod SITES in waves, and in `calm` none of
 * them has a candidate that cleared its upstream stage and is refused only by the
 * `payments-svc` contract. Several suites pin exactly that shape (a build that is
 * genuinely held HERE next to builds that merely wait for the stage in front), so
 * they build it explicitly: prod-us-east-2 (wave 2) admits `b-43` — wave 1 ran it —
 * while the contract still refuses it. 4.44.0-44 / 4.45.0-45 stay refused by the
 * wave in front: "wave 1 (eu-central, us-east-1)".
 */
export const WAVE_STAGE = 'wave 1 (eu-central, us-east-1)';

type Payload = {
	rollouts?: { items?: { metadata?: { name?: string; namespace?: string }; status?: { gates?: { name?: string; allowedVersions?: string[] | null }[] } }[] };
};

export function withUsEast2Cleared<T extends Payload>(payload: T): T {
	const r = payload.rollouts?.items?.find(
		(x) => x.metadata?.name === 'checkout-api' && x.metadata?.namespace === 'checkout-api-prod-us-east-2'
	);
	const g = r?.status?.gates?.find((x) => x.name === 'promotion-prod-us-east-2');
	if (g) g.allowedVersions = ['b-43', ...(g.allowedVersions ?? [])];
	return payload;
}
