import type { Rollout } from '../../../../types';

export const load = async ({ fetch, params: { namespace, name } }) => {
    let rollout: Rollout | null = null;
    let loading = true;
    let error: string | null = null;
    try {
        const response = await fetch(`/api/rollouts/${namespace}/${name}`);
        if (response.ok) {
            const apiData = await response.json();
            rollout = apiData.rollout;
        } else if (response.status === 404) {
            error = 'Rollout not found';
        } else {
            error = 'Failed to load rollout';
        }
    } catch (err) {
        error = 'Failed to load rollout';
        console.error('Error loading rollout:', err);
    } finally {
        loading = false;
    }
    return { rollout, loading, error };
};
