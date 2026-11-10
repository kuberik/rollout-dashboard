/**
 * ⭐ ONE DOCUMENT-TITLE FORMAT, PRODUCT-WIDE. (U-25, 2026-10-08 polish pass;
 * capitalization + Home ruling corrected in the integrate-fixa pass that
 * followed.)
 *
 * A census of every route's own `<title>` found FOUR different shapes live
 * at once: `kuberik | Apps` (the pipe form, most routes), `e2c9b47 · kuberik`
 * and `#90 Fix … · kuberik` (the dot form, the change page's own pull/sha
 * titles — CHANGES-2026-09-10's superseded `/pr/…` route already used this
 * shape, and the change page inherited it), `kuberik | checkout-api
 * (checkout-api-prod-us-east-2) - Gates` (a THIRD separator, a hyphen,
 * stacked on top of the pipe), and Home, which printed the bare lowercase
 * `kuberik` (`ControlCenter.svelte`'s own `<svelte:head>`) with no page name
 * at all.
 *
 * The TL's ruling: **`<page> · Kuberik`** — the dot form the change page
 * already used, extended everywhere, with the product name capitalized (it
 * is a proper noun on every surface that isn't a URL or a code identifier —
 * the nav, the footer, every heading). **Home is the one exception: just
 * `Kuberik`, no page name prefixed** — it is the product's own front door,
 * not a page of it, the same reason the nav's own logo mark has no label
 * beside it on `/`.
 *
 * `pageTitle()` is the ONE place that string-templates `` `${name} · Kuberik` ``.
 * Every route in the product goes through it now — call `pageTitle('Apps')`
 * for a named page, or `pageTitle()` with no argument for Home's bare
 * `Kuberik`. The two off-limits files during this pass (the Gates tab and
 * `/dependencies`, both owned by other lanes at the time) were left alone;
 * flag them to those lanes rather than editing under this ticket.
 */
export function pageTitle(name?: string): string {
	return name ? `${name} · Kuberik` : 'Kuberik';
}
