<svelte:options runes={true} />

<script lang="ts" generics="E">
	/**
	 * THE QUERY BAR (owner 2026-11-22: "B needs to be improved a bit in terms of styling"; "too techy").
	 * ROLE: the one filter control of a list page. One field holds the applied filters as readable TOKENS ("Environment: prod",
	 * "Namespace is not: payments-core-dev") and, after them, a plain text input for search words. Clicking the field opens the PROPERTY list;
	 * picking a property opens its VALUES (counts, busiest first, type-ahead, multi-select). Nobody has to learn a syntax — but the syntax
	 * (`env:prod`, `-ns:x`, `state:held,rest`) still works for people who type, and turns into the same readable token.
	 * WHY A NEW COMPONENT: nothing in the product combines typed search with structured filters. FilterChip/`.pill` rows are the rejected
	 * "many boxes"; the sidebar search and the command palette are one-shot lookups. REFERENCES for proportions: the product `.input` (36px,
	 * radius 6, line-strong, focus ring) for the field; Linear's applied filter pill, made lighter (one gray wash, no segments, no border, 24px,
	 * radius 4) for a token; Linear's filter menu + the command palette for the panel (overlay chrome radius 8, 1px line, --k-shadow-overlay,
	 * 280 wide, 32px rows / 44 on phone, gray selected wash, count in tabular figures). NO ICONS in values or properties (owner 2026-11-22).
	 *
	 * PROPS (page-agnostic; a page writes a thin adapter, e.g. rollouts/RolloutFilters.svelte):
	 *  - `defs: FacetDef<E>[]` — the filterable properties (key, label, `word` for display, `slug`/`aliases` for typed values).
	 *  - `rows?: E[]` + `text?: (e) => string[]` — the page's rows and the strings a search word matches; used to compute each property's
	 *    options with filter-model `optionsOf` (values + counts given the other clauses).
	 *  - `options?: (key) => Option[]` — supply the options yourself instead (e.g. server-side counts); overrides rows/text.
	 *  - `query: FilterQuery` + `onchange(q)` — controlled; the bar never keeps a filter the caller does not hold (URL = model URL).
	 *  - `placeholder` / `placeholderShort` (below sm, and once tokens are present) / `label` (accessible name).
	 *  - `hints?: Record<key, string>` — the quiet line beside a property in the list (default: its first values).
	 *  - `search?: boolean` (default true) — false for a bar over data with no free text to search (the layers of a chart): typed
	 *    words only type-ahead the property list and `key:value` still becomes a token; plain words never become `query.q`.
	 *  - an Option whose `count` is negative shows no figure; a FacetDef with `single: true` offers no "is not" switch (a property that adds
	 *    something rather than narrowing, e.g. a chart's comparison lanes).
	 *  - `tip?: string` — the footer line of the property list (default: "Tip: type <key>:<value> or -<key>:name" from the defs).
	 * TOKENS: `Label: a, b` for `is`; `Label is not: a, b` for `not`. The operator lives in the label half so the value half reads the same
	 * either way; the colon is the one separator. 2+ values are listed while the list is short (≤ 32 characters), else "N values" (full list in
	 * the title and in the reopened menu). A token is a whole inline-flex unit: the field wraps BETWEEN tokens, never inside one.
	 * KEYS: `/` focuses. Field: ↑↓ walk the property list, Enter opens a property, `key:` jumps straight into its values, Backspace at the start
	 * highlights the last token and a second Backspace removes it (one press never destroys a filter you cannot see go), ← walks onto tokens
	 * (Backspace/Delete removes, Enter edits). Values: ↑↓, Enter/Space toggle (the list stays open), `,` adds another, Esc or Backspace on an
	 * empty search steps back to the properties, Esc again closes; with the panel closed, Esc clears the search words and blurs.
	 */
	import { tick } from 'svelte';
	import { SearchOutline, CloseOutline } from 'flowbite-svelte-icons';
	import SegmentedControl from '../SegmentedControl.svelte';
	import { optionsOf, isFiltered, clauseOf, setValues, setOp, removeClause, type FacetDef, type FilterQuery, type Option, type Op } from './filter-model';
	import { parseText, type Known } from './query-syntax';

	let {
		defs,
		rows = [],
		text = () => [],
		options,
		query,
		onchange,
		hints = {},
		tip,
		search = true,
		placeholder = 'Search or filter',
		placeholderShort = 'Search or filter',
		label = 'Search and filter'
	}: {
		defs: FacetDef<E>[];
		rows?: E[];
		text?: (e: E) => string[];
		options?: (key: string) => Option[];
		query: FilterQuery;
		onchange: (q: FilterQuery) => void;
		hints?: Record<string, string>;
		tip?: string;
		search?: boolean;
		placeholder?: string;
		placeholderShort?: string;
		label?: string;
	} = $props();

	const uid = `qb-${Math.random().toString(36).slice(2, 8)}`;
	let root: HTMLElement | undefined = $state();
	let box: HTMLElement | undefined = $state();
	let input: HTMLInputElement | undefined = $state();
	let vinput: HTMLInputElement | undefined = $state();
	let listEl: HTMLElement | undefined = $state();

	let draft = $state('');
	let focused = $state(false);
	let open = $state(false);
	let mode = $state<'props' | 'values'>('props');
	let vkey = $state('');
	let vneg = $state(false);
	let vq = $state('');
	/** how the values list was reached: typed `key:` returns to the field after a pick; a click keeps the list open for more */
	let via = $state<'click' | 'type'>('click');
	let active = $state(-1);
	/** values that were selected when the list opened: pinned on top (they do not jump while you tick more) */
	let pinned = $state<string[]>([]);
	/** the token a first Backspace highlighted */
	let armed = $state<string | null>(null);

	const optsOf = (key: string): Option[] => (options ? options(key) : optionsOf(rows, query, defs, text, key));
	const defOf = (key: string) => defs.find((d) => d.key === key);
	const wordOf = (key: string, v: string) => defOf(key)?.word?.(v) ?? v;
	const slugOf = (key: string, v: string) => defOf(key)?.slug?.(v) ?? v;

	/* ── the search words: the input shows query.q; an address that changes from outside (a pasted link, back/forward, Clear) rewrites it ── */
	const known = $derived.by<Known>(() => {
		const k: Known = {};
		for (const d of defs) k[d.key] = [...new Set([...(options ? options(d.key).map((o) => o.value) : rows.map(d.of).filter(Boolean)), ...(clauseOf(query, d.key)?.values ?? [])])];
		return k;
	});
	const wordsOf = (s: string) => (search ? parseText(s, defs, known).query.q : '');
	$effect(() => {
		const q = query.q;
		if (search && wordsOf(draft) !== q.trim()) draft = q;
	});
	function emitWords() { const q = wordsOf(draft); if (q !== query.q.trim()) onchange({ ...query, q }); }

	/* ── tokens ── */
	type Tok = { key: string; prop: string; not: boolean; vals: string; all: string; n: number };
	/* 2+ values are listed while they fit the token's room (the field, at most 360px); else "N values". Measured with the token's own font. */
	let boxW = $state(0);
	$effect(() => { if (!box) return; const el = box; const ro = new ResizeObserver(() => (boxW = el.clientWidth)); ro.observe(el); return () => ro.disconnect(); });
	let c2d: CanvasRenderingContext2D | null = null;
	function textW(s: string, weight: number): number {
		if (!box) return s.length * 7;
		c2d ??= document.createElement('canvas').getContext('2d');
		if (!c2d) return s.length * 7;
		const coarse = matchMedia?.('(max-width: 639px), (pointer: coarse)')?.matches;
		c2d.font = `${weight} ${coarse ? 13 : 12}px ${getComputedStyle(box).fontFamily}`;
		return c2d.measureText(s).width;
	}
	const toks = $derived.by<Tok[]>(() => query.clauses.filter((c) => c.values.length && defOf(c.key)).map((c) => {
		const words = c.values.map((v) => wordOf(c.key, v));
		const all = words.join(', ');
		const n = words.length;
		const prop = defOf(c.key)!.label;
		const not = c.op === 'not';
		/* room = min(field content, 360) − padding 8+2, gap 4, × 22 */
		const room = boxW ? Math.min(boxW - 72, 360) - 36 - textW(`${prop}${not ? ' is not' : ''}:`, 400) : 0;
		const fits = boxW ? textW(all, 500) <= room : all.length <= 32;
		return { key: c.key, prop, not, vals: n > 1 && !fits ? `${n} values` : all, all, n };
	}));
	const tokTitle = (t: Tok) => `${t.prop}${t.not ? ' is not' : ''}: ${t.all} — click to change`;
	function removeTok(key: string, refocus = true) {
		armed = null;
		onchange(removeClause(query, key));
		if (mode === 'values' && vkey === key) toProps();
		if (refocus) void tick().then(() => input?.focus());
	}

	/* ── the panel ── */
	/** the word being typed at the end of the field (property type-ahead): '' = none, null = the draft is plain search words */
	const lastWord = $derived.by(() => {
		if (!draft) return '';
		if (/\s$/.test(draft)) return null;
		const w = draft.split(/\s+/).pop() ?? '';
		return w.startsWith('-') ? w.slice(1).toLowerCase() : w.toLowerCase();
	});
	type PItem = { key: string; label: string; hint: string; n: number };
	const pitems = $derived.by<PItem[]>(() => {
		if (mode !== 'props' || lastWord === null) return [];
		const w = lastWord;
		return defs.filter((d) => !w || d.key.startsWith(w) || d.label.toLowerCase().startsWith(w)).map((d) => {
			const o = optsOf(d.key);
			const words = o.slice(0, 3).map((x) => x.word);
			return { key: d.key, label: d.label, hint: hints[d.key] ?? `${words.join(', ')}${o.length > 3 ? ' …' : ''}`, n: o.length };
		});
	});
	type VItem = { value: string; word: string; count: number; selected: boolean; pin: boolean };
	const vdef = $derived(mode === 'values' ? defOf(vkey) : undefined);
	const vitems = $derived.by<VItem[]>(() => {
		if (mode !== 'values' || !vdef) return [];
		const f = vq.trim().toLowerCase();
		const score = (o: Option) => { const s = slugOf(vkey, o.value).toLowerCase(); const w = o.word.toLowerCase(); return s === f || w === f ? 0 : s.startsWith(f) || w.startsWith(f) ? 1 : 2; };
		const all = optsOf(vkey).filter((o) => !f || slugOf(vkey, o.value).toLowerCase().includes(f) || o.word.toLowerCase().includes(f));
		const pin = all.filter((o) => pinned.includes(o.value)).sort((a, b) => pinned.indexOf(a.value) - pinned.indexOf(b.value));
		const rest = all.filter((o) => !pinned.includes(o.value));
		if (f) rest.sort((a, b) => score(a) - score(b));
		return [...pin.map((o) => ({ ...o, pin: true })), ...rest.map((o) => ({ ...o, pin: false }))].map((o) => ({ value: o.value, word: o.word, count: o.count, selected: o.selected, pin: o.pin }));
	});
	/** a draft with a `key:value` that is not a filter (unknown key or value): say why, quietly */
	const problem = $derived(mode === 'props' ? (parseText(draft, defs, known).tokens.find((t) => t.kind === 'qual' && t.problem)?.problem ?? '') : '');
	const vnote = $derived(mode === 'values' && !vitems.length ? (vq.trim() ? `No ${vdef?.label.toLowerCase()} named “${vq.trim()}”` : `No ${vdef?.label.toLowerCase()} to pick`) : '');
	const defaultTip = $derived.by(() => {
		const a = defs.find((d) => d.key !== 'state') ?? defs[0];
		if (!a) return '';
		const top = optsOf(a.key)[0];
		/* the excluded example: the property with the most values (a name you would rather not scroll for) */
		const b = defs.reduce<FacetDef<E> | undefined>((m, d) => (!m || optsOf(d.key).length > optsOf(m.key).length ? d : m), undefined);
		return `Tip: type ${a.key}:${top ? slugOf(a.key, top.value) : 'value'} or -${b!.key}:name`;
	});
	const showPanel = $derived(open && focused && (mode === 'values' || pitems.length > 0 || !!problem));
	const vcount = $derived(clauseOf(query, vkey)?.values.length ?? 0);
	const vop = $derived<Op>(clauseOf(query, vkey)?.op ?? (vneg ? 'not' : 'is'));

	let sig = '';
	$effect(() => {
		const s = `${mode}:${vkey}:${mode === 'values' ? vq.trim() : lastWord}`;
		if (s === sig) return;
		sig = s;
		active = (mode === 'values' && (vq.trim() || via === 'type')) || (mode === 'props' && lastWord) ? 0 : -1;
	});
	/* the keyboard owns the highlight: a pointer takes it only when it MOVES (a row scrolling under a still pointer must not steal it) */
	let byKey = false;
	let lastPt = '';
	function hover(e: PointerEvent, i: number) { const pt = `${e.clientX},${e.clientY}`; if (pt === lastPt) return; lastPt = pt; byKey = false; active = i; }
	$effect(() => { if (active >= 0 && byKey) listEl?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' }); });

	function toProps(focusField = true) {
		mode = 'props'; vkey = ''; vq = ''; pinned = []; open = true;
		if (focusField) void tick().then(() => input?.focus());
	}
	async function toValues(key: string, how: 'click' | 'type', neg = false, q = '') {
		const c = clauseOf(query, key);
		mode = 'values'; vkey = key; vneg = defOf(key)?.single ? false : c ? c.op === 'not' : neg; vq = q; via = how; open = true; armed = null;
		pinned = c?.values.slice() ?? [];
		/* typed `-ns:` on a property that already holds `is` values: the operator the person typed wins */
		if (c && how === 'type' && (c.op === 'not') !== neg) onchange(setOp(query, key, neg ? 'not' : 'is'));
		await tick();
		vinput?.focus();
	}
	function toggle(v: string) {
		const c = clauseOf(query, vkey);
		const cur = c?.values ?? [];
		onchange(setValues(query, vkey, cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v], c?.op ?? (vneg ? 'not' : 'is')));
	}
	function setNeg(op: Op) { vneg = op === 'not'; if (clauseOf(query, vkey)) onchange(setOp(query, vkey, op)); }
	function finishTyped() { vq = ''; toProps(); open = false; }

	/* ── where the panel sits: position fixed (a Card's overflow-hidden must not clip it), under the field, its left edge at the token being
	   edited (or the text input), clamped to the field and 8px viewport gutters; full field width below sm; flips up when short of room ── */
	let pos = $state({ left: 0, top: 0 as number | null, bottom: null as number | null, width: 280, maxList: 320 });
	function place() {
		if (!box) return;
		const b = box.getBoundingClientRect();
		const vw = document.documentElement.clientWidth;
		const phone = vw < 640;
		const width = phone ? b.width : Math.min(280, b.width);
		const anchorEl = (mode === 'values' && box.querySelector<HTMLElement>(`[data-token="${vkey}"]`)) || input;
		const x = phone ? b.left : (anchorEl?.getBoundingClientRect().left ?? b.left + 34) - 4;
		const left = Math.round(Math.max(Math.max(b.left, 8), Math.min(x, Math.min(b.right, vw - 8) - width)));
		const chrome = mode === 'values' ? 132 : 84;
		const below = innerHeight - b.bottom - 6 - 8 - chrome;
		const above = b.top - 6 - 8 - chrome;
		const up = !phone && below < 200 && above > below;
		const maxList = Math.max(phone ? 132 : 96, Math.min(320, up ? above : below));
		pos = up ? { left, top: null, bottom: Math.round(innerHeight - b.top + 6), width, maxList } : { left, top: Math.round(b.bottom + 6), bottom: null, width, maxList };
	}
	$effect(() => {
		if (!showPanel) return;
		void mode; void vkey; void toks.length; void draft;
		place();
		const on = () => place();
		addEventListener('scroll', on, true);
		addEventListener('resize', on);
		return () => { removeEventListener('scroll', on, true); removeEventListener('resize', on); };
	});
	const mark = (word: string, f: string) => {
		const i = f ? word.toLowerCase().indexOf(f.toLowerCase()) : -1;
		return i < 0 ? [word, '', ''] : [word.slice(0, i), word.slice(i, i + f.length), word.slice(i + f.length)];
	};

	/* ── typed syntax: `key:` jumps into the values; a complete `key:value` (pasted, or typed past) becomes a token on space/Enter/blur ── */
	const keyOf = (w: string) => { const x = w.toLowerCase(); return defs.find((d) => d.key === x || d.label.toLowerCase() === x)?.key; };
	function commitDraft() {
		const p = parseText(draft, defs, known);
		let q: FilterQuery = query;
		let rest = draft;
		for (const t of [...p.tokens].reverse()) {
			if (t.kind !== 'qual' || t.problem || !t.values.length || t.values.some((v) => v.value === null)) continue;
			const c = clauseOf(q, t.key);
			const op: Op = t.neg ? 'not' : 'is';
			const vals = t.values.map((v) => v.value!);
			q = setValues(q, t.key, c && c.op === op ? [...new Set([...c.values, ...vals])] : vals, op);
			rest = rest.slice(0, t.start) + rest.slice(t.end);
		}
		if (q === query) return false;
		draft = rest.replace(/\s{2,}/g, ' ').replace(/^\s+/, '');
		onchange({ ...q, q: wordsOf(draft) });
		return true;
	}

	const inField = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
	function onwin(e: KeyboardEvent) {
		if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !inField(e.target)) { e.preventDefault(); input?.focus(); }
	}
	function oninput(e: Event & { currentTarget: HTMLInputElement }) {
		draft = e.currentTarget.value;
		armed = null; open = true;
		if (mode !== 'props') toProps(false);
		const ie = e as unknown as InputEvent;
		const at = e.currentTarget.selectionStart ?? draft.length;
		/* `env:` / `-ns:` typed: the key leaves the text and its values open, ready for the value */
		const m = ie.inputType === 'insertText' && ie.data === ':' ? /(^|\s)(-?)([A-Za-z]+):$/.exec(draft.slice(0, at)) : null;
		const key = m ? keyOf(m[3]!) : undefined;
		if (m && key) {
			draft = draft.slice(0, at - m[0].length + m[1]!.length) + draft.slice(at);
			emitWords();
			void toValues(key, 'type', m[2] === '-');
			return;
		}
		if (ie.inputType === 'insertFromPaste' || (ie.inputType === 'insertText' && ie.data === ' ')) { if (commitDraft()) return; }
		emitWords();
	}
	function onkey(e: KeyboardEvent) {
		const el = e.currentTarget as HTMLInputElement;
		const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
		if (e.key !== 'Backspace') armed = null;
		if (e.key === 'Escape') {
			e.preventDefault();
			if (showPanel) { open = false; return; }
			if (draft) { draft = ''; emitWords(); }
			input?.blur();
			return;
		}
		if (e.key === 'Backspace' && atStart && toks.length) {
			e.preventDefault();
			const last = toks[toks.length - 1]!.key;
			if (armed === last) removeTok(last); else armed = last;
			return;
		}
		if (e.key === 'ArrowLeft' && atStart && toks.length) {
			e.preventDefault();
			box?.querySelector<HTMLElement>(`[data-token="${toks[toks.length - 1]!.key}"]`)?.focus();
			return;
		}
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			if (!showPanel) { open = true; return; }
			const n = pitems.length;
			if (!n) return;
			byKey = true;
			active = e.key === 'ArrowDown' ? (active + 1) % n : (active - 1 + n) % n;
			return;
		}
		if (e.key === 'Enter') {
			e.preventDefault();
			const it = showPanel ? pitems[active] : undefined;
			if (it) { pickProp(it.key); return; }
			commitDraft();
			open = false;
		}
	}
	function pickProp(key: string) {
		/* a property word being typed (`env`, `-ns`) is consumed by the pick, not left behind as a search word */
		if (lastWord) { draft = draft.replace(/-?\S+$/, '').replace(/\s+$/, draft.trim().split(/\s+/).length > 1 ? ' ' : ''); emitWords(); }
		const neg = /(^|\s)-\S*$/.test(draft);
		void toValues(key, 'click', neg);
	}
	function onvkey(e: KeyboardEvent) {
		const n = vitems.length;
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			if (!n) return;
			byKey = true;
			active = e.key === 'ArrowDown' ? (active + 1) % n : (active - 1 + n) % n;
			return;
		}
		if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (via === 'type') finishTyped(); else toProps(); return; }
		if (e.key === 'Backspace' && !vq) { e.preventDefault(); toProps(); return; }
		if (e.key === 'Enter' || e.key === ',' || (e.key === ' ' && (via === 'type' || !vq.trim()))) {
			e.preventDefault();
			const it = vitems[active];
			if (it) toggle(it.value);
			else if (vq.trim()) return;
			vq = '';
			if (via === 'type' && e.key !== ',') finishTyped();
		}
	}

	function onfocusin() { focused = true; }
	function onfocusout(e: FocusEvent) {
		if (e.relatedTarget instanceof Node && root?.contains(e.relatedTarget)) return;
		focused = false; open = false; armed = null;
		/* typed `env:prod` and then left: blur accepts it like space would */
		if (mode === 'values' && via === 'type' && vq.trim()) { const it = vitems[active]; if (it && !it.selected) toggle(it.value); }
		if (mode === 'values') { mode = 'props'; vkey = ''; vq = ''; pinned = []; }
		commitDraft();
	}
	function onfieldclick(e: MouseEvent) {
		if ((e.target as HTMLElement).closest('[data-token], [data-filter-clear]')) return;
		if (mode === 'values') toProps(); else open = true;
		input?.focus();
	}
	function ontokkey(e: KeyboardEvent, i: number) {
		const els = () => [...(box?.querySelectorAll<HTMLElement>('[data-token]') ?? [])];
		if (e.key === 'ArrowLeft') { e.preventDefault(); els()[Math.max(0, i - 1)]?.focus(); }
		else if (e.key === 'ArrowRight') { e.preventDefault(); (els()[i + 1] ?? input)?.focus(); }
		else if (e.key === 'Backspace' || e.key === 'Delete') {
			e.preventDefault();
			const prev = els()[i - 1];
			removeTok(toks[i]!.key, false);
			void tick().then(() => (prev ?? input)?.focus());
		}
	}
	function clearAll() { draft = ''; toProps(false); onchange({ q: '', clauses: [] }); input?.focus(); }
	const filtered = $derived(isFiltered(query) || draft.trim() !== '');
	/* below sm the long placeholder would be cut: the short one, as also once tokens are present */
	let narrow = $state(false);
	$effect(() => { const mq = typeof matchMedia === 'function' ? matchMedia('(max-width: 639px)') : undefined; if (!mq) return; narrow = mq.matches; const on = () => (narrow = mq.matches); mq.addEventListener('change', on); return () => mq.removeEventListener('change', on); });
	const phonePh = $derived(toks.length > 0 || narrow);
