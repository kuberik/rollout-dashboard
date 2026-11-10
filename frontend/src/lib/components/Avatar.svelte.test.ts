import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import Avatar from './Avatar.svelte';

describe('Avatar', () => {
	it('draws the picture when src is known', () => {
		const { getByRole, container } = render(Avatar, { name: 'danielreed', src: 'data:image/png;base64,AA==' });
		expect(getByRole('img', { name: 'danielreed' })).toBeTruthy();
		expect(container.querySelector('img')?.getAttribute('src')).toContain('data:image/png');
	});
	it('falls back to a NEUTRAL disc (raised surface, muted initials), never a hashed hue', () => {
		const { container } = render(Avatar, { name: 'mark-collins' });
		const initial = container.querySelector('.avatar-initial');
		expect(initial?.textContent).toBe('M'); // 16px: one letter
		expect((initial as HTMLElement).style.color).toBe('');
		expect((container.querySelector('.avatar') as HTMLElement).style.background).toBe('');
		expect(container.querySelector('.avatar')?.classList.contains('avatar-fallback')).toBe(true);
		// From 20px: AppGlyph's monogram rule, so two authors starting with D differ.
		const at20 = (n: string) => render(Avatar, { name: n, size: 20 }).container.querySelector('.avatar-initial')?.textContent;
		expect(at20('mark-collins')).toBe('MC');
		expect(at20('paul-stevens')).not.toBe(at20('peter-hall'));
	});
	it('never fills a photo or a controller/CI mark with the identity colour', () => {
		const photo = render(Avatar, { name: 'danielreed', src: 'data:image/png;base64,AA==' }).container.querySelector(
			'.avatar'
		) as HTMLElement;
		expect(photo.style.background).toBe('');
		const controller = render(Avatar, { name: 'x', kind: 'controller' }).container.querySelector(
			'.avatar'
		) as HTMLElement;
		expect(controller.style.background).toBe('');
	});
	it('names the controller and CI actors', () => {
		expect(render(Avatar, { name: 'x', kind: 'controller' }).getByRole('img', { name: 'kuberik (automatic)' })).toBeTruthy();
		expect(render(Avatar, { name: 'build', kind: 'ci' }).getByRole('img', { name: 'build (CI)' })).toBeTruthy();
	});
	it('sizes on the icon grid', () => {
		const { container } = render(Avatar, { name: 'a', size: 24 });
		expect((container.querySelector('.avatar') as HTMLElement).style.width).toBe('24px');
	});
});
