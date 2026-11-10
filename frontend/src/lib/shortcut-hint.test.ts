import { describe, it, expect } from 'vitest';
import { modEnterHint } from './shortcut-hint';

describe('modEnterHint (QA #22)', () => {
	it('Mac gets the command glyph', () => expect(modEnterHint('MacIntel')).toBe('⌘↵'));
	it('Linux and Windows get Ctrl', () => {
		expect(modEnterHint('Linux x86_64')).toBe('Ctrl ↵');
		expect(modEnterHint('Win32')).toBe('Ctrl ↵');
	});
	it('unknown (SSR) is not the Apple glyph', () => expect(modEnterHint(undefined)).toBe('Ctrl ↵'));
});
