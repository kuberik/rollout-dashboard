import { describe, test, expect } from 'vitest';
import { ownedElsewhere } from './health-failures-fixtures';
import { dashboardManagesWantedVersion } from '$lib/view-models/pin-hold';

const rollout = (name: string) => ({ metadata: { name, namespace: `${name}-prod` }, spec: {}, status: { wantedVersion: 'a02f1c4' } });

describe('health-failures mock: one rollout whose wanted version another manager owns', () => {
	test('inventory-api is owned by Flux, so the dashboard cannot pin it', () => {
		expect(dashboardManagesWantedVersion(ownedElsewhere(rollout('inventory-api')) as never)).toBe(false);
	});
	test('every other rollout is left alone', () => {
		expect(dashboardManagesWantedVersion(ownedElsewhere(rollout('catalog-api')) as never)).toBe(true);
	});
});
