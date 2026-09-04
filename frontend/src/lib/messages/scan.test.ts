import { describe, test, expect } from 'vitest';
import { scanMarkup, isProse, type Literal } from './scan';

function scan(src: string): Literal[] {
	const out: Literal[] = [];
	scanMarkup(src, 'fixture.svelte', out);
	return out;
}

function texts(src: string): string[] {
	return scan(src).map((l) => l.text);
}

describe('scanMarkup', () => {
	/**
	 * THE SECOND REGRESSION (2026-09-04). A doc comment in `activity/+page.svelte`
	 * mentioned `<style>` in backticks. Comments were stripped AFTER the block
	 * tags, so the mention was taken for the real opening tag, the non-greedy
	 * match ran to the file's real `</style>` at the bottom, and ten empty-state
	 * strings vanished from the census while the suite stayed green.
	 */
	test('a <style> or <script> mention inside an HTML comment does not swallow the markup after it', () => {
		const src = `
			<div>
				<!-- The control strip. Its geometry lives in the \`<style>\` block below;
				     the \`<script>\` above owns the filter state. -->
				<p>Nothing has deployed yet</p>
				<button>Clear all filters</button>
			</div>
			<style>
				.x { color: red; }
			</style>
		`;
		expect(texts(src)).toEqual(['Nothing has deployed yet', 'Clear all filters']);
	});

	test('real script and style blocks are still stripped', () => {
		const src = `
			<script lang="ts">
				const label = 'This sentence is not a message.';
			</script>
			<p>This sentence is shown to the reader.</p>
			<style>
				p { content: 'This sentence is not a message either.'; }
			</style>
		`;
		expect(texts(src)).toEqual(['This sentence is shown to the reader.']);
	});

	/**
	 * THE REGRESSION. `LogsViewer.svelte` lost its entire tail to this: a
	 * `// Don't allow ...` line comment inside a `DropdownItem`'s
	 * `onclick={...}` attribute. `skipExpr` tracked quotes without knowing
	 * about comments, so the apostrophe in "Don't" was read as opening a
	 * `'...'` string literal, which did not close until the NEXT real
	 * apostrophe anywhere later in the file -- silently swallowing every tag
	 * and text node in between as "inside an expression."
	 */
	test('a line comment with an apostrophe inside an attribute expression does not swallow the rest of the file', () => {
		const src = `
			<div>
				<DropdownItem
					onclick={(e) => {
						// Don't allow hiding all columns
						doThing();
					}}
				>
					<span>Show All</span>
				</DropdownItem>
				<p>Failed to load logs</p>
				<p>No log lines yet</p>
			</div>
		`;
		expect(texts(src)).toEqual(
			expect.arrayContaining(['Show All', 'Failed to load logs', 'No log lines yet'])
		);
	});

	test('a block comment with an apostrophe inside an attribute expression does not swallow the rest of the file', () => {
		const src = `
			<div>
				<Button
					onclick={() => {
						/* it's fine, retry */
						retry();
					}}
				>
					Retry loading
				</Button>
				<p>No log lines yet</p>
			</div>
		`;
		expect(texts(src)).toEqual(expect.arrayContaining(['Retry loading', 'No log lines yet']));
	});

	test('a line comment with an apostrophe inside a bare {expression} hole (not an attribute) does not swallow the rest of the file', () => {
		const src = `
			<div>
				{#if x}
					{
						// Don't do the thing
						void 0
					}
				{/if}
				<p>No log lines yet</p>
			</div>
		`;
		expect(texts(src)).toEqual(expect.arrayContaining(['No log lines yet']));
	});

	test('a genuine string literal holding an apostrophe still closes normally', () => {
		const src = `
			<div>
				<Button onclick={() => setLabel("Don't panic")}>Go</Button>
				<p>No log lines yet</p>
			</div>
		`;
		expect(texts(src)).toEqual(expect.arrayContaining(['No log lines yet']));
	});

	test('ordinary prose text nodes are still censused', () => {
		const src = `<div><p>Failed to load logs</p></div>`;
		expect(texts(src)).toContain('Failed to load logs');
	});

	test('whitelisted attributes on plain elements are still censused', () => {
		const src = `<input placeholder="Search logs..." aria-label="Search logs" />`;
		const found = scan(src);
		expect(found).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: 'placeholder', text: 'Search logs...' }),
				expect.objectContaining({ kind: 'aria-label', text: 'Search logs' })
			])
		);
	});
});

describe('isProse', () => {
	test('rejects short and single-word strings', () => {
		expect(isProse('Retry')).toBe(false);
		expect(isProse('ok')).toBe(false);
	});

	test('accepts a real sentence', () => {
		expect(isProse('Failed to load logs')).toBe(true);
	});
});
