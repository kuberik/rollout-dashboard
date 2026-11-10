import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import ActivitySentence from './ActivitySentence.svelte';

function baseProps() {
	return {
		actor: { kind: 'person' as const, name: 'danielreed' },
		kind: 'deployed' as const,
		app: 'checkout-api',
		appHref: '/rollouts/x/checkout-api',
		env: 'prod',
		theme: null,
		from: 'a1b2c3d',
		to: 'e4f5a6b',
		time: '14:25'
	};
}

describe('ActivitySentence', () => {
	it('renders the actor, the app and the time', () => {
		const { getByText } = render(ActivitySentence, baseProps());
		expect(getByText('danielreed')).toBeTruthy();
		expect(getByText('checkout-api')).toBeTruthy();
		expect(getByText('14:25')).toBeTruthy();
	});

	it('prints the verb only when there is one — a plain success stays quiet', () => {
		// Two copies by design (line 1 and the narrow-rail line 2); CSS shows one.
		const { getAllByText } = render(ActivitySentence, baseProps());
		expect(getAllByText('deployed', { exact: false }).length).toBeGreaterThan(0);
		const { container } = render(ActivitySentence, { ...baseProps(), kind: null, verb: '' });
		expect(container.textContent).not.toContain('deployed');
	});

	it('draws the old → new pair, the old one plain (an old version is not a deletion)', () => {
		const { getByText, container } = render(ActivitySentence, baseProps());
		const old = getByText('a1b2c3d');
		expect(old.className).not.toContain('line-through');
		expect(container.textContent).toContain('→');
		// the current build one step up, so it reads as current without a strike
		expect(getByText('e4f5a6b').className).toContain('text-fg-muted');
		expect(old.className).toContain('text-fg-subtle');
	});

	it('a plain success states its outcome to a screen reader, not as a tooltip', () => {
		const { container } = render(ActivitySentence, baseProps());
		const sr = container.querySelector('.sr-only');
		expect(sr?.textContent).toBe('deploy succeeded');
		expect(container.querySelector('[title="deploy succeeded"]')).toBeFalsy();
		const { container: failed } = render(ActivitySentence, { ...baseProps(), kind: 'failed' });
		expect(failed.querySelector('.sr-only')).toBeFalsy();
	});

	it('the narrow-rail verb copy is visual only', () => {
		const { container } = render(ActivitySentence, baseProps());
		expect(container.querySelector('.act-verb-narrow')?.getAttribute('aria-hidden')).toBe('true');
		expect(container.querySelector('.act-verb')?.getAttribute('aria-hidden')).toBeNull();
	});

	it('draws a status corner dot only when tone is set', () => {
		const { container: withTone } = render(ActivitySentence, { ...baseProps(), kind: 'failed' });
		expect(withTone.querySelector('.bg-danger-solid')).toBeTruthy();
		expect(withTone.textContent).toContain('failed to deploy');
		const { container: withoutTone } = render(ActivitySentence, baseProps());
		expect(withoutTone.querySelector('.bg-danger-solid')).toBeFalsy();
	});

	it('the verb escape hatch overrides the kind', () => {
		const { container } = render(ActivitySentence, { ...baseProps(), verb: 'restarted', tone: 'deploying' });
		expect(container.textContent).toContain('restarted');
		expect(container.querySelector('.bg-active-solid')).toBeTruthy();
	});

	it('drops the app where the page already names it, linking the row to href', () => {
		const { container } = render(ActivitySentence, {
			...baseProps(),
			app: null,
			appHref: null,
			href: '/rollouts/x/y'
		});
		expect(container.textContent).not.toContain('checkout-api');
		expect(container.querySelector('a.act-sentence-link')?.getAttribute('href')).toBe('/rollouts/x/y');
	});

	it('links the row to appHref by default, or to href when given', () => {
		const { container } = render(ActivitySentence, baseProps());
		expect(container.querySelector('a.act-sentence-link')?.getAttribute('href')).toBe(
			'/rollouts/x/checkout-api'
		);
		const { container: withHref } = render(ActivitySentence, { ...baseProps(), href: '/rollouts/x/y' });
		expect(withHref.querySelector('a.act-sentence-link')?.getAttribute('href')).toBe('/rollouts/x/y');
	});

	it('renders no env chip when env is null', () => {
		const { container } = render(ActivitySentence, { ...baseProps(), env: null });
		expect(container.querySelector('.chip-env')).toBeFalsy();
	});

	// jsdom does no layout, so this pins the CSS contract the 280px rail relies
	// on; the measured proof is the /design specimen (Playwright, 280/400/760).
	it('the object never truncates: the app is its own non-shrinking part; actor and verb shrink first', () => {
		const { container } = render(ActivitySentence, {
			...baseProps(),
			actor: { kind: 'controller' as const, name: 'kuberik' },
			kind: 'checking' as const,
			app: 'telemetry-forwarder'
		});
		const who = container.querySelector('.act-sentence-who');
		expect(who?.getAttribute('data-actor-kind')).toBe('controller');
		expect(who?.classList.contains('truncate')).toBe(false);
		// An automatic actor is never the subject: no "kuberik" text, app first.
		expect(container.querySelector('.act-actor')).toBeFalsy();
		expect(container.querySelector('.act-verb')?.textContent).toBe('is checking');
		const whoRow = container.querySelector('.act-sentence-who');
		expect(whoRow?.firstElementChild?.classList.contains('act-app')).toBe(true);
		expect(container.querySelector('.act-app')?.textContent).toBe('telemetry-forwarder');
		// The narrow-rail copy of the verb leads line 2 (CSS shows exactly one).
		expect(container.querySelector('.act-sentence-rest .act-verb-narrow')?.textContent).toBe('is checking');
	});

	it('a controller in a state draws the StatusMark, never a dot on the kuberik mark', () => {
		const { container } = render(ActivitySentence, {
			...baseProps(),
			actor: { kind: 'controller' as const, name: 'kuberik' },
			kind: 'checking' as const
		});
		expect(container.querySelector('.act-corner')).toBeFalsy();
		expect(container.querySelector('.act-sentence-avatar img')).toBeFalsy();
		const { container: person } = render(ActivitySentence, { ...baseProps(), kind: 'failed' as const });
		expect(person.querySelector('.act-corner')).toBeTruthy();
	});

	it("a person's name is always visible text, even with repeatActor", () => {
		const { container } = render(ActivitySentence, { ...baseProps(), kind: 'failed' as const, repeatActor: true });
		const actor = container.querySelector('.act-actor');
		expect(actor?.textContent).toBe('danielreed');
		// No rule in the component may hide a person's name.
		const css = [...document.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n');
		expect(css).not.toMatch(/\.act-actor\s*\{[^}]*display:\s*none/);
	});

	it('the new build links to its build page when toHref is given', () => {
		const { container } = render(ActivitySentence, { ...baseProps(), toHref: '/changes/x/build/e4f5a6b' });
		const a = [...container.querySelectorAll('a')].find((e) => e.textContent === 'e4f5a6b');
		expect(a?.getAttribute('href')).toBe('/changes/x/build/e4f5a6b');
	});

	it('a person stays the subject; an automatic success shows the resting dot, not a mascot', () => {
		const { container } = render(ActivitySentence, { ...baseProps(), kind: 'promoted' as const });
		expect(container.querySelector('.act-actor')?.textContent).toBe('danielreed');
		expect(container.querySelector('.act-verb')?.textContent).toBe('promoted');
		const { container: auto } = render(ActivitySentence, {
			...baseProps(),
			actor: { kind: 'controller' as const, name: 'kuberik' },
			kind: 'promoted' as const
		});
		expect(auto.querySelector('.act-verb')?.textContent).toBe('was promoted');
		expect(auto.querySelector('.act-sentence-avatar img')).toBeFalsy();
		expect(auto.querySelector('.act-sentence-avatar .bg-success-solid')).toBeTruthy();
	});

	it('names the environment as plain text, not a chip', () => {
		const { container } = render(ActivitySentence, baseProps());
		expect(container.querySelector('.act-env')?.textContent).toBe('prod');
		expect(container.querySelector('.act-sentence-rest [class*="border"]')).toBeFalsy();
	});
});

describe('ActivitySentence — a resolved failure is neutral, never red (qa9 B1)', () => {
	it('a live failure (the default) draws danger ink and the danger corner', () => {
		const { container } = render(ActivitySentence, { ...baseProps(), kind: 'failed' as const });
		expect(container.querySelector('.act-verb')?.className).toContain('text-danger');
		expect(container.querySelector('.bg-danger-solid')).toBeTruthy();
		expect(container.querySelector('.bg-fg-subtle')).toBeFalsy();
	});

	it('a resolved failure (live=false) drops the danger ink and corner for a neutral one', () => {
		const { container } = render(ActivitySentence, { ...baseProps(), kind: 'failed' as const, live: false });
		const verb = container.querySelector('.act-verb');
		expect(verb?.textContent).toBe('failed to deploy');
		expect(verb?.className).not.toContain('text-danger');
		expect(verb?.className).toContain('text-fg-subtle');
		expect(container.querySelector('.bg-danger-solid')).toBeFalsy();
		// The corner mark is still drawn (it WAS a failure) — just neutral.
		expect(container.querySelector('.act-corner.bg-fg-subtle')).toBeTruthy();
	});

	it('an automatic row resolved failure draws the neutral StatusMark, not the red disc', () => {
		const { container } = render(ActivitySentence, {
			...baseProps(),
			actor: { kind: 'controller' as const, name: 'kuberik' },
			kind: 'failed' as const,
			live: false
		});
		expect(container.querySelector('.bg-danger-solid')).toBeFalsy();
		expect(container.querySelector('.bg-subtle')).toBeTruthy();
	});

	it('live only matters for a failed tone — a live deploying row is unaffected', () => {
		const { container } = render(ActivitySentence, {
			...baseProps(),
			actor: { kind: 'controller' as const, name: 'kuberik' },
			kind: 'checking' as const,
			live: false
		});
		expect(container.querySelector('.bg-progress-tint')).toBeTruthy();
	});
});
