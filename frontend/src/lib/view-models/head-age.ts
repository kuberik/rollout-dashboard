import type { Rollout } from '../../types';

/**
 * The instant the rollout header's age counts from, on every tab: when the head deploy began (`history[0].timestamp`), the same clock the
 * Overview, History and Gates headers print. Never the bake's start or a pod's start: those are other facts with their own labels, and a
 * header that changes its age between tabs reads as two different deploys.
 */
export const headDeployedAt = (rollout: Rollout | null | undefined): string | null => rollout?.status?.history?.[0]?.timestamp ?? null;
