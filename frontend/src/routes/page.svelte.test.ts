import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import Page from './+page.svelte';

// THIS TEST WAS RED FOR THE WHOLE LIFE OF THE PROJECT, FOR TWO SEPARATE
// REASONS, AND NEITHER WAS THE ASSERTION (2026-08-27).
//
//  1. HARNESS. `render(Page)` mounts the page with no `+layout.svelte` above
//     it, so there is no `QueryClientProvider`. `ControlCenter` calls
//     `createQuery` at init, `useQueryClient()` throws "No QueryClient was
//     found in Svelte context", and the page produced no DOM at all — the
//     failure never got as far as looking for a heading. Fixed by
//     `WithQueryClient`, which is the same provider the real layout mounts.
//  2. SUBJECT. `/` genuinely had no `<h1>`. It opened on four sibling `<h2>`s
//     ("Needs you now" / "In motion" / "Trailing" / "Steady") with no page
//     title above them, and it was the ONLY page in the product like that —
//     `/rollouts`, `/apps`, `/versions`, `/environments`, `/activity` and
//     every detail route all print an `<h1>`. Fixed in `ControlCenter.svelte`
//     with an `sr-only` heading: zero pixels, because `/` is under a standing
//     "must not change visually" constraint and Home is deliberately the one
//     page with no printed title.
//
// So it was never a stale test. It was a real accessibility gap that a broken
// harness had been hiding behind a thrown exception.
describe('/+page.svelte', () => {
	test('should render h1', () => {
		render(WithQueryClient, { props: { component: Page } });
		expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
	});

	// The h1 must not become visible. `sr-only` is the mechanism and it is the
	// only thing keeping this page's heading fix inside the "do not change `/`
	// visually" constraint, so it is asserted rather than left to a comment.
	test('the home h1 is screen-reader-only, so `/` is unchanged visually', () => {
		render(WithQueryClient, { props: { component: Page } });
		expect(screen.getByRole('heading', { level: 1 })).toHaveClass('sr-only');
	});
});
