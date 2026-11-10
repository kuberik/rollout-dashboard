import type { NodeState } from './promotion-lanes';
import { failurePhrase } from '$lib/utils';

/**
 * THE ONE ACTIVITY VOCABULARY. Every activity row (`ActivitySentence`: Home's
 * rail, `/activity`, `/apps/<name>`, the change pages) reads its verb and its
 * ink from here, so three callers can never grow three dialects again.
 *
 * A person's row is actor-first ("danielreed deployed checkout-api"); an
 * automatic row (controller, CI) leads with the app ("checkout-edge is
 * deploying") and reads `appVerb`. Tone is the state ink and the
 * avatar's corner dot; `null` is the norm and spends no hue (a plain deploy,
 * a promotion, a rollback, an approval).
 */
export type ActivityKind =
	| 'deployed'
	| 'promoted'
	| 'rolledBack'
	| 'failed'
	| 'failedHealthCheck'
	| 'deploying'
	| 'checking'
	| 'held'
	| 'approved'
	| 'pinned';

/**
 * Two forms per kind, one table. `verb` is for a PERSON subject ("danielreed
 * promoted checkout-api"); `appVerb` is for the APP as subject, which is how
 * an automatic row reads (coordinator 2026-10-10: the controller is never the
 * subject; "checkout-edge is deploying", "orders-api was promoted").
 */
const VERBS: Record<ActivityKind, { verb: string; appVerb: string; tone: NodeState | null }> = {
	deployed: { verb: 'deployed', appVerb: 'deployed', tone: null },
	promoted: { verb: 'promoted', appVerb: 'was promoted', tone: null },
	rolledBack: { verb: 'rolled back', appVerb: 'rolled back', tone: null },
	// Both failure verbs are spelled ONCE, in `failurePhrase` (`lib/utils.ts`)
	// — never literally here. See qa11 B4: a grouped `/activity` row used to
	// read the generic phrase for an event the Needs-you row correctly named
	// as a health check, because the two spellings lived in two places.
	failed: { verb: failurePhrase(null), appVerb: failurePhrase(null), tone: 'failed' },
	// ⛔ SAME TONE, DIFFERENT CAUSE — see `activity-kind.ts`'s doc comment.
	// The Needs-you row for this exact event names the health check, never
	// "deploy"; this verb matches it instead of repeating the generic one.
	failedHealthCheck: {
		verb: failurePhrase('health check'),
		appVerb: failurePhrase('health check'),
		tone: 'failed'
	},
	deploying: { verb: 'is deploying', appVerb: 'is deploying', tone: 'deploying' },
	checking: { verb: 'is checking', appVerb: 'is checking', tone: 'checking' },
	held: { verb: 'held', appVerb: 'is held', tone: 'held' },
	approved: { verb: 'approved', appVerb: 'was approved', tone: null },
	pinned: { verb: 'pinned', appVerb: 'was pinned', tone: null }
};

export function activityVerb(kind: ActivityKind): { verb: string; appVerb: string; tone: NodeState | null } {
	return VERBS[kind];
}
