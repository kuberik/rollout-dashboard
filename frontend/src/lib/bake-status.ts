/**
 * ⛔ `baking` WAS THE LAST WORD THE PRODUCT SPELLED ITS OWN WAY. (2026-08-30)
 *
 * The novice pass renamed `Median bake` → `Typical deploy` on the grounds that
 * *"bake is this product's own word"*, and `/activity`'s pass renamed the
 * STATUS word on that one page. Every other surface kept `baking`, so one
 * state had two spellings on adjacent pages — the exact split `−N` vs
 * `N behind` cost a dedicated pass to close.
 *
 * ── THE RULING: IT IS JARGON, AND IT IS `checking`. ───────────────────────
 *
 * `bake` is the CRD's field name (`spec.bakeTime`, `status.history[].bakeStatus`).
 * It is not English, not Kubernetes and not git; a competent engineer who has
 * never seen kuberik cannot tell from `baking` whether anything is wrong,
 * whether it will clear, or whether they must act. That is the definition of
 * mechanism-over-consequence this file's own rule forbids.
 *
 * ⚠️ WHY ONE WORD AND NOT `/activity`'S PHRASE. That page shipped
 * `live, being checked`, which is better prose and is what the TITLE below
 * still says. It cannot be the product's word, because four of the seven slots
 * that hold this string are not sentences — `baking >1h`, `deploying & baking
 * right now`, `baking 2h`, a dot's one-word label. A phrase with a comma does
 * not decline into those, and spelling it two ways is the defect being closed.
 * So the WORD is `checking` everywhere and the SENTENCE rides in the `title`.
 *
 * ⚠️ THE HUE DISTINCTION IS UNTOUCHED. `DESIGN.md` binds this state to YELLOW
 * and `Deploying` to BLUE and says they may never share a value. `checking`
 * and `deploying` are two distinct verbs for two distinct phases — the new
 * version is going out, versus the new version is already serving and is being
 * watched — so the rename sharpens that distinction rather than blurring it.
 * No colour value moves.
 *
 * ⛔ AND `Bake succeeded` / `Bake failed` / `Bake cancelled` / `no bake status`
 * GO WITH IT. Renaming the verb and leaving its own family behind is how the
 * split happened the first time. The terminal words are `/activity`'s, which
 * is the page that already did this work.
 */
export const BAKE_WORD: Record<string, string> = {
    Succeeded: 'deploy succeeded',
    Failed: 'deploy failed',
    InProgress: 'checking',
    Deploying: 'deploying',
    Cancelled: 'stopped',
    None: 'no deploy yet'
};

/** The product's ONE word for a deploy state. Total — never returns empty. */
export function bakeWord(bakeStatus?: string): string {
    return BAKE_WORD[bakeStatus ?? 'None'] ?? BAKE_WORD.None;
}

/**
 * The consequence in a sentence, for the `title` of whatever prints the word.
 * This is where `/activity`'s `live, being checked` survives: the fact that
 * distinguishes this state from `deploying` is that the new version is ALREADY
 * SERVING, and a one-word label cannot carry it.
 */
export const BAKE_TITLE: Record<string, string> = {
    Succeeded: 'The deploy finished and passed its checks',
    Failed: 'The deploy failed',
    InProgress: 'The new version is live and is being watched before the deploy counts as done',
    Deploying: 'The new version is still going out',
    Cancelled: 'The deploy was stopped before it finished',
    None: 'Nothing has been deployed here yet'
};

export function bakeTitle(bakeStatus?: string): string {
    return BAKE_TITLE[bakeStatus ?? 'None'] ?? BAKE_TITLE.None;
}

export function getBakeStatusColor(
    bakeStatus?: string
): 'green' | 'red' | 'yellow' | 'blue' | 'gray' {
    switch (bakeStatus) {
        case 'Succeeded':
            return 'green';
        case 'Failed':
            return 'red';
        case 'InProgress':
            return 'yellow';
        case 'Deploying':
            return 'blue';
        default:
            return 'gray';
    }
}

// Returns the tailwind class string for the soft "status circle" bg
// in both light and dark mode. Centralised so the circle background
// always matches the spinner/icon colour (e.g. blue circle behind
// the blue Deploying spinner, not yellow).
export function getStatusCircleClass(bakeStatus?: string): string {
    // PER-STATUS TINT, RESTORED 2026-08-26 on the human's instruction:
    // *"I generally think we're undercoloring now a bit"*.
    //
    // This function was flattened to ONE neutral gray ground two days earlier,
    // on the theory that the glyph inside the disc already carries the hue and
    // the tint was a "second green". That over-applied "mark the deviation,
    // never the norm" into plain desaturation, and it stripped the status
    // circle — the atom `HANDOFF.md` §3/§5/§6/§7 all specify by name — on four
    // pages at once.
    //
    // The budget was never "use as few hues as possible"; it is "no hue outside
    // the set". The set is six — green Succeeded, YELLOW checking, BLUE
    // deploying, red Failed, amber stuck, gray pending — and checking and
    // deploying must not share a value. Those are the human's own semantics
    // and this function is one of the two places (with `BakeStatusIcon`) that
    // spends them.
    //
    // The tint stays at the -100 step deliberately: measured, a 32px disc of
    // `green-100` is ~35 units of ink (804px^2 x 0.0434 OKLCH chroma) against
    // the `stuck` alarm chip's ~159, so the disc is still 4.5x quieter than the
    // alarm and the invariant that nothing out-shouts the alarm holds.
    const c = getBakeStatusColor(bakeStatus);
    switch (c) {
        case 'green':
            return 'bg-green-100 dark:bg-green-900/30';
        case 'red':
            return 'bg-red-100 dark:bg-red-900/30';
        case 'yellow':
            return 'bg-yellow-100 dark:bg-yellow-900/30';
        case 'blue':
            return 'bg-blue-100 dark:bg-blue-900/30';
        default:
            return 'bg-gray-100 dark:bg-gray-700/60';
    }
}

// Returns the tailwind class for the animate-ping ring inside a status
// circle. Matches the circle bg color so Deploying pings in blue and
// InProgress pings in yellow.
export function getStatusPingClass(bakeStatus?: string): string {
    const c = getBakeStatusColor(bakeStatus);
    switch (c) {
        case 'blue':
            return 'bg-blue-400/40';
        case 'yellow':
            return 'bg-yellow-400/30';
        default:
            return 'bg-yellow-400/30';
    }
}

// Shared translation from the Rollouts-list statusKey vocabulary
// (succeeded|failed|active|pending) to the bakeStatus values the
// getStatusCircleClass/getBakeStatusColor helpers expect. Centralised so
// every view (matrix cells, list rows, ...) that only has a statusKey
// still renders the same dot color as views that have the raw bakeStatus.
export function statusKeyToBakeStatus(statusKey: string): string | undefined {
    switch (statusKey) {
        case 'succeeded':
            return 'Succeeded';
        case 'failed':
            return 'Failed';
        case 'active':
            return 'Deploying';
        default:
            return undefined;
    }
}

export type HistoryTick = 'ok' | 'fail' | 'active' | 'none';

// Shared translation from a deploy-history tick outcome to the bakeStatus
// value that produces the matching color, so history strips always match
// the rest of the app's status coloring rather than inventing a parallel
// palette.
export function tickToBakeStatus(tick: HistoryTick): string | undefined {
    switch (tick) {
        case 'ok':
            return 'Succeeded';
        case 'fail':
            return 'Failed';
        case 'active':
            return 'Deploying';
        default:
            return undefined;
    }
}
