<svelte:options runes={true} />

<script module lang="ts">
	/**
	 * ⭐ THE WORDING LIVES HERE, NOT IN THE MARKUP, so a caller that cannot
	 * render this component still cannot re-derive the sentence.
	 *
	 * `/apps`'s page banner is that caller. It is an `AlertPanel` — a filled
	 * amber field — and this component's prose is deliberately `gray-500` on a
	 * white card, so DROPPING THE COMPONENT INTO THE BANNER WOULD BE WRONG
	 * TWICE: muted gray on amber, and a second unfilled thing inside the one
	 * object on the page that is allowed a fill. What the banner needs is the
	 * SENTENCE, in the banner's own ink.
	 *
	 * Before this split existed the banner spelled the same fact its own way —
	 * *"Nothing promotes into PROD until hello-world-manual-approval allows
	 * one"* — which is the exact defect this component was built to kill, still
	 * alive in the most-read line on the page. One function, two renderers.
	 */
	import {
		LockSolid,
		UserCircleSolid,
		HourglassSolid,
		ShareNodesSolid
	} from 'flowbite-svelte-icons';

	export type BlockReason = {
		/** Which structural branch fired. For callers that pick their own icon. */
		kind: 'pinned' | 'awaiting' | 'notPassing' | 'contract';
		icon: typeof LockSolid;
		/** The consequence. Ordinary English, and it says who has to move. */
		line: string;
		/** The handle, not the explanation. Render as `rule: <names>`. */
		names: string | null;
	};

	/**
	 * The split is `promotionBlock`'s own STRUCTURAL split, never a match on
	 * the generated name. See the component comment below for why each branch
	 * says what it says, and why `pinnedTo` short-circuits.
	 */
	export function blockReason({
		awaiting = [],
		notPassing = [],
		pinnedTo = null
	}: {
		awaiting?: string[];
		notPassing?: string[];
		pinnedTo?: string | null;
	}): BlockReason | null {
		if (pinnedTo) {
			return {
				kind: 'pinned',
				icon: LockSolid,
				line: `Held on ${pinnedTo} on purpose — automatic updates are off here`,
				names: null
			};
		}
		if (awaiting.length > 0) {
			return {
				kind: 'awaiting',
				icon: UserCircleSolid,
				line: 'Someone has to approve a newer version — this will not clear on its own',
				names: awaiting.join(', ')
			};
		}
		if (notPassing.length > 0) {
			return {
				kind: 'notPassing',
				icon: HourglassSolid,
				line: 'Newer versions are on hold until a check or time window passes — this clears on its own',
				names: notPassing.join(', ')
			};
		}
		return null;
	}

	/**
	 * ⭐ THE FOURTH BRANCH — A CROSS-SERVICE CONTRACT (`RolloutDependency`).
	 *
	 * It is here and not in a fourth component because it is the SAME defect
	 * this file exists to kill, one object further out. The dependency
	 * controller publishes a generated `RolloutGate` — `dependency-<name>` —
	 * and the dependencies page was printing its constraint and the
	 * controller's own `reason` enum (`ConstraintNotSatisfied`) as if either
	 * were an explanation. Neither tells a reader whether this is their
	 * problem.
	 *
	 * WHAT THE CONSEQUENCE ACTUALLY IS, and it is a THIRD thing, not one of
	 * the two above: this does not clear itself the way a schedule window
	 * does, and nobody here can approve it either. **Somebody has to ship the
	 * other service.** So it gets its own sentence rather than borrowing
	 * `awaiting`'s "someone has to approve" (wrong — approval is not the
	 * mechanism) or `notPassing`'s "clears on its own" (wrong — it will sit
	 * there forever until a provider release lands).
	 *
	 * ⛔ `reason` IS AN OPEN STRING AND IS NOT SWITCHED ON. The same
	 * dependency reports `ConstraintNotSatisfied` on the spoke and
	 * `ProviderVersionTooOld` on the hub, so a friendly label per case would
	 * ship its fallback. It rides in `names`, beside the gate name, where the
	 * component already dresses text as A HANDLE YOU CAN GO LOOK UP rather
	 * than as prose.
	 *
	 * The CONSTRAINT (`^1.67.0`) is printed verbatim in the sentence and NOT
	 * paraphrased: a bare version is an EXACT match in Masterminds semver, so
	 * "at least 1.67.0" would be a lie with better grammar.
	 */
	export function contractBlockReason({
		provider,
		contract,
		requiredVersion,
		providedVersion,
		gateName = null,
		reason = null
	}: {
		provider: string;
		contract: string;
		requiredVersion?: string | null;
		providedVersion?: string | null;
		gateName?: string | null;
		reason?: string | null;
	}): BlockReason {
		const need = requiredVersion ? `${contract} ${requiredVersion}` : `a newer ${contract}`;
		// NEVER NAME A CAUSE YOU CANNOT EVIDENCE. An absent providedVersion
		// says the gate has not READ one; it does not say the provider is
		// behind, so the sentence stops at the observable.
		const line = providedVersion
			? `Needs ${need} from ${provider}, which is on ${providedVersion} — someone has to ship ${provider} first`
			: `Needs ${need} from ${provider}, and no version of it has been read yet`;
		const names = [gateName, reason].filter(Boolean).join(' · ') || null;
		return { kind: 'contract', icon: ShareNodesSolid, line, names };
	}
</script>

