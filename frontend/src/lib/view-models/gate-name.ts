/**
 * THE ONE GATE NAME (QA #17). A gate is named exactly one way on every surface (Gates tab, deploy / override / rollback dialogs, held
 * reasons): the published `gate.kuberik.com/pretty-name` on its object, else a hand-authored resource name made readable, else for a
 * generated id that explains nothing (`ghd-6p5hd`) the plain word "Gate" (DESIGN.md: a generated name is never promoted into a sentence).
 * A leaf module (no imports) so schedules, auto-deploy, blocking-story, the dialogs and the pages can all share it.
 */
export const PRETTY_NAME_KEY = 'gate.kuberik.com/pretty-name';

/** The name a gate object (or schedule) published for itself, or null. */
export function prettyNameOf(meta?: { annotations?: Record<string, string> } | null): string | null {
	return meta?.annotations?.[PRETTY_NAME_KEY] || null;
}

/** `release-approval` → `Release approval`. A name, not a sentence. */
export function humanizeGateName(name: string): string {
	const words = name.replace(/[-_.]+/g, ' ').trim();
	if (!words) return name;
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A Kubernetes `generateName` suffix: five characters from the apiserver's consonant/digit alphabet (`ghd-6p5hd`, `schedule-gate-zvsqr`). */
const GENERATED_SUFFIX = /-[bcdfghjklmnpqrstvwxz2456789]{5}$/;
export function isGeneratedGateName(name: string): boolean {
	return GENERATED_SUFFIX.test(name);
}

/**
 * ⭐ THE ONE DISPLAY NAME FOR A GATE (QA #17). Every surface that prints a gate — the Gates tab, the deploy / override / rollback
 * dialogs, the held reasons — goes through this, so a raw resource name never reaches a reader in one place and a pretty one in
 * another. Order: the gate's published `gate.kuberik.com/pretty-name`; else a hand-authored name made readable
 * (`hello-world-manifests-manual-approval` -> "Hello world manifests manual approval"); else, for a generated id that explains nothing
 * (`ghd-6p5hd`), the plain word "Gate" — a generated name is never promoted into a sentence (DESIGN.md).
 */
export function gateDisplayName(name: string, pretty?: string | null): string {
	if (pretty) return pretty;
	if (isGeneratedGateName(name)) return 'Gate';
	return humanizeGateName(name);
}


/** The display name of the gate called `name`, looking its published name up in the gate objects the caller has (any list; may be empty). */
export function resolveGateName(
	name: string,
	objects: readonly { metadata?: { name?: string; annotations?: Record<string, string> } }[] = []
): string {
	const obj = objects.find((o) => o?.metadata?.name === name);
	return gateDisplayName(name, prettyNameOf(obj?.metadata));
}
