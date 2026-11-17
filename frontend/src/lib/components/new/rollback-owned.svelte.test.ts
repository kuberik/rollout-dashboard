import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/svelte';
import AttentionCard from '$lib/components/AttentionCard.svelte';
import FailureBanner from './FailureBanner.svelte';
import { attentionModel } from '$lib/view-models/attention';
import { rollbackOwnedReason } from './data';
import { WANTED_VERSION_OWNED_REASON } from '$lib/view-models/pin-hold';
import { source } from '$lib/components/home/sketch/home-data';

/* Roll back follows ONE ownership rule at every entry point: when another manager owns spec.wantedVersion the button is drawn
   disabled with the header's reason, and it is not a link. The fixture's payments-core prod rollout is owned by Flux for the test. */
type R = { metadata: { name: string; namespace: string; managedFields?: unknown[] }; spec?: Record<string, unknown> };
const target = () => (source().rollouts as unknown as R[]).find((r) => r.metadata.name === 'payments-core')!;
const href = () => `/rollouts/prod/${target().metadata.namespace}/${target().metadata.name}`;
const own = (owner: string | null) => {
	const r = target();
	r.metadata.managedFields = owner ? [{ manager: owner, operation: 'Apply', fieldsV1: { 'f:spec': { 'f:wantedVersion': {} } } }] : undefined;
	r.spec = { ...(r.spec ?? {}), ...(owner ? { wantedVersion: 'a02f1c4' } : {}) };
};
afterEach(() => own(null));

describe('rollbackOwnedReason', () => {
	it('is the header\'s sentence when another controller owns the wanted version', () => {
		own('flux-controller');
		expect(rollbackOwnedReason(`${href()}?action=rollback`)).toBe(WANTED_VERSION_OWNED_REASON);
	});
	it('is null when the dashboard may pin, or for an unknown rollout', () => {
		expect(rollbackOwnedReason(href())).toBeNull();
		expect(rollbackOwnedReason('/rollouts/prod/nope/nope')).toBeNull();
		expect(rollbackOwnedReason(null)).toBeNull();
	});
});

describe('the attention card\'s Roll back', () => {
	const card = () => render(AttentionCard, { props: { model: attentionModel({ state: 'failed', age: '5h', tier: 'prod', title: 'x' }), href: href(), id: { name: 'payments-core' }, rollbackHref: `${href()}?action=rollback`, openHref: href() } as never }).container.querySelector<HTMLElement>('[data-action="rollback"]')!;
	it('is a link when the dashboard owns the pin', () => {
		expect(card().tagName).toBe('A');
	});
	it('is a disabled button with the reason when another controller owns it', () => {
		own('flux-controller');
		const b = card();
		expect(b.tagName).toBe('BUTTON');
		expect((b as HTMLButtonElement).disabled).toBe(true);
		expect(b.getAttribute('title')).toBe(WANTED_VERSION_OWNED_REASON);
	});
});

describe('the failure banner\'s Roll back', () => {
	const banner = () => render(FailureBanner, { props: { b: { title: 'x', check: null, line: null, change: null, openHref: href(), rollbackHref: `${href()}?action=rollback`, meta: { since: null, build: null } } } as never }).container.querySelector<HTMLElement>('[data-action="rollback"]')!;
	it('is disabled with the reason when another controller owns the pin', () => {
		own('flux-controller');
		const b = banner();
		expect((b as HTMLButtonElement).disabled).toBe(true);
		expect(b.getAttribute('title')).toBe(WANTED_VERSION_OWNED_REASON);
	});
	it('is a link otherwise', () => {
		expect(banner().tagName).toBe('A');
	});
});