<script lang="ts">
	/**
	 * WHY NOTHING NEWER HAS ARRIVED — said as a CONSEQUENCE, never as a name.
	 *
	 * ── THE DEFECT THIS EXISTS TO KILL ──────────────────────────────────────
	 *
	 * The product used to present an opaque, controller-generated identifier as
	 * if it were an explanation:
	 *
	 *     HELD BY ghd-p2fld
	 *     held by 2 gates
	 *     waiting on schedule-gate-q25wv
	 *
	 * A reader who has never seen kuberik cannot tell from any of those whether
	 * something is wrong, whether it will fix itself, or what they are supposed
	 * to do. `ghd-p2fld` is the *name of a Kubernetes object*. Naming a thing is
	 * not explaining it, and a generated name explains nothing to anybody.
	 *
	 * ── WHAT REPLACES IT ────────────────────────────────────────────────────
	 *
	 * Two lines, in this order, always:
	 *
	 *   1. THE CONSEQUENCE, in ordinary English, including whether a person is
	 *      needed. This is the line that answers "is this my problem?".
	 *   2. THE IDENTIFIER, prefixed `rule:` and set in muted mono — visibly a
	 *      handle you can go look up, visibly NOT the explanation.
	 *
	 * The split it draws is `promotionBlock`'s own STRUCTURAL split, never a
	 * pattern match on the generated name:
	 *
	 *   · `awaitingApproval` — the rule published an allow-list and no available
	 *     version is on it. It has an opinion and the answer is no. **Only a
	 *     person changes that**, so it says so.
	 *   · `notPassing` — the rule published no list and simply is not passing
	 *     right now: a deploy window, a health check. **It clears itself**, so
	 *     it says that instead, and it must NOT ask anybody to act.
	 *
	 * ── A PIN OUTRANKS EVERY RULE ───────────────────────────────────────────
	 *
	 * > *"While prod was pinned, that panel blamed `HELD BY
	 * > hello-world-manual-approval`; the actual cause was the pin, which the
	 * > page never mentioned."*
	 *
	 * A rule holds the NEXT version; a pin refuses ALL of them. While
	 * `spec.wantedVersion` is set, no rule is the cause even though every rule
	 * is also blocking — so `pinnedTo` is checked first and short-circuits.
	 *
	 * ⛔ NO COLOUR ON THE PROSE, and no fill. This is a sentence inside a card,
	 * not a banner: `AlertPanel` is the page-level object for the one blocking
	 * fact, and a second filled thing per row would flatten it. The icon is the
	 * only ink, and it is the muted gray every other caption glyph uses.
	 */
	let {
		awaiting = [],
		notPassing = [],
		pinnedTo = null,
		reason: given = null,
		class: className = ''
	}: {
		/**
		 * `PromotionBlock.awaitingApprovalGates`. Rules with an opinion, whose
		 * answer is no.
		 *
		 * IT IS TWO STRING LISTS RATHER THAN A `PromotionBlock` BECAUSE ONE
		 * CALLER AGGREGATES. `/environments` draws one card per place and asks
		 * the question across every app in it, so its lists are unions over N
		 * rollouts and there is no single `PromotionBlock` to hand over. Taking
		 * the two lists keeps the per-rollout callers a spread away
		 * (`{...block}` minus the names) and lets the aggregate one exist at
		 * all — which is the difference between three pages sharing this
		 * wording and two.
		 */
		awaiting?: string[];
		/** `PromotionBlock.notPassingGates`. Rules that clear themselves. */
		notPassing?: string[];
		/** `spec.wantedVersion`. When set, it is the cause and rules are not. */
		pinnedTo?: string | null;
		/**
		 * AN ALREADY-BUILT REASON, for a caller whose branch is not one of the
		 * three gate branches above — today that is `contractBlockReason`, and
		 * it wins over the lists. The RENDERING stays here, which is the whole
		 * point: consequence line, then the identifier on its own line dressed
		 * as a handle, in one place, so no page can spell it its own way again.
		 */
		reason?: BlockReason | null;
		class?: string;
	} = $props();

	const reason = $derived(given ?? blockReason({ awaiting, notPassing, pinnedTo }));
</script>

{#if reason}
	{@const Icon = reason.icon}
	<p class="flex min-w-0 items-start gap-1.5 {className}">
		<Icon class="mt-px h-3.5 w-3.5 shrink-0 text-gray-500 dark:text-gray-400" aria-hidden="true" />
		<span class="min-w-0">
			<span class="t-micro block text-gray-500 dark:text-gray-400">{reason.line}</span>
			{#if reason.names}
				<!-- THE NAME IS AN IDENTIFIER AND IS DRESSED AS ONE. Mono, muted,
				     and prefixed with the word that says what it is, so nobody
				     reads a generated string as a reason again.

				     ON ITS OWN LINE, which is not cosmetic. Inline after the
				     sentence it inherited the sentence's wrap point, and a 300px
				     card broke `schedule-gate-fk44d` across two lines as `fk` /
				     `44d` — an identifier torn in half reads as two identifiers.
				     A `block` gives it the full width first, and `break-all` then
				     only fires on a name genuinely wider than the card. -->
				<span
					class="t-code-sm block break-all text-gray-500 dark:text-gray-400"
					title="The rule blocking this: {reason.names}">rule: {reason.names}</span
				>
			{/if}
		</span>
	</p>
{/if}
