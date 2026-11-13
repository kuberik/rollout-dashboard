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

/**
 * ⭐ `STUCK_INK` — THE PLAIN-TEXT TONE FOR `stuck`, AND THE ONE PLACE A
 * CALL SITE MAY GET IT. (2026-10-09, coordinator correction, integration
 * round 3.) This file's own `getStatusCircleClass` comment two blocks down
 * already states the budget: "green Succeeded, YELLOW checking, BLUE
 * deploying, red Failed, amber stuck, gray pending" — yellow is `checking`
 * (`InProgress`), amber is `stuck`, and the two may never share a value.
 * `apps/[name]/+page.svelte`'s Needs-you row glyph shipped reading
 * `text-yellow-700 dark:text-yellow-400` for a stuck environment, which is
 * the `checking` ink on the `stuck` mark — the exact confusion this rule
 * exists to prevent. `AlertPanel.svelte`'s own stuck banner
 * (`text-amber-700 dark:text-amber-300`, line ~424) and `Chip`'s `alarm`
 * role already carry the correct hue as hand-rolled classes with no shared
 * name; this is that name. A call site reaches for `STUCK_INK`, never a
 * raw `amber-700`/`amber-300` pair of its own — one value, one place it
 * can drift from `AlertPanel`'s.
 */
export const STUCK_INK = 'text-amber-700 dark:text-amber-300';

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
