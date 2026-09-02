/**
 * THE REGISTRY -- what the message suite considers a "sentence module", and
 * what each SURFACE already fixes about the thing it is talking about.
 *
 * Two properties are tested over this registry, and they are different
 * properties with different failure modes:
 *
 *   1. TRUTH      -- `truth.test.ts`. Is the sentence true for the state that
 *                    produced it? Ground truth is the controller
 *                    (`../rollout-controller`, `../environment-controller`),
 *                    never the component.
 *   2. SUBJECT    -- `subject.svelte.test.ts`. Does the sentence NAME ITS
 *                    SUBJECT for the page it is on? A string can be
 *                    unambiguous on rollout detail and vague on `/apps`.
 *
 * -- THE AXES -------------------------------------------------------------
 *
 * Four things identify what a sentence is about in this product:
 *
 *   `app`         which service            hello-world-app
 *   `environment` which tier               dev / staging / prod
 *   `cluster`     which kube cluster       rollout-prod / rollout-dev
 *   `version`     which build              991829b
 *
 * A SURFACE FIXES AN AXIS when the page, or the enclosing card, already
 * states it. `/apps/hello-world-app` fixes `app`; a card on `/apps` headed
 * with the app name fixes `app` for everything inside that card; rollout
 * detail fixes all of `app`, `environment` and `cluster`.
 *
 * THE INVARIANT: a message must name every axis the surface does not already
 * fix. `subject.svelte.test.ts` checks it structurally rather than by reading
 * the string -- see `resolvesAxis` there -- because the property is about the
 * DOM around the sentence, not about the sentence.
 */

/** One of the four things that identify what a sentence is about. */
export type Axis = 'app' | 'environment' | 'cluster' | 'version';

export const AXES: readonly Axis[] = ['app', 'environment', 'cluster', 'version'] as const;

export type Surface = {
	/** The route, as an operator would type it. */
	route: string;
	/** The component `subject.svelte.test.ts` renders for it. */
	module: string;
	/**
	 * Axes the PAGE itself fixes -- true for every sentence on it, at any
	 * depth. A page at `/envs/prod` fixes `environment` for the whole page.
	 */
	pageFixes: Axis[];
	/**
	 * Axes fixed by the ENCLOSING CARD rather than by the page. `/apps` draws
	 * one card per app with the app name in its header, so `app` is fixed
	 * inside a card and not outside it. The render test proves this rather
	 * than assuming it: it asserts there is an ancestor of the sentence whose
	 * subtree contains exactly one value of the axis.
	 */
	cardFixes: Axis[];
	/**
	 * Axes that must therefore appear in, or unambiguously around, every
	 * sentence. Derived, kept explicit so the table reads as a claim.
	 */
	mustName: Axis[];
	/**
	 * ⭐ WHAT A COUNT ON *THIS* SURFACE COUNTS.
	 *
	 * `N of M up to date` is one string and two sentences. In an app card on
	 * `/apps` the denominator is ENVIRONMENTS; in the `How it's going` card on
	 * `/envs/<name>` it is APPS. A claim that aggregates an axis may not be
	 * asked to name it -- that would be demanding a different sentence -- so
	 * the exception is recorded per surface, by claim id, rather than by
	 * widening the claim everywhere and quietly making it inert.
	 */
	aggregates?: Partial<Record<string, Axis[]>>;
	why: string;
};

const surface = (
	route: string,
	module: string,
	pageFixes: Axis[],
	cardFixes: Axis[],
	why: string,
	aggregates?: Partial<Record<string, Axis[]>>
): Surface => ({
	route,
	module,
	pageFixes,
	cardFixes,
	mustName: AXES.filter((a) => !pageFixes.includes(a) && !cardFixes.includes(a)),
	aggregates,
	why
});

/**
 * EVERY SURFACE THAT RENDERS AN OPERATOR SENTENCE, and what it fixes.
 *
 * `cluster` is fixed nowhere except rollout detail and the cluster-scoped
 * routes, and that is deliberate rather than an omission: the fleet is
 * hub-and-spoke, two clusters are named `prod` and `dev` (the same words the
 * environments use), and the collision is the subject of a standing finding.
 * A list surface that names only `prod` has NOT named the cluster.
 *
 * `version` is treated as fixed on every surface except the revision pages,
 * because a sentence about a rollout is about whatever that rollout is
 * running; only `/versions/<rev>` inverts the question and asks about a build
 * across places.
 */
