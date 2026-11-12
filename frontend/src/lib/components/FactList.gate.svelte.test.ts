import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import FactList from './FactList.svelte';

/** batch4 #128 (lane 78): a Fact with a typed `gate` draws GateLabel (glyph + source chip), with no marker characters in the value. */
describe('FactList draws a typed gate', () => {
	it('known source: » glyph + [DEV] chip', () => {
		const { container } = render(FactList, { props: { facts: [{ label: 'Rule', value: 'Promotion from dev', gate: { kind: 'promotion', source: 'dev' } }] } });
		const g = container.querySelector('dd [data-gate-label="promotion"]')!;
		expect(g.getAttribute('data-gate-source')).toBe('dev');
		expect(g.querySelector('svg')).not.toBeNull();
		expect(g.textContent).toMatch(/dev/i);
	});
	it('unknown source: » Promotion', () => {
		const { container } = render(FactList, { props: { facts: [{ label: 'Rule', value: 'Promotion', gate: { kind: 'promotion', source: null } }] } });
		const g = container.querySelector('dd [data-gate-label="promotion"]')!;
		expect(g.querySelector('svg')).not.toBeNull();
		expect(g.textContent).toContain('Promotion');
	});
});
