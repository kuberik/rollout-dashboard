import { describe, it, expect, afterEach } from 'vitest';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { testsSub, testsWord } from './data';

const t = (rolloutName: string, stepIndex: number, phase: string, ns = 'shop') => ({ metadata: { name: `${rolloutName}-${stepIndex}-${phase}`, namespace: ns }, spec: { rolloutName, stepIndex }, status: { phase } });
const src = (rolloutTests: unknown[] | null | undefined) =>
	installLiveSource({ rollouts: [], environments: [], rolloutDependencies: null, kustomizations: [], kruiseRollouts: [], changes: [], changesState: 'not_connected', healthChecks: [], rolloutTests, github: { configured: false, connected: false }, me: '', now: new Date() } as never);
const row = (states: string[]) => ({ href: '/rollouts/c/shop/web', pipeline: { tracks: [{ name: 'web-canary', stages: states.map((state) => ({ state })) }], bake: 'pending', activeStep: null, isFallback: false } }) as never;

afterEach(() => installLiveSource(null));

describe('testsWord (the Overview card words)', () => {
	it('Failed beats everything, past steps Passed, Running, else Pending', () => {
		expect(testsWord(['Failed', 'Running'], false)).toBe('Failed');
		expect(testsWord(['Running'], true)).toBe('Passed');
		expect(testsWord(['Running', 'Succeeded'], false)).toBe('Running');
		expect(testsWord(['Pending'], false)).toBe('Pending');
		expect(testsWord(['WaitingForStep'], false)).toBe('Pending');
		expect(testsWord(['Succeeded', 'Skipped'], false)).toBe('Passed');
	});
});

describe('testsSub', () => {
	it('is null without tests, without a source field, or for another rollout', () => {
		src(undefined); expect(testsSub(row(['active', 'pending']))).toBeNull();
		src([]); expect(testsSub(row(['active', 'pending']))).toBeNull();
		src([t('other', 1, 'Running')]); expect(testsSub(row(['active', 'pending']))).toBeNull();
		src([t('web-canary', 1, 'Running', 'elsewhere')]); expect(testsSub(row(['active', 'pending']))).toBeNull();
	});
	it('reads the tests of the stage in flight (spec.stepIndex = stage number)', () => {
		src([t('web-canary', 1, 'Succeeded'), t('web-canary', 2, 'Running')]);
		expect(testsSub(row(['done', 'active']))).toEqual({ label: 'Running', count: 1 });
		src([t('web-canary', 1, 'Failed'), t('web-canary', 2, 'Pending')]);
		expect(testsSub(row(['done', 'active']))).toEqual({ label: 'Pending', count: 1 });
	});
	it('a failed stage shows its Failed tests; a finished run is Passed', () => {
		src([t('web-canary', 1, 'Failed')]);
		expect(testsSub(row(['fail', 'pending']))).toEqual({ label: 'Failed', count: 1 });
		src([t('web-canary', 1, 'Succeeded'), t('web-canary', 2, 'Succeeded')]);
		expect(testsSub(row(['done', 'done']))).toEqual({ label: 'Passed', count: 2 });
	});
});
