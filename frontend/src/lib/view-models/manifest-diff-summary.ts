/**
 * ⭐ THE CARD HEADER'S HEADLINE CHANGE (AD round 1, item 3; squad lead's
 * own decision, round 4, 2026-10-09): "state the headline change in the
 * card header ('image b7e0d41 → d09e6f4 · replicas 4 → 6')." A reader
 * opening a resource's Card should get the ONE-LINE answer before reading
 * any diff body — the same "answer the card without reading a row of it"
 * rule every other card's rollup already follows (`Card`'s own doc
 * comment). `+N −M` states HOW MUCH changed; this states WHAT.
 *
 * Pure, and deliberately NOT a YAML parser: a real YAML parse would need a
 * dependency this route doesn't otherwise carry, and the manifests this
 * reads are the mock's own hand-written fixtures (`respond.ts`) — not
 * arbitrary cluster output this has to survive unknown shapes of. A small
 * set of line-anchored regexes over the two plain-text manifests covers
 * the fields an operator actually asks "what changed" about (the image
 * tag, replica count); anything else is silently skipped, never guessed.
 */

const FIELD_PATTERNS: { label: string; re: RegExp }[] = [
	// `image: ghcr.io/exampleco/checkout-edge:b7e0d41` → the TAG after the
	// last `:` (a registry host may itself contain `:<port>`, so this
	// anchors on the LAST colon on the line, not the first).
	{ label: 'image', re: /^\s*-?\s*image:\s*\S+:(\S+)\s*$/m },
	{ label: 'replicas', re: /^\s*replicas:\s*(\S+)\s*$/m }
];

/**
 * ⭐ ADDED ENV VARS, IN THE HEADLINE (AD round 4, item 7): "the headline
 * includes added env vars." `checkout-worker`'s own real diff fixture
 * (`CW_MANIFESTS`, `respond.ts`) is EXACTLY this case — a retry-budget env
 * var added between `3f1ed09` and `a02f1c4`, no image or replicas change at
 * all — so without this, that resource's own Card had no headline, the
 * empty case `FIELD_PATTERNS` alone left it in.
 *
 * Scoped to an `env:` block's own `- name: X` entries by INDENTATION, not a
 * bare `name:` regex — a container also has its own `- name: <container>`
 * line one level up, which is not an env var and must never count as one.
 */
function envVarNames(content: string): Set<string> {
	const names = new Set<string>();
	let inEnv = false;
	let envIndent = -1;
	for (const rawLine of content.split('\n')) {
		const trimmed = rawLine.replace(/^\s+/, '');
		const indent = rawLine.length - trimmed.length;
		if (/^env:\s*$/.test(trimmed)) {
			inEnv = true;
			envIndent = indent;
			continue;
		}
		if (!inEnv) continue;
		if (trimmed === '') continue;
		if (indent <= envIndent) {
			inEnv = false;
			continue;
		}
		const m = /^-\s*name:\s*(\S+)/.exec(trimmed);
		if (m) names.add(m[1]);
	}
	return names;
}

/**
 * ONE PIECE OF THE HEADLINE (squad-rollout, AD round 5, 2026-10-10). The
 * diff page draws the headline itself — field name in sans, values in mono,
 * the arrow quiet — so it needs the pieces, not the joined sentence.
 * `summarizeManifestChange` below is the same list joined, kept for the
 * page's `<title>`-style plain-text uses and for its existing tests.
 */
export type HeadlinePart =
	| { kind: 'field'; field: string; from: string; to: string }
	| { kind: 'added'; name: string }
	| { kind: 'removed'; name: string }
	| { kind: 'count'; text: string };

/**
 * `data:` keys of a ConfigMap-shaped manifest, one indent level under
 * `data:`, as `key → value` (quotes stripped). Nested maps are skipped.
 */
