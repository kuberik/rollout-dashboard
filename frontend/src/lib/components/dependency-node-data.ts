/**
 * The payload one `DependencyNode` renders.
 *
 * It lives in its own module rather than in the component because a Svelte 5
 * instance script cannot `export type` — and because `DependencyNetwork`
 * builds these objects, so the shape belongs to neither file alone.
 */
export type DependencyNodeData = {
	/** The Rollout name — the product's app identity. */
	name: string;
	/** No Rollout of this name is visible to this dashboard. */
	unresolved: boolean;
	blocked: boolean;
	/** Second line: what it serves, or where it is held. */
	meta: string;
	href: string | null;
	focused: boolean;
	title: string;
	/** Injected by `GraphCanvas`; decides which sides the handles sit on. */
	orientation?: 'LR' | 'TB';
};
