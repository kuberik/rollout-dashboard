/**
 * The Cmd/Ctrl + Enter hint, spelled for the reader's platform (QA #22: the deploy dialog showed the Apple glyph on Linux).
 * The same Mac/iOS test the Navbar's search hint uses, in one place.
 */
export function isApplePlatform(platform: string | null | undefined): boolean {
	return /Mac|iPhone|iPad/.test(platform ?? '');
}

export function modEnterHint(platform: string | null | undefined): string {
	return isApplePlatform(platform) ? '⌘↵' : 'Ctrl ↵';
}
