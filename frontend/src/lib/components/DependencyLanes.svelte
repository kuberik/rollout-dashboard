<svelte:options runes={true} />

<script lang="ts" module>
	/** A cell grows to this, then the room goes to the rail (round 2, TL item e). */
	export const CELL_MAX = 300;
	/** Gutters stop growing at their trunk room + this; past it, extra width is not drawn as distance. */
	export const GUT_EXTRA = 24;
	/**
	 * The widest the matrix ever draws, card padding included: the page caps the map card here and gives the rest of
	 * a 2560/3840 screen to the rail, so no long empty gutter and no stretched canvas (feedback_very_large_screens).
	 */
	export function lanesNaturalWidth(columns: number, trunks: number): number {
		return 200 + columns * (CELL_MAX + 24 + GUT_EXTRA) + 8 * trunks + 34;
	}
	/**
	 * THE NARROWEST CELL THE MATRIX DRAWS (R2-DES-B-1). Measured on the mock fleet: the widest one-line fact a cell must keep
	 * whole is a build or the region fold with its chevron ("4.45.0-45", "5 regions ⌄") at 121px; reasons longer than the cell
	 * ("Pinned to 4.40.0-40") wrap to a second line and the row grows. Below this the page does not draw the matrix at all
	 * (it stacks the rail, then falls to the phone form) — a cell never ellipsizes its build or its reason.
	 */
	export const CELL_MIN = 124;
	/** The label column at a given matrix width (the same steps `cols` uses). */
	export const labelWidth = (w: number) => (w >= 1400 ? 200 : w >= 900 ? 160 : 132);
	/** Fixed gutter per column: the nearest trunk's room plus 8px per further trunk. */
	export const gutterWidth = (trunks: number) => 16 + 8 + 8 * Math.max(0, trunks - 1);
	/**
	 * The narrowest the matrix may draw, card padding included (34): label + gutters + CELL_MIN per column. The page sets
	 * the rail beside the map only when the map still gets this, and draws the phone form when even a full-width map would not.
	 */
	export function lanesMinWidth(trunksPerColumn: number[]): number {
		const body = trunksPerColumn.reduce((a, t) => a + gutterWidth(t) + CELL_MIN, 0);
		let w = labelWidth(0) + body;
		if (w >= 900) w = labelWidth(900) + body;
		return w + 34;
	}
</script>

