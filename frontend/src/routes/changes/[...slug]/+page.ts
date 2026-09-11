import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/**
 * ⭐ FIX PASS ITEM 3 (2026-09-10) — THE HOST-LESS LEGACY SLUG SHAPE.
 *
 * `+page.svelte`'s own `changeOwnerRepo` only recognises a slug whose first
 * segment is literally `github.com` (`parts[0] !== 'github.com' → null`),
 * which is correct for the CURRENT canonical address `changePath` (in both
 * `pr-ref.ts` and `palette-index.ts`, the latter fixed alongside this file)
 * now always builds. But `⌘K`'s palette used to build a HOST-LESS form —
 * `/changes/<owner>/<repo>/pull/<n>` / `/changes/<owner>/<repo>/<sha>` — and
 * every one of those rows, plus any bookmark or pasted link built off the
 * old shape, still points there. Landing on one rendered "This repository
 * does not exist" instead of the change page. This 308s the host-less form
 * to its canonical `github.com/...` address so an old link still resolves.
 *
 * RULE: the first segment is a HOST when it contains a dot (`github.com`,
 * a self-hosted `gitlab.example.com`, …) — a real GitHub owner name never
 * does. Only slugs with at least 3 segments are eligible
 * (`<owner>/<repo>/<sha>` is the shortest host-less change-ref shape) — a
 * 1-2 segment slug is either a repository page or an `app:`-fallback
 * build page (`<appName>/<version>`, `version-utils.ts`'s own
 * `repoKeyFromSource` fallback for a rollout with no linked source), and
 * those have no `github.com` prefix EVER, host-less or not — redirecting
 * them would send a real "no linked repository" page off to a GitHub
 * address that does not exist. A slug that is already `github.com/...`
 * (segment[0] has a dot) or that is too short falls through unredirected;
 * `+page.svelte`'s own resolution (repo page, then `parseChangeSlug`, then
 * "not found") is unchanged for every other case.
 */
export const load: PageLoad = ({ params }) => {
	const raw = params.slug ?? '';
	const segments = raw.split('/').filter((s) => s.length > 0);
	if (segments.length >= 3 && !segments[0].includes('.')) {
		redirect(308, `/changes/github.com/${raw}`);
	}
};