export const SURFACES: readonly Surface[] = [
	surface(
		'/',
		'lib/ControlCenter.svelte',
		[],
		[],
		'The landing page. Fifteen rows compete; nothing is fixed by context, so every row-level sentence has to name its own app AND its own environment.'
	),
	surface(
		'/rollouts',
		'lib/RolloutGrid.svelte',
		[],
		['cluster'],
		'Grouped by namespace, and the group header carries the cluster. Inside a group the cluster is fixed; app and environment are not.'
	),
	surface(
		'/apps',
		'routes/apps/+page.svelte',
		[],
		['app'],
		'One card per app, headed with the app name. Inside a card the app is fixed; a row-level sentence naming only an environment is still ambiguous about the CLUSTER.',
		// ⭐ THE PAGE BANNER'S SUBJECT MAY LEGITIMATELY SPAN EVERY ENVIRONMENT.
		// (2026-09-02) `blockingStory`'s own `pluralSubject` — the SAME
		// function `/apps/[name]`'s banner already ships — reads `hello-
		// frontend-app in all 3 environments is waiting on…` when one cause
		// holds every environment the app is deployed to identically. That
		// sentence deliberately names NO single tier, the same shape
		// `up-to-date headline`'s `All up to date` already gets this
		// exemption for below. The SUBSET case (`> 1` but not all) still
		// names the tiers verbatim (`DEV, STAGING and PROD`) and stays under
		// full check; only the "every environment" branch is exempted here.
		{
			'blocking headline': ['environment'],
			'blocking consequence': ['environment'],
			'blocking verdict': ['environment']
		}
	),
	surface(
		'/apps/[name]',
		'routes/apps/[name]/+page.svelte',
		['app'],
		[],
		'The page is one app. Every sentence still has to name its environment.'
	),
	surface(
		'/environments',
		'routes/environments/+page.svelte',
		[],
		['environment'],
		'One card per environment. Inside a card the environment is fixed; a sentence naming only an app is fine there and vague anywhere else.',
		// See `/apps`'s own note just above — the identical banner-level
		// exemption, for the identical reason: the SAME app can be held in
		// every environment by one cause, and the banner speaks for the set.
		{
			'blocking headline': ['environment'],
			'blocking consequence': ['environment'],
			'blocking verdict': ['environment']
		}
	),
	surface(
		'/envs/[name]',
		'routes/envs/[name]/+page.svelte',
		['environment'],
		[],
		'The page is one environment. Every sentence still has to name its app.',
		// `How it's going` rolls up `0 of 2 up to date` over the APPS in this
		// environment (`verdictTitle`: *"Apps here running the newest version
		// they have"*). The denominator is the app axis, so this rollup spans
		// it by construction. On `/apps` the SAME string counts environments
		// and the app is still required -- which is why this is one surface's
		// exception and not the claim's.
		{ 'up-to-date headline': ['app', 'environment'] }
	),
	surface(
		'/rollouts/[cluster]/[namespace]/[name]',
		'routes/rollouts/[cluster]/[namespace]/[name]/+page.svelte',
		['app', 'environment', 'cluster'],
		[],
		'The page is ONE rollout. This is the only surface where "DEV is waiting on another deploy" is unambiguous, and it is why that sentence cannot simply be reused on a list.'
	),
	surface(
		'/activity',
		'routes/activity/+page.svelte',
		[],
		[],
		'A cross-fleet feed. Nothing is fixed.'
	),
	surface(
		'/versions',
		'routes/versions/+page.svelte',
		[],
		['version'],
		'One row per build; the build is fixed by the row. What a row says about deployment has to name the app and the place.',
		// ⛔ ONE STRING, TWO MEANINGS, ONE PRODUCT. `Never deployed` is
		// `upToDateHeadline`'s rollup for a service that has run nothing
		// (`/apps`, where the app is fixed by the card and the ENVIRONMENTS
		// are what it counts) AND, here, the title of a Card holding every
		// BUILD nobody has taken. As a section header over builds it spans
		// both the app and the environment axes by construction. Recorded
		// rather than reworded: this encodes the status quo, and the status
		// quo is that two different sentences are spelled identically.
		{ 'up-to-date headline': ['app', 'environment'] }
	),
	// ── ADDED 2026-08-31, AFTER `/apps`'s BANNER SHIPPED THE DEFECT THIS
	//    SUITE WAS WRITTEN FOR. The previous report named these surfaces as
	//    having no render-level test: their strings were in the census, so a
	//    CHANGE was noticed, but nothing asserted their subject. A census
	//    notices; only a render test judges.
	surface(
		'/dependencies',
		'routes/dependencies/+page.svelte',
		[],
		[],
		'The fleet-wide gate graph. Every node is a different app in a different place, which is the whole point of the page, so nothing is fixed and every sentence names both.'
	),
	surface(
		'/namespaces/[name]',
		'routes/namespaces/[name]/+page.svelte',
		['environment'],
		[],
		'The page is one namespace, and the namespace name carries the tier (`alpha-dev`) — so the environment is fixed by the `<h1>`. The APP is not: two rollouts can share a namespace, and `alpha-dev` does not say `alpha-app`.'
	),
	surface(
		'/versions/[...slug]',
		'routes/versions/[...slug]/+page.svelte',
		['version'],
		[],
		'The page inverts the question: one BUILD, asked about across places. The build is fixed by the route; every sentence still has to say which service and which environment it is talking about.'
	),
	// ── NOT ROUTES. A palette and a modal are surfaces an operator reads,
	//    and the modal is the LAST SCREEN before production changes, so the
	//    subject property matters there more than on any list.
	surface(
		'command palette',
		'lib/CommandPalette.svelte',
		[],
		[],
		'A flat list of every rollout on every cluster, filtered by typing. Nothing above a row fixes anything — the palette has no headers at all.'
	),
	surface(
		'modal: change version',
		'lib/components/ChangeVersionModal.svelte',
		// ⛔ MEASURED, NOT ASSUMED. The header is `Change Version / alpha-app`
		// -- `rollout.metadata.name` and nothing else. The component is HANDED
		// `rollout.metadata.namespace` and a `cluster` prop and prints
		// neither, so `app` is the only axis it actually fixes. Writing
		// `['app','environment','cluster']` here because the modal is "about
		// one rollout by construction" is precisely the assumption that let
		// `/apps`'s banner ship: about-ness is not naming.
		['app'],
		[],
		'Opened FROM one rollout and given that rollout as a prop, so it is about one thing by construction. It is the LAST SCREEN before production changes, the background is inert and on a phone it is the only object on screen, so what it does not print is not on screen at all. It prints the rollout name; it does not print the environment or the cluster.'
	),
	surface(
		'modal: recovery warning',
		'lib/components/RecoveryModeWarningModal.svelte',
		// ⛔ IT FIXES NOTHING. It takes `reason` and `versionDisplay` and no
		// rollout at all, so it CANNOT name the app, the environment or the
		// cluster. See the DECISION NEEDED test in
		// `subject-uncovered.svelte.test.ts`.
		[],
		[],
		'The screen that offers to deploy in recovery mode -- where health-check failures stop marking the deployment failed. It names the build and nothing else.'
	)
];

export function surfaceFor(route: string): Surface {
	const s = SURFACES.find((x) => x.route === route);
	if (!s) throw new Error(`No surface registered for ${route}. Add it to registry.ts.`);
	return s;
}

/**
 * THE SENTENCE MODULES -- the code that produces operator-facing claims.
 *
 * `truth.test.ts` requires that EVERY prose literal in each of these files is
 * produced by at least one named state in the matrix, or is listed with a
 * reason in that file's `UNREACHED` table. That is the guard that makes the
 * suite exhaustive over the modules that matter: a new sentence here cannot
 * ship without a state that reaches it.
 *
 * Adding a file here is cheap and is the right move whenever a module starts
 * emitting prose. Removing one needs a reason.
 */
export const SENTENCE_MODULES = [
	'lib/view-models/blocking-story.ts',
	'lib/view-models/verdict.ts',
	'lib/view-models/deploy-risk.ts',
	'lib/view-models/health-witness.ts',
	'lib/view-models/up-to-date.ts',
	'lib/view-models/env-rank.ts',
	'lib/view-models/auto-deploy.ts',
	'lib/api/errors.ts',
	'lib/bake-status.ts'
] as const;

export type SentenceModule = (typeof SENTENCE_MODULES)[number];
