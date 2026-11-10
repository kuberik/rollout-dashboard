import { diffSubject } from '$lib/view-models/diff-page-title';

type EntryLike = { version: { tag: string; version?: string; revision?: string } };

/**
 * Which manifests a History entry's "View diff" link depends on.
 *
 * The link is shown whenever the diff page would render a real diff, never
 * because of `status.artifactType` (qa11 B3: no rollout in the demo set it,
 * so History never linked to a diff at all). The diff page itself decides
 * from the same `diffSubject`, so the link and the page cannot disagree:
 * - a change (prev build differs): both builds' manifests must exist;
 * - a first deploy: this build's manifest must exist (everything is "added");
 * - a redeploy, the oldest kept entry or an unknown tag: nothing to diff.
 */
export function diffLinkNeeds(args: {
	history: EntryLike[];
	index: number;
	atLimit: boolean;
}): string[] | null {
	const tag = args.history[args.index]?.version.tag;
	if (!tag) return null;
	const { subject } = diffSubject({ history: args.history, tag, atLimit: args.atLimit });
	if (subject.kind === 'change') return [subject.fromTag, subject.toTag];
	if (subject.kind === 'first') return [tag];
	return null;
}

/** True when every manifest the diff needs resolved to files. */
export function diffResolves(
	needs: string[] | null,
	manifests: ReadonlyArray<Record<string, string> | null | undefined>
): boolean {
	if (!needs || needs.length === 0) return false;
	return needs.length === manifests.length && manifests.every((m) => m != null);
}
