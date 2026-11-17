import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/** Roll back and Retry confirms print a failed confirm through the same callout: one class set, an icon, inset above the footer. */
describe('both confirms draw their failure as the dialog callout', () => {
	for (const f of ['ChangeVersionModal.svelte', 'RetryConfirmModal.svelte']) {
		test(f, () => {
			const src = readFileSync(`src/lib/components/${f}`, 'utf8');
			expect(src).toContain('class={DIALOG_ERROR_CLASS}');
			expect(src).toMatch(/data-dialog-error>\s*<ExclamationCircleSolid/);
			expect(src).not.toMatch(/<p role="alert"[^>]*border-t/);
		});
	}
});
