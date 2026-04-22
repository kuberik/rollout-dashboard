<script lang="ts">
	type HistoryEntry = {
		timestamp: string;
		bakeStatus?: string;
		version: { tag: string; version?: string; revision?: string };
		message?: string;
		triggeredBy?: { kind: 'User' | 'System'; name: string };
	};

	type ServiceRow = {
		id: string;
		name: string;
		history: HistoryEntry[];
		isCurrent: boolean;
	};

	type PresetRange = '1h' | '6h' | '1d' | '7d' | '30d' | 'all';
	type TimeRange = PresetRange | { start: number; end: number };

	function isPreset(tr: TimeRange): tr is PresetRange {
		return typeof tr === 'string';
	}

	const TIME_RANGES: { value: PresetRange; label: string }[] = [
		{ value: '1h', label: '1h' },
		{ value: '6h', label: '6h' },
		{ value: '1d', label: '1d' },
		{ value: '7d', label: '7d' },
		{ value: '30d', label: '30d' },
		{ value: 'all', label: 'All' }
	];

	let {
		services,
		timeRange = $bindable<TimeRange>('7d'),
		selectedEntry = null as { serviceId: string; index: number } | null,
		onEntryClick = undefined as ((serviceId: string, index: number) => void) | undefined
	}: {
		services: ServiceRow[];
		timeRange?: TimeRange;
		selectedEntry?: { serviceId: string; index: number } | null;
		onEntryClick?: (serviceId: string, index: number) => void;
	} = $props();

	// Responsive width
	let containerEl: HTMLDivElement | undefined = $state();
	let containerWidth = $state(600);

	$effect(() => {
		if (!containerEl) return;
		const ro = new ResizeObserver((entries) => {
			containerWidth = Math.max(300, entries[0].contentRect.width);
		});
		ro.observe(containerEl);
		return () => ro.disconnect();
	});

	// Layout constants
	const LABEL_W = 130;
	const PAD_R = 24;
	const PAD_T = 16;
	const PAD_B = 38;
	const ROW_H = 52;
	const R_NORMAL = 5;
	const R_ACTIVE = 8;

	const now = new Date();

	function computeBounds(tr: TimeRange): { startMs: number; endMs: number } {
		const nowMs = now.getTime();
		if (!isPreset(tr)) return { startMs: tr.start, endMs: tr.end };
		const msMap: Record<PresetRange, number | null> = {
			'1h': 3_600_000,
			'6h': 21_600_000,
			'1d': 86_400_000,
			'7d': 604_800_000,
			'30d': 2_592_000_000,
			all: null
		};
		const ms = msMap[tr];
		if (ms !== null) return { startMs: nowMs - ms, endMs: nowMs };
		let earliest = nowMs;
		for (const svc of services) {
			for (const e of svc.history) {
				const t = new Date(e.timestamp).getTime();
				if (t < earliest) earliest = t;
			}
		}
		return { startMs: earliest - (nowMs - earliest) * 0.05, endMs: nowMs };
	}

	const bounds = $derived(computeBounds(timeRange));
	const startMs = $derived(bounds.startMs);
	const endMs = $derived(bounds.endMs);
	const plotW = $derived(Math.max(100, containerWidth - LABEL_W - PAD_R));
	const chartH = $derived(PAD_T + Math.max(1, services.length) * ROW_H + PAD_B);

	function tsToX(ts: string): number {
		const t = new Date(ts).getTime();
		const ratio = Math.max(0, Math.min(1, (t - startMs) / (endMs - startMs)));
		return LABEL_W + ratio * plotW;
	}

	function rowCY(i: number): number {
		return PAD_T + i * ROW_H + ROW_H / 2;
	}

	function statusColor(s?: string): string {
		switch (s) {
			case 'Succeeded':
				return '#22c55e';
			case 'Failed':
				return '#ef4444';
			case 'InProgress':
				return '#f59e0b';
			case 'Deploying':
				return '#3b82f6';
			case 'Cancelled':
				return '#9ca3af';
			default:
				return '#6b7280';
		}
	}

	function statusGlow(s?: string): string {
		switch (s) {
			case 'Succeeded':
				return 'rgba(34,197,94,0.3)';
			case 'Failed':
				return 'rgba(239,68,68,0.3)';
			case 'InProgress':
				return 'rgba(245,158,11,0.3)';
			case 'Deploying':
				return 'rgba(59,130,246,0.3)';
			default:
				return 'transparent';
		}
	}

	function visibleEntries(history: HistoryEntry[]) {
		return history.map((e, i) => ({ e, i })).filter(({ e }) => new Date(e.timestamp).getTime() >= startMs);
	}

	// Hover / tooltip state — anchored to the dot, not the cursor
	let hovId = $state<string | null>(null);
	let hovIdx = $state<number | null>(null);
	let hovDotX = $state(0);
	let hovDotY = $state(0);

	// Chart wrapper ref for computing tooltip vertical offset inside the outer container
	let chartWrapperEl: HTMLDivElement | undefined = $state();

	const tooltipEntry = $derived.by(() => {
		if (hovId === null || hovIdx === null) return null;
		const svc = services.find((s) => s.id === hovId);
		if (!svc) return null;
		return { entry: svc.history[hovIdx], svcName: svc.name };
	});

	const TOOLTIP_W = 220;
	const TOOLTIP_GAP = 12;
	const chartTopOffset = $derived(chartWrapperEl?.offsetTop ?? 0);
	const tipAboveDot = $derived(hovDotY > 80);
	const tipLeft = $derived(
		Math.max(4, Math.min(hovDotX - TOOLTIP_W / 2, containerWidth - TOOLTIP_W - 4))
	);
	const tipTop = $derived(
		tipAboveDot
			? chartTopOffset + hovDotY - TOOLTIP_GAP
			: chartTopOffset + hovDotY + TOOLTIP_GAP
	);

	// Brush-to-zoom state
	let brushStartX = $state<number | null>(null);
	let brushEndX = $state<number | null>(null);

	function pixelToMs(x: number): number {
		const ratio = (x - LABEL_W) / plotW;
		return startMs + ratio * (endMs - startMs);
	}

	function onPointerDown(ev: PointerEvent) {
		const target = ev.target as Element;
		if (target.tagName === 'circle') return;
		if (!containerEl || !chartWrapperEl) return;
		const rect = chartWrapperEl.getBoundingClientRect();
		const x = ev.clientX - rect.left;
		if (x < LABEL_W || x > containerWidth - PAD_R) return;
		brushStartX = x;
		brushEndX = x;
		hovId = null;
		hovIdx = null;
		(ev.currentTarget as SVGElement).setPointerCapture(ev.pointerId);
		ev.preventDefault();
	}

	function onPointerMove(ev: PointerEvent) {
		if (brushStartX === null || !chartWrapperEl) return;
		const rect = chartWrapperEl.getBoundingClientRect();
		const cx = ev.clientX - rect.left;
		brushEndX = Math.max(LABEL_W, Math.min(containerWidth - PAD_R, cx));
	}

	function onPointerUp(ev: PointerEvent) {
		const svgEl = ev.currentTarget as SVGElement;
		if (svgEl.hasPointerCapture(ev.pointerId)) svgEl.releasePointerCapture(ev.pointerId);
		if (brushStartX === null || brushEndX === null) return;
		const a = Math.min(brushStartX, brushEndX);
		const b = Math.max(brushStartX, brushEndX);
		brushStartX = null;
		brushEndX = null;
		if (b - a < 6) return;
		timeRange = { start: pixelToMs(a), end: pixelToMs(b) };
	}

	// Axis ticks — auto-pick interval based on range size
	function axisTicks() {
		const rangeMs = endMs - startMs;
		const thresholds: [number, number][] = [
			[30 * 60_000, 5 * 60_000],
			[3 * 3_600_000, 10 * 60_000],
			[12 * 3_600_000, 3_600_000],
			[3 * 86_400_000, 4 * 3_600_000],
			[14 * 86_400_000, 86_400_000],
			[60 * 86_400_000, 5 * 86_400_000]
		];
		const iv = thresholds.find(([lim]) => rangeMs < lim)?.[1] ?? rangeMs / 6;
		const showTime = rangeMs < 3 * 86_400_000;

		const ticks: { x: number; label: string }[] = [];
		let t = Math.ceil(startMs / iv) * iv;
		while (t <= endMs) {
			const ratio = (t - startMs) / (endMs - startMs);
			const x = LABEL_W + ratio * plotW;
			const d = new Date(t);
			const label = showTime
				? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
				: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
			ticks.push({ x, label });
			t += iv;
		}
		return ticks;
	}

	const ticks = $derived(axisTicks());

	function fmtTooltipDate(ts: string) {
		return new Date(ts).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function truncate(s: string, n: number) {
		return s.length > n ? s.slice(0, n - 1) + '…' : s;
	}
</script>

<div class="relative w-full select-none" bind:this={containerEl}>
	<!-- Time range selector -->
	<div class="mb-3 flex flex-wrap items-center gap-1">
		{#each TIME_RANGES as { value, label }}
			<button
				class="rounded-md px-2.5 py-1 text-xs font-medium transition-colors {isPreset(timeRange) &&
				timeRange === value
					? 'bg-blue-600 text-white shadow-sm'
					: 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'}"
				onclick={() => {
					timeRange = value;
				}}
			>
				{label}
			</button>
		{/each}
		{#if !isPreset(timeRange)}
			<div
				class="ml-2 flex items-center gap-1.5 rounded-md bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-400"
			>
				<span class="font-mono">
					{fmtTooltipDate(new Date(timeRange.start).toISOString())} – {fmtTooltipDate(
						new Date(timeRange.end).toISOString()
					)}
				</span>
				<button
					class="rounded px-1 hover:bg-blue-200 dark:hover:bg-blue-800"
					onclick={() => {
						timeRange = '7d';
					}}
					title="Reset zoom"
					aria-label="Reset zoom"
				>
					✕
				</button>
			</div>
		{:else}
			<span class="ml-2 hidden text-xs text-gray-400 sm:inline dark:text-gray-600">
				drag to zoom
			</span>
		{/if}
	</div>

	<!-- Chart container -->
	<div
		bind:this={chartWrapperEl}
		class="relative overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
	>
		{#if services.length === 0}
			<div class="flex h-24 items-center justify-center text-sm text-gray-400 dark:text-gray-600">
				No data
			</div>
		{:else}
			<svg
				style="width: 100%; display: block; touch-action: none; cursor: {brushStartX !== null
					? 'ew-resize'
					: 'crosshair'};"
				height={chartH}
				onpointerdown={onPointerDown}
				onpointermove={onPointerMove}
				onpointerup={onPointerUp}
				onpointercancel={onPointerUp}
				onmouseleave={() => {
					hovId = null;
					hovIdx = null;
				}}
				role="img"
				aria-label="Deployment timeline chart"
			>
				<!-- Row backgrounds -->
				{#each services as svc, i}
					{@const y = PAD_T + i * ROW_H}
					<rect
						x={0}
						y={y}
						width={containerWidth}
						height={ROW_H}
						class={svc.isCurrent
							? 'fill-blue-50 dark:fill-blue-950/20'
							: i % 2 === 0
								? 'fill-transparent'
								: 'fill-gray-50 dark:fill-gray-800/30'}
					/>
				{/each}

				<!-- Vertical grid lines at ticks -->
				{#each ticks as tick}
					<line
						x1={tick.x}
						y1={PAD_T}
						x2={tick.x}
						y2={PAD_T + services.length * ROW_H}
						stroke-width={0.5}
						stroke-dasharray="3 3"
						class="stroke-gray-200 dark:stroke-gray-700"
					/>
				{/each}

				<!-- Per-service swimlanes -->
				{#each services as svc, i}
					{@const cy = rowCY(i)}
					{@const entries = visibleEntries(svc.history)}

					<!-- Label -->
					<text
						x={LABEL_W - 10}
						y={cy + 4}
						text-anchor="end"
						font-size="11"
						font-family="ui-monospace, 'Cascadia Code', Menlo, monospace"
						class={svc.isCurrent
							? 'fill-blue-700 dark:fill-blue-400'
							: 'fill-gray-500 dark:fill-gray-400'}
					>
						{truncate(svc.name, 17)}
					</text>

					<!-- Separator after label -->
					<line
						x1={LABEL_W - 4}
						y1={PAD_T + i * ROW_H}
						x2={LABEL_W - 4}
						y2={PAD_T + (i + 1) * ROW_H}
						stroke-width={1}
						class="stroke-gray-200 dark:stroke-gray-700"
					/>

					<!-- Horizontal swim-lane track -->
					<line
						x1={LABEL_W}
						y1={cy}
						x2={containerWidth - PAD_R}
						y2={cy}
						stroke-width={svc.isCurrent ? 1.5 : 1}
						class={svc.isCurrent
							? 'stroke-blue-300 dark:stroke-blue-700'
							: 'stroke-gray-200 dark:stroke-gray-700'}
					/>

					<!-- Deployment dots -->
					{#each entries as { e, i: origIdx }}
						{@const x = tsToX(e.timestamp)}
						{@const isHov = hovId === svc.id && hovIdx === origIdx}
						{@const isSel =
							selectedEntry?.serviceId === svc.id && selectedEntry?.index === origIdx}
						{@const active = isHov || isSel}
						{@const r = active ? R_ACTIVE : R_NORMAL}
						{@const col = statusColor(e.bakeStatus)}

						<!-- Glow ring for active -->
						{#if active}
							<circle cx={x} cy={cy} r={r + 5} fill={statusGlow(e.bakeStatus)} />
						{/if}

						<circle
							cx={x}
							cy={cy}
							{r}
							fill={col}
							stroke={active ? 'white' : 'rgba(255,255,255,0.6)'}
							stroke-width={active ? 2 : 1}
							class="cursor-pointer"
							role="button"
							aria-label="Deployment {e.version.version || e.version.tag}"
							tabindex={0}
							onmouseenter={() => {
								if (brushStartX !== null) return;
								hovId = svc.id;
								hovIdx = origIdx;
								hovDotX = x;
								hovDotY = cy;
							}}
							onmouseleave={() => {
								hovId = null;
								hovIdx = null;
							}}
							onclick={() => onEntryClick?.(svc.id, origIdx)}
							onkeydown={(ev) => ev.key === 'Enter' && onEntryClick?.(svc.id, origIdx)}
						/>
					{/each}

					<!-- Empty period label -->
					{#if entries.length === 0 && svc.isCurrent}
						<text
							x={LABEL_W + plotW / 2}
							y={cy + 4}
							text-anchor="middle"
							font-size="11"
							class="fill-gray-400 dark:fill-gray-600"
						>
							No deployments in this period
						</text>
					{/if}
				{/each}

				<!-- X-axis baseline -->
				<line
					x1={LABEL_W}
					y1={PAD_T + services.length * ROW_H}
					x2={containerWidth - PAD_R}
					y2={PAD_T + services.length * ROW_H}
					stroke-width={1}
					class="stroke-gray-300 dark:stroke-gray-600"
				/>

				<!-- X-axis ticks + labels -->
				{#each ticks as tick}
					<line
						x1={tick.x}
						y1={PAD_T + services.length * ROW_H}
						x2={tick.x}
						y2={PAD_T + services.length * ROW_H + 5}
						stroke-width={1}
						class="stroke-gray-400 dark:stroke-gray-500"
					/>
					<text
						x={tick.x}
						y={PAD_T + services.length * ROW_H + 18}
						text-anchor="middle"
						font-size="10"
						font-family="ui-sans-serif, system-ui, sans-serif"
						class="fill-gray-400 dark:fill-gray-500"
					>
						{tick.label}
					</text>
				{/each}

				<!-- "Now" marker -->
				<line
					x1={containerWidth - PAD_R}
					y1={PAD_T}
					x2={containerWidth - PAD_R}
					y2={PAD_T + services.length * ROW_H}
					stroke-width={1.5}
					stroke-dasharray="4 2"
					class="stroke-blue-400 dark:stroke-blue-600"
				/>
				<text
					x={containerWidth - PAD_R - 4}
					y={PAD_T + 10}
					text-anchor="end"
					font-size="9"
					class="fill-blue-400 dark:fill-blue-600"
				>
					now
				</text>

				<!-- Brush overlay (drag-to-zoom) -->
				{#if brushStartX !== null && brushEndX !== null}
					<rect
						x={Math.min(brushStartX, brushEndX)}
						y={PAD_T}
						width={Math.abs(brushEndX - brushStartX)}
						height={services.length * ROW_H}
						class="fill-blue-500/15 stroke-blue-500"
						stroke-width="1"
						stroke-dasharray="3 3"
						pointer-events="none"
					/>
				{/if}
			</svg>
		{/if}
	</div>

	<!-- Tooltip (outside chart wrapper to avoid overflow clipping) -->
	{#if tooltipEntry}
		{@const { entry, svcName } = tooltipEntry}
		<div
			class="pointer-events-none absolute z-50 rounded-lg border border-gray-200 bg-white/95 p-3 shadow-xl backdrop-blur-sm dark:border-gray-700 dark:bg-gray-800/95"
			style="left: {tipLeft}px; top: {tipTop}px; width: {TOOLTIP_W}px; transform: {tipAboveDot
				? 'translateY(-100%)'
				: 'translateY(0)'};"
		>
			<div class="mb-1.5 flex items-center gap-2">
				<span
					class="h-2.5 w-2.5 flex-shrink-0 rounded-full"
					style="background: {statusColor(entry.bakeStatus)}"
				></span>
				<span class="font-mono text-xs font-semibold text-gray-900 dark:text-white">
					{entry.version.version || entry.version.revision?.slice(0, 12) || entry.version.tag}
				</span>
			</div>
			<div class="text-xs text-gray-500 dark:text-gray-400">{fmtTooltipDate(entry.timestamp)}</div>
			{#if svcName}
				<div class="mt-1 text-xs text-gray-400 dark:text-gray-500">{svcName}</div>
			{/if}
			<div class="mt-1 text-xs font-medium" style="color: {statusColor(entry.bakeStatus)}">
				{entry.bakeStatus || 'Unknown'}
			</div>
			{#if entry.triggeredBy}
				<div class="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
					{entry.triggeredBy.kind === 'User' ? entry.triggeredBy.name : 'System'}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Legend -->
	<div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
		{#each [['Succeeded', '#22c55e'], ['Failed', '#ef4444'], ['InProgress', '#f59e0b'], ['Deploying', '#3b82f6'], ['Other', '#6b7280']] as [label, color]}
			<div class="flex items-center gap-1.5">
				<span class="h-2 w-2 rounded-full" style="background: {color}"></span>
				<span class="text-xs text-gray-500 dark:text-gray-400">{label}</span>
			</div>
		{/each}
	</div>
</div>