</script>

<svelte:window onkeydown={onwin} />

<div class="qb" data-query-bar bind:this={root} onfocusin={onfocusin} onfocusout={onfocusout}>
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions (the field's own input owns the keyboard) -->
	<div class="qb-box" class:on={focused} bind:this={box} onclick={onfieldclick}>
		<SearchOutline class="qb-glyph h-4 w-4" aria-hidden="true" />
		{#each toks as t, i (t.key)}
			<span class="qb-tok" class:armed={armed === t.key} class:editing={showPanel && mode === 'values' && vkey === t.key}>
				<button type="button" class="qb-tok-btn" data-token={t.key} title={tokTitle(t)} aria-label="{t.prop}{t.not ? ' is not' : ''}: {t.all}. Change"
					onclick={() => (mode === 'values' && vkey === t.key && showPanel ? toProps() : toValues(t.key, 'click'))} onkeydown={(e) => ontokkey(e, i)}>
					<span class="qb-tok-prop">{t.prop}{#if t.not}<span class="qb-tok-op">&nbsp;is not</span>{/if}:</span>
					<span class="qb-tok-val">{t.vals}</span>
				</button>
				<button type="button" class="qb-tok-x" tabindex="-1" aria-label="Remove {t.prop} filter" title="Remove" onclick={() => removeTok(t.key)} data-token-remove={t.key}><CloseOutline class="h-3 w-3" aria-hidden="true" /></button>
			</span>
		{/each}
		<input bind:this={input} value={draft} {oninput} onkeydown={onkey} onfocus={() => { open = true; if (matchMedia?.('(max-width: 639px)')?.matches) root?.scrollIntoView({ block: 'start' }); }}
			class="qb-in" class:has-toks={toks.length > 0} class:bare={!search && toks.length > 0} placeholder={!search && toks.length ? '' : phonePh ? placeholderShort : placeholder} data-ph-short={placeholderShort}
			aria-label={label} autocomplete="off" autocapitalize="off" spellcheck="false" role="combobox" aria-expanded={showPanel && mode === 'props'} aria-controls="{uid}-panel" aria-autocomplete="list" data-query-input />
		{#if filtered}
			<button type="button" class="qb-clear" onclick={clearAll} onpointerdown={(e) => e.preventDefault()} aria-label="Clear search and filters" title="Clear all" data-filter-clear><CloseOutline class="h-3.5 w-3.5" aria-hidden="true" /></button>
		{:else if !focused}
			<kbd class="kbd qb-kbd" aria-hidden="true">/</kbd>
		{/if}
	</div>
	{#if showPanel}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div id="{uid}-panel" class="qb-panel" style="left: {pos.left}px; {pos.top !== null ? `top: ${pos.top}px` : `bottom: ${pos.bottom}px`}; width: {pos.width}px; --qb-list-max: {pos.maxList}px"
			data-query-panel data-mode={mode} onpointerdown={(e) => { if (!(e.target instanceof HTMLInputElement)) e.preventDefault(); }}>
			{#if mode === 'props'}
				{#if pitems.length}
					<div class="qb-head"><span class="t-label text-fg-subtle">Filter by</span></div>
					<div class="qb-list" role="listbox" aria-label="Properties" bind:this={listEl}>
						{#each pitems as it, i (it.key)}
							<button type="button" role="option" tabindex="-1" aria-selected={i === active} data-i={i} data-prop={it.key} class="qb-row" class:is-active={i === active} onpointermove={(e) => hover(e, i)} onclick={() => pickProp(it.key)}>
								<span class="t-ui qb-pname text-fg">{it.label}</span>
								<span class="t-meta qb-hint text-fg-subtle">{it.hint}</span>
							</button>
						{/each}
					</div>
				{/if}
				{#if problem}<p class="t-meta qb-note text-fg-subtle">{problem}</p>{/if}
				{#if pitems.length}<p class="t-meta qb-foot text-fg-subtle">{tip ?? defaultTip}</p>{/if}
			{:else if vdef}
				<div class="qb-vhead">
					<span class="t-label text-fg-subtle">{vdef.label}</span>
					{#if !vdef.single}<SegmentedControl label="{vdef.label} match" options={[{ value: 'is' as Op, label: 'is' }, { value: 'not' as Op, label: 'is not' }]} value={vop} onChange={setNeg} class="qb-seg" />{/if}
				</div>
				<div class="qb-search">
					<input bind:this={vinput} bind:value={vq} onkeydown={onvkey} class="qb-vin" placeholder="Filter {vdef.label.toLowerCase()}…" aria-label="Filter {vdef.label.toLowerCase()}"
						autocomplete="off" autocapitalize="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="{uid}-vlist" aria-autocomplete="list" data-value-search />
					{#if vcount}<span class="t-meta tabular-nums text-fg-subtle qb-vcount">{vcount} selected</span>{/if}
				</div>
				{#if vitems.length}
					<div class="qb-list" id="{uid}-vlist" role="listbox" aria-multiselectable="true" aria-label={vdef.label} bind:this={listEl}>
						{#each vitems as it, i (it.value)}
							{#if i > 0 && vitems[i - 1]!.pin && !it.pin}<div class="qb-rule" role="presentation"></div>{/if}
							{@const m = mark(it.word, vq.trim())}
							<button type="button" role="option" tabindex="-1" aria-selected={it.selected} data-i={i} data-value={it.value} class="qb-row" class:is-active={i === active} onpointermove={(e) => hover(e, i)} onclick={() => { toggle(it.value); vinput?.focus(); }}>
								<span class="qb-check" class:on={it.selected} aria-hidden="true"></span>
								<span class="t-body qb-vname text-fg">{m[0]}<b class="qb-hit">{m[1]}</b>{m[2]}</span>
								<span class="t-meta qb-count tabular-nums text-fg-subtle">{it.count >= 0 ? it.count : ''}</span>
							</button>
						{/each}
					</div>
				{/if}
				{#if vnote}<p class="t-meta qb-note text-fg-subtle">{vnote}</p>{/if}
			{/if}
		</div>
	{/if}
</div>

<style>
	/* THE FIELD — the product's `.input` (36px, radius 6, 1px line-strong at rest, surface, the focus border + 3px 25% ring). Tokens and the text
	   input share one wrapping flex row: it wraps BETWEEN tokens (a token is nowrap), so a long filter set adds a line, never a sideways scroll.
	   A single input may cap its width (full-width rule): 720px, so at 2560 the field is a field, not a 1349px bar. */
	.qb { scroll-margin-top: 72px; max-width: 720px; }
	.qb-box { position: relative; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; min-height: 36px; border: 1px solid var(--k-line-strong); border-radius: 6px; background: var(--k-surface); padding: 3px 34px 3px 34px; cursor: text; transition: border-color var(--k-dur-fast) var(--ease-out), box-shadow var(--k-dur-fast) var(--ease-out); }
	.qb-box:hover { border-color: color-mix(in oklab, var(--k-line-strong) 60%, var(--k-fg-subtle)); }
	.qb-box.on { border-color: var(--k-focus); box-shadow: 0 0 0 3px color-mix(in oklab, var(--k-focus) 25%, transparent); }
	.qb-box :global(.qb-glyph) { position: absolute; left: 11px; top: 9px; pointer-events: none; color: var(--k-fg-subtle); }
	.qb-box.on :global(.qb-glyph) { color: var(--k-fg-muted); }
	.qb-in { flex: 1 1 8rem; min-width: 8rem; height: 28px; padding: 0 2px; margin: 0; border: 0; background: transparent; color: var(--k-fg); font: inherit; font-size: 14px; line-height: 28px; outline: none; box-shadow: none; }
	.qb-in.has-toks { flex-basis: 6rem; min-width: 6rem; padding-left: 4px; }
	/* a bar with no free text and a token already in it: the input is only a click target after the token, not a second line */
	.qb-in.bare { flex: 1 1 0; min-width: 0; padding: 0; }
	.qb-in:focus, .qb-in:focus-visible { outline: none; box-shadow: none; }
	.qb-in::placeholder { color: var(--k-fg-subtle); opacity: 1; }
	/* 16px below sm and on touch: the iOS no-zoom floor (unlayered like the global rule, and more specific) */
	@media (max-width: 639px), (pointer: coarse) { .qb-in, .qb-vin { font-size: 16px; } }

	/* A TOKEN — Linear's applied pill, lighter: ONE gray wash (no segments, no border), 24px, radius 4. The property (and `is not`) speaks in
	   muted ink, the values in full ink at 500; the × is quiet until hovered. Whole: inline-flex + nowrap, so it never breaks mid-value; a value
	   too long for the field truncates INSIDE the token. */
	.qb { --qb-wash: color-mix(in oklab, var(--k-fg) 7%, var(--k-surface)); --qb-wash-2: color-mix(in oklab, var(--k-fg) 12%, var(--k-surface)); }
	:global(.dark) .qb { --qb-wash: color-mix(in oklab, var(--k-fg) 11%, var(--k-surface)); --qb-wash-2: color-mix(in oklab, var(--k-fg) 17%, var(--k-surface)); }
	.qb-tok { display: inline-flex; align-items: center; max-width: min(100%, 360px); min-width: 0; height: 24px; border-radius: 4px; background: var(--qb-wash); white-space: nowrap; transition: background-color var(--k-dur-fast) var(--ease-out); }
	.qb-tok:hover, .qb-tok.editing, .qb-tok:focus-within { background: var(--qb-wash-2); }
	.qb-tok.armed { background: var(--qb-wash-2); box-shadow: inset 0 0 0 1px var(--k-line-strong); }
	.qb-tok-btn { display: inline-flex; align-items: baseline; gap: 4px; min-width: 0; height: 100%; padding: 0 2px 0 8px; font-size: 12px; line-height: 24px; border-radius: 4px 0 0 4px; cursor: pointer; }
	.qb-tok-btn:focus-visible { outline: 2px solid var(--k-focus); outline-offset: 1px; }
	.qb-tok-prop { flex: none; color: var(--k-fg-muted); font-weight: 400; }
	.qb-tok-op { color: var(--k-fg); font-weight: 500; }
	.qb-tok-val { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--k-fg); font-weight: 500; }
	.qb-tok-x { display: inline-grid; place-items: center; flex: none; width: 20px; height: 20px; margin-right: 2px; border-radius: 3px; color: var(--k-fg-subtle); cursor: pointer; }
	.qb-tok-x:hover { color: var(--k-fg); background: color-mix(in oklab, var(--k-fg) 8%, transparent); }
	@media (max-width: 639px), (pointer: coarse) {
		.qb-tok { height: 28px; }
		.qb-tok-btn { font-size: 13px; line-height: 28px; }
		.qb-tok-x { width: 24px; height: 24px; }
	}

	/* the right end: `/` at rest, a 28px clear-all once something is typed or applied */
	.qb-kbd { position: absolute; right: 7px; top: 7px; pointer-events: none; }
	.qb-clear { position: absolute; right: 3px; top: 3px; display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 4px; color: var(--k-fg-subtle); }
	.qb-clear:hover { background: var(--k-hover); color: var(--k-fg); }
	@media (max-width: 639px) { .qb-kbd { display: none; } .qb-box:has(.qb-kbd) { padding-right: 6px; } }

	/* THE PANEL — the product's overlay chrome (RulePopover / EnvSitePicker: radius 8, 1px line, bg-overlay, --k-shadow-overlay), 280 wide,
	   position fixed. Rows 32 (44 below sm) inset 4 with radius 4 (8 − 4: concentric); the highlight is the gray selected wash, never blue. */
	.qb-panel { position: fixed; z-index: 60; display: flex; flex-direction: column; background: var(--k-overlay, var(--k-surface)); border: 1px solid var(--k-line); border-radius: 8px; box-shadow: var(--k-shadow-overlay); overflow: hidden; }
	.qb-head { padding: 10px 12px 2px; }
	.qb-vhead { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 8px 6px 12px; }
	.qb-vhead :global(.qb-seg) { height: 24px; padding: 1px; }
	.qb-vhead :global(.qb-seg .seg-btn) { min-width: 0; padding: 0 8px; }
	.qb-search { display: flex; align-items: center; gap: 8px; margin: 0 4px; padding: 0 8px; border-top: 1px solid var(--k-line); border-bottom: 1px solid var(--k-line); }
	.qb-vin { flex: 1; min-width: 0; height: 36px; padding: 0; border: 0; background: transparent; color: var(--k-fg); font: inherit; font-size: 14px; outline: none; box-shadow: none; }
	.qb-vin:focus, .qb-vin:focus-visible { outline: none; box-shadow: none; }
	.qb-vin::placeholder { color: var(--k-fg-subtle); opacity: 1; }
	.qb-vcount { flex: none; }
	.qb-list { max-height: var(--qb-list-max, 320px); overflow-y: auto; padding: 4px; scrollbar-width: thin; scrollbar-color: var(--k-line-strong) transparent; overscroll-behavior: contain; }
	.qb-row { display: flex; align-items: center; gap: 8px; width: 100%; height: 32px; padding: 0 8px; border-radius: 4px; text-align: left; cursor: pointer; }
	.qb-row.is-active { background: var(--k-selected); }
	.qb-row:focus-visible { outline: none; }
	.qb-pname { flex: none; width: 88px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.qb-hint { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.qb-vname { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.qb-hit { font-weight: 600; }
	.qb-count { margin-left: auto; padding-left: 12px; flex: none; }
	/* a selected value: a 14px check box (a selection control, not a value mark); filled in fg ink, never blue */
	.qb-check { flex: none; position: relative; width: 14px; height: 14px; border: 1px solid var(--k-line-strong); border-radius: 3px; background: var(--k-surface); }
	.qb-check.on { background: var(--k-fg); border-color: var(--k-fg); }
	.qb-check.on::after { content: ''; position: absolute; left: 4px; top: 1px; width: 4px; height: 8px; border: solid var(--k-surface); border-width: 0 1.5px 1.5px 0; transform: rotate(45deg); }
	.qb-rule { height: 1px; margin: 4px 4px; background: var(--k-line); }
	.qb-note { margin: 0; padding: 8px 12px 10px; }
	.qb-foot { margin: 0; padding: 8px 12px; border-top: 1px solid var(--k-line); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	@media (max-width: 639px) { .qb-row { height: 44px; } .qb-vin { height: 44px; } .qb-vhead :global(.qb-seg) { height: 32px; } }
</style>
