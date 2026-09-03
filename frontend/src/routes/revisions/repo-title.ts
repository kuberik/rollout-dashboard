/**
 * ⭐ A CARD WHOSE TITLE IS A URL SHOWS THE REPO, NOT THE HOST.
 *
 * (2026-09-02, from the human, on `/versions` at 1440: *"the rail card
 * `github.com/littlechimera…` truncates its own title. A card whose title is
 * a URL should show the repo, not the host."*)
 *
 * ── THE ARITHMETIC, BECAUSE ONE STEP OF SHORTENING WAS NOT ENOUGH ────────
 *
 * `repoLabel()` returns the whole origin-qualified body,
 * `github.com/littlechimera/kuberik-testing` — 40 characters. The rail is
 * 340px; a `Card` header spends 16px of padding a side, 16 + 10 on the icon
 * and its gap, and holds an `N services` rollup hard right, which leaves the
 * 14px/600 title about **190px**. Measured on the running page:
 *
 *   `github.com/littlechimera/kuberik-testing`  40ch → clipped at `github.com/littlechimera…`
 *   `littlechimera/kuberik-testing`             29ch → still clipped, at `littlechimera/kuberik-te…`
 *   `kuberik-testing`                           15ch → **fits, ~106px**
 *
 * Dropping only the host leaves the OWNER eating the budget, and on a fleet
 * whose repos share one org the owner is the segment that is identical on
 * every card — the same defect as the host, one step in. The repository NAME
 * is the segment that distinguishes one card from another, so it is the one
 * that gets the 190px.
 *
 * ⛔ NOTHING IS DELETED, IT IS DEMOTED. `repoTitleFull` is the origin-
 * qualified label and rides as a `title` where the element can take one — the
 * detail page's hero meta. The rail CARD's title cannot (`Card` owns its own
 * `<h2>` and this pass does not own `Card`), so there the full label is on
 * the `View repository` link in the same card's body, which is the one
 * control that resolves to it. `repoSlug()` still puts the host and the owner
 * in every `/versions/<repo>/<rev>` URL. What changes is which of the three
 * segments is DRAWN.
 *
 * ⛔ AND IT DOES NOT TOUCH `repoLabel()`. That is the grouping and URL
 * identity `revision-ledger.ts` and `version-utils` round-trip through; this
 * is a PRESENTATION of it, for the two slots that are width-bound. The `app:`
 * fallback (`<name> (no linked repository)`) has no `/` and passes through
 * untouched — it is already a name, not a URL, and shortening it would eat
 * the clause that says why there is no link.
 */

/** `github.com/littlechimera/kuberik-testing` → `kuberik-testing`. */
export function repoTitle(label: string): string {
	const segs = label.split('/');
	return segs[segs.length - 1] || label;
}

/**
 * The origin-qualified label, for the `title` of a shortened one. `null` when
 * nothing was dropped, so an element never carries an attribute that repeats
 * its own text.
 */
export function repoTitleFull(label: string): string | null {
	return repoTitle(label) === label ? null : label;
}
