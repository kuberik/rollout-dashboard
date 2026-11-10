import { describe, expect, it } from 'vitest';
import { bootScenario } from './state';

describe('bootScenario (MOCK_SCENARIO)', () => {
	it('boots calm by default', () => {
		expect(bootScenario(undefined)).toBe('calm');
		expect(bootScenario({})).toBe('calm');
	});
	it('boots the named scenario, so a dev-server restart keeps it', () => {
		expect(bootScenario({ MOCK_SCENARIO: 'incident' })).toBe('incident');
		expect(bootScenario({ MOCK_SCENARIO: 'wide' })).toBe('wide');
		expect(bootScenario({ MOCK_SCENARIO: 'calm' })).toBe('calm');
	});
	it('ignores an unknown value rather than booting a broken fleet', () => {
		expect(bootScenario({ MOCK_SCENARIO: 'chaos' })).toBe('calm');
	});
});
