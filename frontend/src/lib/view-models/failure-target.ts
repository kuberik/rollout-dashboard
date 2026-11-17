import type { Rollout } from '../../types';
import { placeTarget } from './deploy-risk';
import { failureTarget } from '$lib/stores/failure-toasts.svelte';

/**
 * The target a failure toast names: the rollout, then its place spelled the way every confirm title spells it (`placeTarget`:
 * "prod · eu-west" when the app has a site there, "prod" when it has one). "invoice-api in prod · eu-west".
 */
export function rolloutFailureTarget(rollout: Rollout | null | undefined, environmentName?: string | null, site?: string | null): string {
	return failureTarget(rollout?.metadata?.name, rollout ? placeTarget(rollout, environmentName ?? null, site ?? null) : environmentName);
}