function dataEntries(content: string): Map<string, string> {
	const out = new Map<string, string>();
	let inData = false;
	let dataIndent = -1;
	let childIndent = -1;
	for (const rawLine of content.split('\n')) {
		const trimmed = rawLine.replace(/^\s+/, '');
		const indent = rawLine.length - trimmed.length;
		if (/^data:\s*$/.test(trimmed) && indent === 0) {
			inData = true;
			dataIndent = indent;
			childIndent = -1;
			continue;
		}
		if (!inData || trimmed === '') continue;
		if (indent <= dataIndent) {
			inData = false;
			continue;
		}
		if (childIndent === -1) childIndent = indent;
		if (indent !== childIndent) continue;
		const m = /^([A-Za-z0-9_.\-]+):\s*(.*)$/.exec(trimmed);
		if (m) out.set(m[1], m[2].replace(/^["']|["']$/g, ''));
	}
	return out;
}

/**
 * Every tracked change between the two manifest texts, in a stable order:
 * image, replicas, then env vars added/removed, then ConfigMap data keys
 * changed/added/removed. Empty when nothing in this closed set moved (the
 * resource can still have a real diff; the headline is a highlight, not a
 * claim that nothing else changed).
 */
export function manifestChangeParts(oldContent: string, newContent: string): HeadlinePart[] {
	const parts: HeadlinePart[] = [];
	for (const { label, re } of FIELD_PATTERNS) {
		const oldVal = re.exec(oldContent)?.[1];
		const newVal = re.exec(newContent)?.[1];
		if (oldVal !== undefined && newVal !== undefined && oldVal !== newVal) {
			parts.push({ kind: 'field', field: label, from: oldVal, to: newVal });
		}
	}
	const oldEnv = envVarNames(oldContent);
	const newEnv = envVarNames(newContent);
	const added = [...newEnv].filter((n) => !oldEnv.has(n));
	const removed = [...oldEnv].filter((n) => !newEnv.has(n));
	if (added.length === 1) parts.push({ kind: 'added', name: added[0] });
	else if (added.length > 1) parts.push({ kind: 'count', text: `+${added.length} env vars` });
	if (removed.length === 1) parts.push({ kind: 'removed', name: removed[0] });
	else if (removed.length > 1) parts.push({ kind: 'count', text: `−${removed.length} env vars` });

	const oldData = dataEntries(oldContent);
	const newData = dataEntries(newContent);
	for (const [k, v] of newData) {
		const before = oldData.get(k);
		if (before === undefined) parts.push({ kind: 'added', name: k });
		else if (before !== v) parts.push({ kind: 'field', field: k, from: before, to: v });
	}
	for (const k of oldData.keys()) if (!newData.has(k)) parts.push({ kind: 'removed', name: k });
	return parts;
}

/** One part as plain text: `image b7e0d41 → d09e6f4`, `added X`. */
export function headlinePartText(p: HeadlinePart): string {
	switch (p.kind) {
		case 'field':
			return `${p.field} ${p.from} → ${p.to}`;
		case 'added':
			return `added ${p.name}`;
		case 'removed':
			return `removed ${p.name}`;
		case 'count':
			return p.text;
	}
}

/**
 * One line naming every tracked change (see `manifestChangeParts`), joined
 * with ` · ` — `null` when nothing in the tracked set changed.
 */
export function summarizeManifestChange(oldContent: string, newContent: string): string | null {
	const parts = manifestChangeParts(oldContent, newContent);
	return parts.length > 0 ? parts.map(headlinePartText).join(' · ') : null;
}

/**
 * The resource a manifest file declares — `kind` and `metadata.name` — for
 * the resource card's title ("Deployment checkout-edge"). Line-anchored like
 * the rest of this module: `kind:` at column 0, the first `name:` one level
 * under a column-0 `metadata:`. `null` when either is missing (a multi-doc
 * file, a fragment); the caller falls back to the file name.
 */
export function manifestResource(content: string): { kind: string; name: string } | null {
	const kind = /^kind:\s*(\S+)\s*$/m.exec(content)?.[1];
	if (!kind) return null;
	const lines = content.split('\n');
	const mi = lines.findIndex((l) => /^metadata:\s*$/.test(l));
	if (mi === -1) return null;
	let childIndent = -1;
	for (let i = mi + 1; i < lines.length; i++) {
		const l = lines[i];
		if (l.trim() === '') continue;
		if (!/^\s/.test(l)) break;
		const indent = l.length - l.trimStart().length;
		if (childIndent === -1) childIndent = indent;
		if (indent !== childIndent) continue;
		const m = /^\s+name:\s*(\S+)\s*$/.exec(l);
		if (m) return { kind, name: m[1].replace(/^["']|["']$/g, '') };
	}
	return null;
}
