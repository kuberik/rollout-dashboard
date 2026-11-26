import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import Highlight from 'svelte-highlight';
import yaml from 'svelte-highlight/languages/yaml';
import logoDark from '$lib/assets/logo-rotate-dark.svg?raw';
import logoLight from '$lib/assets/logo-rotate-light.svg?raw';

describe('untrusted {@html} sources', () => {
	it('svelte-highlight (SourceViewer) renders YAML payloads as text', () => {
		const code = 'a: <img src=x onerror=alert(1)>\nb: <script>alert(1)</script>';
		const { container } = render(Highlight, { language: yaml, code });
		expect(container.querySelector('img,script')).toBeNull();
		expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
	});
	it('bundled logos (Navbar {@html}, static) carry no script or handlers', () => {
		for (const svg of [logoDark, logoLight]) {
			expect(svg).not.toMatch(/<script/i);
			expect(svg).not.toMatch(/\son[a-z]+\s*=/i);
			expect(svg).not.toMatch(/javascript:/i);
		}
	});
});