<script lang="ts">
	/**
	 * DEPENDENCY LANES — the fleet's dependency map as a services × environments matrix (/dependencies, take B).
	 *
	 * ROLE: the page's centrepiece. Columns are environments in promotion order, headed ONCE (the only place
	 * environment identity is drawn, owner D5); rows are services, providers above their consumers; a cell is one
	 * service in one environment with every region folded into it ("5 regions", unfold on click, D4).
	 *
	 * WHY NOTHING EXISTING FITS: `DependencyNetwork` is a free dagre canvas (one box per rollout, an env chip per
	 * node) — the shape the owner rejected. The Promotion lane of /apps/<name> draws ONE app's environments; this
	 * draws many apps and the contracts between them.
	 *
	 * PROPORTIONS: GitHub Actions' run graph (REFS §1: 40–48px nodes, ports on the faces, fan-in on a shared trunk in
	 * the gutter, ranks left→right, canvas = content), Encore's distinct entry points and target chevron (REFS §3),
	 * Datadog's hover dim (REFS §2: the rest to ~20%), the matrix fold of GHA for regions. Cell radius 8 and
	 * border/ground are the product Card's.
	 *
	 * ── EDGES (round 2, owner 2026-11-25: "some lines are now overlapping and it's not clear in which direction they go")
	 * - Every endpoint has its OWN port. A cell's left face holds, top to bottom: one port per inbound contract
	 *   (nearest trunk highest, so no stub crosses a trunk of the same cell), its own outbound contract port, then the
	 *   promotion port (y+36, level with the previous cell's right-face port, so promotion stays one straight line).
	 * - One trunk per provider in the column's left gutter, 8px apart; their left-to-right order is the one with the
	 *   fewest stub-over-trunk crossings (every order tried, ≤6 trunks). A trunk that serves several consumers is the
	 *   one intentional bundle: each consumer branches off at a right angle with a 4px fork dot, the last one turns
	 *   with the 6px elbow. Nothing else shares a pixel (`.work/deps-overhaul/shots/b2/edges.mjs` measures it).
	 * - Direction: a 2px dot where an edge LEAVES (the provider, the earlier environment) and a chevron where it
	 *   ARRIVES. Clear = an open 1px chevron in the wire gray: it reads as direction without adding ink to the norm.
	 *   Held = 1.5px held ink ending in a filled held arrowhead (REFS pattern 5), the darkest line on the canvas.
	 * - A promotion that skips an empty slot (dev → staging past an empty test) is dashed across that slot: it passes
	 *   the column, it does not stop in it. One that would pass under a cell drops into the row gap instead.
	 * - Hover or keyboard focus on an edge or a cell lights it, its edges and their two ends; the rest goes to ~20%,
	 *   nothing moves. A held relationship then shows its whole fact once, as a pill at the consumer end.
	 */
	import { ChevronDownOutline, ChevronUpOutline } from 'flowbite-svelte-icons';
	import StatusMark from './StatusMark.svelte';
	import DependencyLanesPhone from './DependencyLanesPhone.svelte';
	import HeldGlyph from './HeldGlyph.svelte';
	import Chip from './Chip.svelte';
	import { href } from '$lib/paths';
	import type { EnvironmentTheme } from '$lib/environment-theme';
	import { NO_ENV, ageOf, holdWord, type LaneCell, type LaneLink, type LaneModel } from '$lib/view-models/dependency-lanes';

	let {
		model,
		phone: phoneProp,
		focus = null,
		highlight = null,
		themeOf,
		now
	}: {
		model: LaneModel;
		/** The page's one phone breakpoint (its wrap container); when unset the lanes measure their own width. */
		phone?: boolean;
		/** Node ids to keep at full ink; everything else dims. Null = no focus. */
		focus?: Set<string> | null;
		/** Link keys another region points at (the rail's Held relationships row under the pointer); lit like a hovered edge. */
		highlight?: string[] | null;
		themeOf: (col: string) => EnvironmentTheme | null;
		now: Date;
	} = $props();

	let width = $state(0);
	let expanded = $state(new Set<string>());
	function toggle(k: string) {
		const n = new Set(expanded);
		if (n.has(k)) n.delete(k);
		else n.add(k);
		expanded = n;
	}

	const phone = $derived(phoneProp ?? (width > 0 && width < 640));
	const colLabel = (c: string) => (c === NO_ENV ? 'No environment' : c);
	const rolloutHref = (c: LaneCell) =>
		c.nodes.length === 1
			? href(`/rollouts/${c.nodes[0].cluster}/${c.nodes[0].namespace}/${c.nodes[0].name}`)
			: href(`/apps/${c.service}`);

	// ── geometry ────────────────────────────────────────────────────────────
	const CELL_H = 48;
	const ROW_GAP = 12;
	const GROUP_GAP = 32;
	const HEAD_H = 40;
	const PROMO = 36; // promotion port on both faces, level along a row
	const NEAR = 16; // nearest trunk to the cell face: room for the 9px stub + chevron
	const PITCH = 8; // trunk to trunk
	const R = 6; // elbow radius

	const colKeys = $derived(model.columns.map((c) => c.key));
	const colIndex = $derived(new Map(colKeys.map((c, i) => [c, i] as const)));

	/** providers with a contract trunk, per column */
	const tracksByCol = $derived.by(() => {
		const t = new Map<string, string[]>();
		for (const c of colKeys) t.set(c, []);
		for (const l of model.links) {
			if (l.kind !== 'contract') continue;
			const p = model.cells.get(l.from)!;
			const arr = t.get(p.col)!;
			if (!arr.includes(l.from)) arr.push(l.from);
		}
		return t;
	});

	/** horizontal layout: label column, gutters (trunks), cells */
	const cols = $derived.by(() => {
		const label = labelWidth(width);
		const base = colKeys.map((c) => gutterWidth(tracksByCol.get(c)!.length));
		const free = Math.max(0, width - label - base.reduce((a, b) => a + b, 0));
		let cellW = colKeys.length ? free / colKeys.length : 0;
		let extra = 0;
		if (cellW > CELL_MAX) {
			// past a comfortable node width, a little goes to the gutters (capped), the rest stays unused (the card is capped)
			extra = Math.min(GUT_EXTRA, ((cellW - CELL_MAX) * colKeys.length) / Math.max(1, colKeys.length));
			cellW = CELL_MAX;
		}
		const cellX = new Map<string, number>();
		let x = label;
		colKeys.forEach((c, i) => {
			x += base[i] + extra;
			cellX.set(c, x);
			x += cellW;
		});
		return { label, cellW, cellX, right: x };
	});

	/** under ~170px a cell drops the line-2 indent and the age (the rail and the tooltip keep it) */
	const compact = $derived(cols.cellW < 170);
	const SITE_H = $derived(compact ? 38 : 26);
	/** From this cell width a site fits one line (wave, name, build, age or word, mark); below it, two (R2-DES-B-4). */
	const SITE_ONE_LINE = 280;
	let sitesH = $state<Record<string, number>>({});

	/**
	 * "frees N" on a blocker's cell (round 2, TL item a): operator question 2 answered INSIDE the map, the same figure
	 * the rail's ranked list leads with, so a reader can go from the rail to the cell and back by one number (D6). Drawn as
	 * the cell's footer band (Dagster's status footer, REFS addenda) so it never competes with the build for line 1: at the
	 * 1440 compact width (~125px) "5.1.0" and "frees 7" do not fit one line, and a footer marks where to start.
	 */
	const freesOf = $derived.by(() => {
		const m = new Map<string, number>();
		for (const b of model.blockers) m.set(b.cell.key, (m.get(b.cell.key) ?? 0) + b.frees.length);
		return m;
	});
	const FOOT_H = 22;

	/**
	 * Measured heights (R2-DES-B-1/-7): a cell's head grows by a line when its reason wraps, a row label when the service
	 * name wraps; the row takes the tallest. Measured off the rendered text (bind:clientHeight), so the font decides, not a
	 * character count. Neither box's own height depends on the row's, so the measurement cannot loop.
	 */
	let headH = $state<Record<string, number>>({});
	let labelH = $state<Record<string, number>>({});
	const head = (k: string) => Math.max(CELL_H, Math.ceil(headH[k] ?? 0));
	const rowsGeo = $derived.by(() => {
		const cellH = (c: LaneCell) =>
			(expanded.has(c.key) && c.sites.length > 1 ? head(c.key) + (sitesH[c.key] ? Math.ceil(sitesH[c.key]) + 2 : c.sites.length * SITE_H + 8) : head(c.key)) + (freesOf.has(c.key) ? FOOT_H : 0);
		const rowTop = new Map<string, number>();
		const rowH = new Map<string, number>();
		const seps: number[] = [];
		let y = HEAD_H;
		model.rows.forEach((r, i) => {
			if (i > 0 && r.group !== model.rows[i - 1].group) {
				seps.push(y + GROUP_GAP / 2 - ROW_GAP / 2);
				y += GROUP_GAP - ROW_GAP;
			}
			rowTop.set(r.service, y);
			const h = Math.max(CELL_H, Math.ceil(labelH[r.service] ?? 0), ...[...r.cells.values()].map(cellH));
			rowH.set(r.service, h);
			y += h + ROW_GAP;
		});
		return { rowTop, rowH, seps, height: y - ROW_GAP + 4, cellH };
	});

	// ── routing ─────────────────────────────────────────────────────────────
	type Wire = {
		key: string;
		/** what lights on hover/focus */
		links: string[];
		/** drawn pieces: solid / dashed (a skipped slot) */
		parts: { d: string; dashed?: boolean }[];
		held: boolean;
		trunk: boolean;
		from: string;
		src: [number, number];
		dst: [number, number];
		forks: [number, number][];
		/** the branch the pointer/keyboard picks this link by */
		hit: string;
	};

	const routing = $derived.by(() => {
		const { cellX, cellW } = cols;
		const { rowTop, rowH } = rowsGeo;
		const contracts = model.links.filter((l) => l.kind === 'contract' && model.cells.get(l.from)!.col === model.cells.get(l.to)!.col);
		const top = (k: string) => rowTop.get(model.cells.get(k)!.service)!;

		/** left-face contract ports of every cell for a given trunk x order */
		function ports(tx: Map<string, number>) {
			const at = new Map<string, number>(); // `in:<link>` / `out:<cell>` -> y
			const faces = new Map<string, { id: string; x: number; out: boolean }[]>();
			for (const l of contracts) {
				const f = faces.get(l.to) ?? faces.set(l.to, []).get(l.to)!;
				f.push({ id: `in:${l.key}`, x: tx.get(l.from)!, out: false });
				const g = faces.get(l.from) ?? faces.set(l.from, []).get(l.from)!;
				if (!g.some((e) => e.id === `out:${l.from}`)) g.push({ id: `out:${l.from}`, x: tx.get(l.from)!, out: true });
			}
			for (const [cell, f] of faces) {
				// inbound first, nearest trunk highest; the cell's own outbound under them
				f.sort((a, b) => Number(a.out) - Number(b.out) || b.x - a.x);
				const k = f.length;
				const ys = k === 1 ? [16] : k === 2 ? [12, 24] : k === 3 ? [10, 18, 26] : f.map((_, i) => 8 + (i * 20) / (k - 1));
				f.forEach((e, i) => at.set(e.id, top(cell) + ys[i]));
			}
			return at;
		}

		// trunk order per column: try every permutation (≤6), keep the one with the fewest stub-over-trunk crossings
		const trunkX = new Map<string, number>();
		for (const c of colKeys) {
			const ps = tracksByCol.get(c)!;
			if (!ps.length) continue;
			const near = cellX.get(c)! - NEAR;
			const place = (order: string[]) => order.forEach((p, i) => trunkX.set(p, near - PITCH * (order.length - 1 - i)));
			const perms = (a: string[]): string[][] => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((r) => [x, ...r])));
			const options = ps.length <= 6 ? perms(ps) : [ps];
			let best = options[0];
			let bestScore = Infinity;
			for (const o of options) {
				place(o);
				const at = ports(trunkX);
				let score = 0;
				for (const p of o) {
					const own = contracts.filter((l) => l.from === p);
					const ys = [at.get(`out:${p}`)!, ...own.map((l) => at.get(`in:${l.key}`)!)];
					const lo = Math.min(...ys);
					const hi = Math.max(...ys);
					const x = trunkX.get(p)!;
					// stubs of other trunks further left whose y falls inside this trunk's span
					for (const q of o) {
						if (q === p || trunkX.get(q)! >= x) continue;
						const qs = [at.get(`out:${q}`)!, ...contracts.filter((l) => l.from === q).map((l) => at.get(`in:${l.key}`)!)];
						for (const y of qs) if (y > lo && y < hi) score++;
					}
				}
				if (score < bestScore) {
					bestScore = score;
					best = o;
				}
			}
			place(best);
		}
		const at = ports(trunkX);

		const out: Wire[] = [];
		// contract bundles: one trunk per provider, a branch per consumer
		const byProvider = new Map<string, LaneLink[]>();
		for (const l of contracts) (byProvider.get(l.from) ?? byProvider.set(l.from, []).get(l.from)!).push(l);
		for (const [p, ls] of byProvider) {
			const px = cellX.get(model.cells.get(p)!.col)!;
			const py = at.get(`out:${p}`)!;
			const tx = trunkX.get(p)!;
			const below = ls.filter((l) => at.get(`in:${l.key}`)! > py).sort((a, b) => at.get(`in:${a.key}`)! - at.get(`in:${b.key}`)!);
			const above = ls.filter((l) => at.get(`in:${l.key}`)! < py).sort((a, b) => at.get(`in:${b.key}`)! - at.get(`in:${a.key}`)!);
			for (const side of [below, above]) {
				side.forEach((l, i) => {
					const cy = at.get(`in:${l.key}`)!;
					const cx = cellX.get(model.cells.get(l.to)!.col)!;
					const s = cy > py ? 1 : -1;
					const last = i === side.length - 1;
					const end = cx - (l.held ? 6 : 1);
					const d = last
						? `M${px},${py} H${tx + R} Q${tx},${py} ${tx},${py + s * R} V${cy - s * R} Q${tx},${cy} ${tx + R},${cy} H${end}`
						: `M${px},${py} H${tx + R} Q${tx},${py} ${tx},${py + s * R} V${cy} H${end}`;
					out.push({
						key: l.key,
						links: [l.key],
						parts: [{ d }],
						held: l.held,
						trunk: true,
						from: `trunk:${p}`,
						src: [px, py],
						dst: [cx, cy],
						forks: last ? [] : [[tx, cy]],
						hit: `M${tx},${cy} H${cx}`
					});
				});
			}
		}

		// promotion: straight along the row; dashed across an empty slot; through the row gap if a cell is in the way
		for (const l of model.links) {
			if (l.kind !== 'promotion') continue;
			const a = model.cells.get(l.from)!;
			const b = model.cells.get(l.to)!;
			const x1 = cellX.get(a.col)! + cellW;
			const x2 = cellX.get(b.col)!;
			const end = x2 - (l.held ? 6 : 1);
			const ia = colIndex.get(a.col)!;
			const ib = colIndex.get(b.col)!;
			const between = colKeys.slice(Math.min(ia, ib) + 1, Math.max(ia, ib));
			const row = model.rows.find((r) => r.service === a.service)!;
			const y = top(l.from) + PROMO;
			const yb = top(l.to) + PROMO;
			const blockedBy = a.service === b.service && between.some((c) => row.cells.has(c));
			let parts: { d: string; dashed?: boolean }[];
			if (a.service !== b.service || blockedBy || ib < ia) {
				// down into the gap under the row, across, up into the target's face
				const gy = rowTop.get(a.service)! + rowH.get(a.service)! + ROW_GAP / 2;
				const xa = x1 + 8;
				const xb = x2 - NEAR + 4;
				parts = [{ d: `M${x1},${y} H${xa - R} Q${xa},${y} ${xa},${y + R} V${gy - R} Q${xa},${gy} ${xa + R},${gy} H${xb - R} Q${xb},${gy} ${xb},${gy - R} V${yb + R} Q${xb},${yb} ${xb + R},${yb} H${end}` }];
			} else if (between.length) {
				// the skipped slots: dashed from the slot's gutter start to its right edge
				parts = [];
				let x = x1;
				for (const c of between) {
					const s0 = cellX.get(c)! - 6;
					const s1 = cellX.get(c)! + cellW + 6;
					parts.push({ d: `M${x},${y} H${s0}` });
					parts.push({ d: `M${s0},${y} H${s1}`, dashed: true });
					x = s1;
				}
				parts.push({ d: `M${x},${y} H${end}` });
			} else {
				parts = [{ d: `M${x1},${y} H${end}` }];
			}
			out.push({
				key: l.key,
				links: [l.key],
				parts,
				held: l.held,
				trunk: false,
				from: `promo:${l.key}`,
				src: [x1, y],
				dst: [x2, yb],
				forks: [],
				hit: parts.map((p) => p.d).join(' ')
			});
		}
		// a bundle hit: the trunk itself lights every link it carries
		const bundles: { key: string; links: string[]; d: string; label: string }[] = [];
		for (const [p, ls] of byProvider) {
			if (ls.length < 2) continue;
			const px = cellX.get(model.cells.get(p)!.col)!;
			const py = at.get(`out:${p}`)!;
			const ys = ls.map((l) => at.get(`in:${l.key}`)!);
			const tx = trunkX.get(p)!;
			bundles.push({
				key: `trunk:${p}`,
				links: ls.map((l) => l.key),
				d: `M${px},${py} H${tx} V${Math.min(py, ...ys)} V${Math.max(py, ...ys)}`,
				label: `${model.cells.get(p)!.service} serves ${ls.map((l) => model.cells.get(l.to)!.service).join(', ')}`
			});
		}
		// quiet first, held on top
		return { wires: out.sort((x, y) => Number(x.held) - Number(y.held)), bundles };
	});

	// ── hover / focus ───────────────────────────────────────────────────────
	/** what the pointer or keyboard is on: a link group or a cell; null = nothing */
	let hoverOwn = $state<{ links: string[] } | { cell: string } | null>(null);
	const hover = $derived(hoverOwn ?? (highlight?.length ? { links: highlight } : null));
	const linkByKey = $derived(new Map(model.links.map((l) => [l.key, l] as const)));
	const hot = $derived.by(() => {
		if (!hover) return null;
		const links = new Set<string>();
		const cells = new Set<string>();
		if ('cell' in hover) {
			cells.add(hover.cell);
			for (const l of model.links)
				if (l.from === hover.cell || l.to === hover.cell) {
					links.add(l.key);
					cells.add(l.from);
					cells.add(l.to);
				}
		} else {
			for (const k of hover.links) {
				const l = linkByKey.get(k);
				if (!l) continue;
				links.add(k);
				cells.add(l.from);
				cells.add(l.to);
			}
		}
		return { links, cells };
	});
	const litCell = (c: LaneCell) => (hot ? hot.cells.has(c.key) : !focus || c.nodes.some((n) => focus!.has(n.id)));
	const litWire = (w: Wire) => {
		if (hot) return w.links.some((k) => hot.links.has(k));
		const l = linkByKey.get(w.key)!;
		return litCell(model.cells.get(l.from)!) && litCell(model.cells.get(l.to)!);
	};
	/** the held relationships whose whole fact shows as a pill: the hovered held link(s), or a hovered held cell's inbound ones */
	const pills = $derived.by(() => {
		if (!hover) return [];
		const ls =
			'cell' in hover
				? model.links.filter((l) => l.held && l.to === hover!.cell)
				: hover.links.map((k) => linkByKey.get(k)!).filter((l) => l?.held);
		return ls.map((l) => {
			const w = routing.wires.find((w) => w.key === l.key)!;
			return { key: l.key, x: w.dst[0], y: w.dst[1], text: fullFact(l) };
		});
	});

	/**
	 * PILL PLACEMENT (R2-DES-B-2, L13). A pill never overlaps another pill, a cell or a row label. Each pill is measured,
	 * then placed at the first free spot of a short search: above the edge's arrow, below it, sliding up/down the gutter
	 * side in 12px steps, then to the right of the consumer cell. Pills already placed are obstacles, so the two inbound
	 * relationships of a hovered cell stack instead of colliding. With no free spot it keeps the first one (above the arrow).
	 */
	let pillSize = $state<Record<string, { w: number; h: number }>>({});
	const placed = $derived.by(() => {
		type Box = { x: number; y: number; w: number; h: number };
		const hit = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
		const obstacles: Box[] = [];
		for (const c of model.cells.values()) {
			const t = rowsGeo.rowTop.get(c.service);
			const x = cols.cellX.get(c.col);
			if (t == null || x == null) continue;
			obstacles.push({ x: x - 2, y: t - 2, w: cols.cellW + 4, h: rowsGeo.cellH(c) + 4 });
		}
		for (const r of model.rows) {
			const t = rowsGeo.rowTop.get(r.service)!;
			obstacles.push({ x: 0, y: t, w: cols.label - 12, h: Math.max(CELL_H, labelH[r.service] ?? 0) });
		}
		const out = new Map<string, { left: number; top: number }>();
		for (const p of pills) {
			const sz = pillSize[p.key];
			if (!sz || !sz.w || !sz.h) continue;
			const l = linkByKey.get(p.key)!;
			const toRight = (cols.cellX.get(model.cells.get(l.to)!.col) ?? 0) + cols.cellW + 8;
			const cands: { left: number; top: number }[] = [];
			const left = p.x - 10 - sz.w;
			cands.push({ left, top: p.y - sz.h - 4 }, { left, top: p.y + 4 });
			for (let k = 1; k <= 10; k++) cands.push({ left, top: p.y - sz.h - 4 - 12 * k }, { left, top: p.y + 4 + 12 * k });
			for (let k = 0; k <= 4; k++) cands.push({ left: toRight, top: p.y - sz.h / 2 - 12 * k }, { left: toRight, top: p.y - sz.h / 2 + 12 * k });
			const inBounds = (b: Box) => b.x >= 0 && b.y >= 0 && b.x + b.w <= cols.right && b.y + b.h <= rowsGeo.height;
			const pick = cands.find((c) => {
				const b = { x: c.left, y: c.top, w: sz.w, h: sz.h };
				return inBounds(b) && !obstacles.some((o) => hit(o, b));
			}) ?? cands[0];
			out.set(p.key, pick);
			obstacles.push({ x: pick.left - 2, y: pick.top - 2, w: sz.w + 4, h: sz.h + 4 });
		}
		return out;
	});

	/** "needs payments ~2.9.0 · has 2.4.1" / "e2c9b47 not in dev yet" — the relationship said once */
	function fullFact(l: LaneLink): string {
		if (l.kind === 'contract') {
			const need = l.needs.length ? ` ${l.needs.join(' or ')}` : '';
			const has = l.serves ? ` · has ${l.serves}` : ' · has none here';
			return `needs ${l.contract ?? 'a contract'}${need}${has}`;
		}
		const build = l.edges.find((e) => e.held.length)?.held[0];
		const from = colLabel(model.cells.get(l.from)!.col);
		return build ? `${build} not in ${from} yet` : `waits for ${from}`;
	}
	function wireLabel(w: Wire): string {
		const l = linkByKey.get(w.key)!;
		const a = model.cells.get(l.from)!;
		const b = model.cells.get(l.to)!;
		const where = a.col === b.col ? `in ${colLabel(a.col)}` : `${colLabel(a.col)} to ${colLabel(b.col)}`;
		const what = l.kind === 'contract' ? `${a.service} serves ${b.service} ${where}` : `${a.service} promotes ${where}`;
		return `${what}, ${l.held ? `held: ${fullFact(l)}` : 'clear'}`;
	}

	/** In a cell the trunk already names the provider: `needs ~2.9.0`. The full form is the hover pill and the tooltip. */
	function shortNeed(c: LaneCell): string | null {
		if (!c.reason) return null;
		return c.reason.replace(/^needs (\S+) (\S+)$/, 'needs $2');
	}
	function needLine(c: LaneCell): string | null {
		if (!c.reason) return null;
		const inbound = model.links.find((l) => l.kind === 'contract' && l.to === c.key && l.held);
		return inbound ? fullFact(inbound) : c.reason;
	}
	function sinceOf(c: LaneCell): string | null {
		const l = model.links.filter((l) => l.to === c.key && l.held && l.since).map((l) => l.since!).sort()[0];
		return ageOf(l ?? null, now);
	}

	// ── keyboard (round 2, TL item f): Tab walks cells row by row in column order; arrows move along rows / columns
	const grid = $derived(model.rows.map((r) => colKeys.map((c) => r.cells.get(c)?.key ?? null)));
	let root = $state<HTMLDivElement>();
	function move(e: KeyboardEvent, key: string) {
		const d = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] }[e.key];
		if (!d) return;
		let r = grid.findIndex((row) => row.includes(key));
		let c = grid[r].indexOf(key);
		for (;;) {
			r += d[0];
			c += d[1];
			if (r < 0 || r >= grid.length || c < 0 || c >= colKeys.length) return;
			const k = grid[r][c];
			if (k) {
				e.preventDefault();
				root?.querySelector<HTMLElement>(`[data-cell="${CSS.escape(k)}"] [data-cell-link]`)?.focus();
				return;
			}
			// along a row skip empty slots; down a column keep looking in that column
		}
	}
