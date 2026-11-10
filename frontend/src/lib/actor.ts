/**
 * WHO DID IT — the one adapter from a deploy's `triggeredBy` to the actor a
 * row names and `Avatar` draws. (Home v2, CRAFT-STUDY P5 "identity
 * before reading", 2026-10-09.) Its output is `Avatar.svelte`'s props:
 * `<Avatar {...actorFrom(entry.triggeredBy)} />`.
 *
 * Three kinds, because an operator reads them differently:
 *   - `person`     a human pressed something (an approval, a change of
 *                  version, a retry). Their name and face.
 *   - `ci`         an automation account acting on a human's behalf (a
 *                  workflow, a bot). Named, with a neutral workflow glyph.
 *   - `controller` kuberik itself promoted the build because every gate
 *                  passed. Drawn as the kuberik mark, never the word
 *                  "System" (the CRD's literal value, which reads as an
 *                  error to a person).
 *
 * Pure: no demo import. A caller that knows a picture (the GitHub status, the
 * demo's data-URI authors) passes it as `src`; this never fetches one.
 */

export type ActorKind = 'person' | 'ci' | 'controller';

export type Actor = {
	kind: ActorKind;
	/** What a sentence prints: a login, a bot's name, or `kuberik`. */
	name: string;
	/** A picture for a person, when the caller has one. Data URI or same-origin only. */
	src?: string;
};

/** The controller's printed name. One spelling product-wide. */
export const CONTROLLER_NAME = 'kuberik';

const CI_NAME = /(\[bot\]$|^github-actions|^dependabot|^renovate|-bot$|^bot-|^ci$|^ci-|-ci$)/i;

export function actorFrom(
	triggeredBy?: { kind?: string | null; name?: string | null } | null,
	src?: string
): Actor {
	const kind = (triggeredBy?.kind ?? '').toLowerCase();
	const name = (triggeredBy?.name ?? '').trim();
	if (!name || kind === 'system' || name.toLowerCase() === 'system') {
		return { kind: 'controller', name: CONTROLLER_NAME };
	}
	if (CI_NAME.test(name) || kind === 'serviceaccount' || kind === 'ci') {
		return { kind: 'ci', name };
	}
	return src ? { kind: 'person', name, src } : { kind: 'person', name };
}