</script>

<div class="lanes" bind:clientWidth={width} bind:this={root} data-lanes>
	{#if width === 0}
		<div style="height: 320px"></div>
	{:else if !phone}
		<div class="relative" style="height: {rowsGeo.height}px" data-lanes-matrix>
			<!-- column heads: the one place environment identity is drawn -->
			{#each model.columns as col (col.key)}
				{@const t = themeOf(col.key)}
				<div
					class="absolute flex items-center justify-between gap-2"
					style="left: {cols.cellX.get(col.key)}px; width: {cols.cellW}px; top: 4px; height: 28px"
					data-lane-head={col.key}
				>
					{#if t}
						<Chip role="env" theme={t} label={col.key} wide />
					{:else}
						<span class="t-ui-sm text-fg-muted">{colLabel(col.key)}</span>
					{/if}
					<!-- one kind of rollup per head (R2-DES-B-10): "N held", or nothing when none is (a bare cell count read as a third kind) -->
					{#if col.held}
						<span class="t-meta shrink-0 whitespace-nowrap tabular-nums text-held">{col.held} held</span>
					{/if}
				</div>
			{/each}
			{#each rowsGeo.seps as y (y)}
				<div class="absolute right-0 left-0 border-t border-line-subtle" style="top: {y}px"></div>
			{/each}

			<svg class="pointer-events-none absolute inset-0 overflow-visible" width="100%" height={rowsGeo.height} aria-hidden="true">
				{#each routing.wires as w (w.key)}
					{@const on = litWire(w)}
					<g class="wire" class:wire--held={w.held} class:wire--dim={!on} class:wire--hot={hot && on}>
						{#each w.parts as p, i (i)}
							<path d={p.d} class="halo" />
						{/each}
						{#each w.parts as p, i (i)}
							<path d={p.d} class="line" class:dashed={p.dashed} data-link={w.key} data-from={w.from} />
						{/each}
						<circle cx={w.src[0]} cy={w.src[1]} r="2" class="port" />
						{#each w.forks as [x, y], i (i)}
							<circle cx={x} cy={y} r="2" class="port" />
						{/each}
						{#if w.held}
							<path d="M{w.dst[0] - 6},{w.dst[1] - 3.5} L{w.dst[0]},{w.dst[1]} L{w.dst[0] - 6},{w.dst[1] + 3.5} Z" class="head" />
						{:else}
							<path d="M{w.dst[0] - 5},{w.dst[1] - 3.5} L{w.dst[0] - 1},{w.dst[1]} L{w.dst[0] - 5},{w.dst[1] + 3.5}" class="chev" />
						{/if}
					</g>
				{/each}
			</svg>

			{#each model.rows as row (row.service)}
				{@const top = rowsGeo.rowTop.get(row.service)!}
				<!-- the row label wraps, never ellipsizes (R2-DES-B-7): a name breaks after a hyphen ("hello-frontend-" / "app"), its
				     measured height can grow the row -->
				<div class="absolute min-w-0 pr-3" style="left: 0; top: {top}px; width: {cols.label}px" bind:clientHeight={labelH[row.service]} data-row-label class:dim={!![...row.cells.values()].length && ![...row.cells.values()].some(litCell)}>
					<a href={href(`/apps/${row.service}`)} class="t-card-title block pt-[6px] text-fg [overflow-wrap:anywhere] hover:underline">{#each row.service.split('-') as part, i (i)}{i ? '-' : ''}{#if i}<wbr />{/if}{part}{/each}</a>
					{#if row.provides.length}
						<p class="t-meta text-fg-subtle [overflow-wrap:anywhere]">provides {row.provides.join(', ')}</p>
					{/if}
				</div>
				{#each colKeys as colKey (colKey)}
					{@const c = row.cells.get(colKey)}
					{#if c}
						{@const multi = c.sites.length > 1}
						{@const open = expanded.has(c.key)}
						{@const since = sinceOf(c)}
						{@const frees = freesOf.get(c.key) ?? 0}
						<!-- svelte-ignore a11y_no_noninteractive_element_interactions (hover/focus only light edges; the cell's link is the control) -->
						<div
							class="cell absolute"
							class:cell--held={c.held > 0}
							class:dim={!litCell(c)}
							style="left: {cols.cellX.get(c.col)}px; top: {top}px; width: {cols.cellW}px; height: {rowsGeo.cellH(c)}px"
							data-cell={c.key}
							role="group"
							aria-label="{c.service} in {colLabel(c.col)}"
							onmouseenter={() => (hoverOwn = { cell: c.key })}
							onmouseleave={() => (hoverOwn = null)}
							onfocusin={() => (hoverOwn = { cell: c.key })}
							onfocusout={() => (hoverOwn = null)}
							onkeydown={(e) => move(e, c.key)}
						>
							<!-- the head: never an ellipsis (R2-DES-B-1); a reason longer than the cell wraps and the measured head grows the row -->
							<div class="tap-zone relative flex min-h-12 flex-col justify-center px-3 py-1" bind:clientHeight={headH[c.key]}>
								<div class="flex min-w-0 items-center" class:gap-2={!compact} class:gap-1.5={compact}>
									<StatusMark state={c.held ? 'held' : 'newest'} />
									{#if multi}
										<a href={rolloutHref(c)} class="tap-link t-ui-sm min-w-0 whitespace-nowrap text-fg" data-cell-link>{c.sites.length} regions</a>
									{:else}
										<a href={rolloutHref(c)} class="tap-link t-code-sm min-w-0 text-fg [overflow-wrap:anywhere]" data-cell-link>{c.build ?? 'no build'}</a>
									{/if}
									<span class="ml-auto flex shrink-0 items-center gap-1.5">
										{#if multi}
											<button
												type="button"
												class="unfold relative z-10 rounded-sm text-fg-subtle hover:text-fg"
												aria-expanded={open}
												aria-label="{open ? 'Fold' : 'Unfold'} {c.sites.length} regions of {c.service} in {colLabel(c.col)}"
												onclick={() => toggle(c.key)}
												data-unfold={c.key}
											>
												{#if open}<ChevronUpOutline class="h-3.5 w-3.5" />{:else}<ChevronDownOutline class="h-3.5 w-3.5" />{/if}
											</button>
										{/if}
									</span>
								</div>
								{#if c.held}
									<p class="t-meta flex min-w-0 gap-2 text-held" class:pl-6={!compact} title={needLine(c) ?? undefined}>
										<span class="min-w-0 [overflow-wrap:anywhere]">{shortNeed(c)}</span>
										{#if since && !compact}<span class="ml-auto shrink-0 tabular-nums text-fg-subtle" title="Held since">{since}</span>{/if}
									</p>
								{:else if multi && c.build}
									<p class="t-code-sm text-fg-subtle [overflow-wrap:anywhere]" class:pl-6={!compact}>{c.build}</p>
								{/if}
							</div>
							{#if multi && open}
								<!-- the unfolded regions (R2-DES-B-4): the site name is whole at every width that draws the matrix. Under ~280px a
								     site is two lines — the name alone, then its build and, when held, the age in held ink or, with no hold time
								     (af-south-1, held by an approval), the hold's word; a long pair wraps to a third line instead of clipping. From
								     280px one line: wave · name · build · age-or-word · held mark. The list is measured, so the cell fits it. -->
								<ul class="border-t border-line-subtle px-3 py-1" data-sites={c.key} bind:offsetHeight={sitesH[c.key]}>
									{#each c.sites as s (s.node.id)}
										{@const age = s.held ? ageOf(s.since, now) : null}
										{@const word = s.held && !age ? (holdWord(s.reason) ?? 'held') : null}
										{@const siteHref = href(`/rollouts/${s.node.cluster}/${s.node.namespace}/${s.node.name}`)}
										{@const tip = `${s.wave != null ? `Wave ${s.wave} · ` : ''}${s.node.build ?? 'no build'}${s.reason ? ` · ${s.reason}` : ''}`}
										{#if cols.cellW < SITE_ONE_LINE}
											<li class="flex flex-col justify-center py-1" data-site={s.site}>
												<a href={siteHref} class="t-meta min-w-0 text-fg [overflow-wrap:anywhere] hover:underline" title={tip}>{s.site}</a>
												<span class="flex min-w-0 flex-wrap items-center gap-x-1.5">
													<span class="t-code-sm text-fg-muted">{s.node.build ?? 'no build'}</span>
													{#if age}<span class="t-meta ml-auto tabular-nums text-held" title="Held since">{age}</span>{/if}
													{#if word}<span class="t-meta ml-auto text-held" title={s.reason ?? 'Held'}>{word}</span>{/if}
												</span>
											</li>
										{:else}
											<li class="flex min-h-[26px] items-center gap-2" data-site={s.site}>
												<span class="t-meta w-6 shrink-0 tabular-nums text-fg-disabled">{s.wave != null ? `W${s.wave}` : ''}</span>
												<a href={siteHref} class="t-meta min-w-0 text-fg [overflow-wrap:anywhere] hover:underline" title={tip}>{s.site}</a>
												<span class="t-code-sm ml-auto shrink-0 text-fg-muted">{s.node.build ?? 'no build'}</span>
												{#if age}<span class="t-meta shrink-0 tabular-nums text-fg-subtle" title="Held since">{age}</span>{/if}
												{#if word}<span class="t-meta shrink-0 text-held" title={s.reason ?? 'Held'}>{word}</span>{/if}
												<span class="w-3 shrink-0">{#if s.held}<HeldGlyph size={12} class="text-held" title={s.reason ?? 'Held'} />{/if}</span>
											</li>
										{/if}
									{/each}
								</ul>
							{/if}
							{#if frees}
								<p class="foot t-meta flex items-center justify-between gap-2 px-3 tabular-nums text-held" style="height: {FOOT_H}px" title="Shipping this frees {frees} held rollout{frees === 1 ? '' : 's'}" data-frees>
									<span class="truncate">frees {frees}{compact ? '' : ` rollout${frees === 1 ? '' : 's'}`}</span>
								</p>
							{/if}
						</div>
					{/if}
				{/each}
			{/each}

			<!-- hit layer: over the cells so a branch's last pixels still answer; transparent, wide, keyboard-reachable after the cells -->
			<svg class="pointer-events-none absolute inset-0 overflow-visible" width="100%" height={rowsGeo.height}>
				{#each routing.bundles as b (b.key)}
					<path
						d={b.d}
						class="hit"
						role="button"
						tabindex="-1"
						aria-label={b.label}
						onmouseenter={() => (hoverOwn = { links: b.links })}
						onmouseleave={() => (hoverOwn = null)}
					/>
				{/each}
				{#each routing.wires as w (w.key)}
					<path
						d={w.hit}
						class="hit"
						role="button"
						tabindex="0"
						aria-label={wireLabel(w)}
						data-hit={w.key}
						onmouseenter={() => (hoverOwn = { links: w.links })}
						onmouseleave={() => (hoverOwn = null)}
						onfocus={() => (hoverOwn = { links: w.links })}
						onblur={() => (hoverOwn = null)}
					/>
				{/each}
			</svg>

			{#each pills as p (p.key)}
				{@const at = placed.get(p.key)}
				<div
					class="pill t-meta pointer-events-none absolute whitespace-nowrap text-held"
					style="left: {at?.left ?? 0}px; top: {at?.top ?? 0}px; visibility: {at ? 'visible' : 'hidden'}"
					bind:offsetWidth={() => pillSize[p.key]?.w ?? 0, (w) => (pillSize[p.key] = { w, h: pillSize[p.key]?.h ?? 0 })}
					bind:offsetHeight={() => pillSize[p.key]?.h ?? 0, (h) => (pillSize[p.key] = { w: pillSize[p.key]?.w ?? 0, h })}
					data-pill={p.key}
				>
					{p.text}
				</div>
			{/each}
		</div>
	{:else}
		<DependencyLanesPhone {model} {focus} />
	{/if}
</div>

<style>
	.cell {
		border: 1px solid var(--k-line);
		background: var(--k-surface);
		border-radius: 8px;
		overflow: hidden;
		transition: opacity 120ms ease;
	}
	.cell--held {
		border-color: var(--color-held-line);
	}
	.dim {
		opacity: 0.22;
	}
	.wire {
		transition: opacity 120ms ease;
	}
	.wire .line {
		fill: none;
		stroke: var(--k-wire);
		stroke-width: 1;
	}
	.wire .line.dashed {
		stroke-dasharray: 2 3;
	}
	.wire .halo {
		fill: none;
		stroke: var(--k-surface);
		stroke-width: 5;
	}
	.wire .port {
		fill: var(--k-wire);
	}
	.wire .chev {
		fill: none;
		stroke: var(--k-wire);
		stroke-width: 1;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.wire--hot .line,
	.wire--hot .chev {
		stroke: var(--k-fg-subtle);
	}
	.wire--hot .port {
		fill: var(--k-fg-subtle);
	}
	.wire--held .line,
	.wire--held.wire--hot .line {
		stroke: var(--color-held);
		stroke-width: 1.5;
	}
	.wire--held .port,
	.wire--held.wire--hot .port,
	.wire--held .head {
		fill: var(--color-held);
	}
	.wire--dim {
		opacity: 0.18;
	}
	.hit {
		fill: none;
		stroke: transparent;
		stroke-width: 10;
		pointer-events: stroke;
		cursor: default;
		outline: none;
	}
	.hit:focus-visible {
		stroke: color-mix(in oklab, var(--k-wire) 45%, transparent);
	}
	.pill {
		z-index: 20;
		background: var(--k-surface);
		border: 1px solid var(--color-held-line);
		border-radius: 4px;
		padding: 1px 6px;
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
	}
	.foot {
		border-top: 1px solid var(--color-held-line);
		background: var(--color-held-tint);
	}
	.unfold::before {
		content: '';
		position: absolute;
		inset: -8px;
	}
</style>
