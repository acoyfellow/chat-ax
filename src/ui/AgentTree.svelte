<script lang="ts">
  import { ArrowRight, ChevronDown, ChevronUp, ExternalLink, Maximize2, Minus, Move, Plus, X } from '@lucide/svelte';
  import { coalescedTask, openLiveConnection } from './live-connection';
  import { onMount } from 'svelte';
  import type { FleetOperationsAgent, FleetOperationsEvent } from '../fleet-operations';
  import { createFleetLayout } from '../fleet-operations';
  import AgentAvatar from './AgentAvatar.svelte';

  type AgentInput = Omit<FleetOperationsAgent, 'context'> & { context?: FleetOperationsAgent['context'] };
  let { nodes = [], activeId = '', onOpenConversation = () => {}, onClose = () => {} }: {
    nodes?: AgentInput[];
    activeId?: string;
    onOpenConversation?: (id: string) => void;
    onClose?: () => void;
  } = $props();
  let agents = $state<FleetOperationsAgent[]>([]);
  let events = $state<FleetOperationsEvent[]>([]);
  let selectedId = $state('');
  let panel: HTMLElement;
  let previousFocus: HTMLElement | null = null;
  const width = 1000;
  const height = 680;
  let zoom = $state(1);
  let panX = $state(0);
  let panY = $state(0);
  type Point = { x: number; y: number };
  type Gesture =
    | { kind: 'idle' }
    | { kind: 'press'; pointerId: number; id: string; client: Point; grab: Point; origin: Point }
    | { kind: 'node'; pointerId: number; id: string; grab: Point; origin: Point }
    | { kind: 'pan'; pointerId: number; start: Point; panX: number; panY: number }
    | { kind: 'pinch' };
  const dragThreshold = 5;
  const keyboardStep = 24;
  let gesture = $state<Gesture>({ kind: 'idle' });
  let dragging = $derived(gesture.kind === 'node' || gesture.kind === 'pan' || gesture.kind === 'pinch');
  let draggedId = $derived(gesture.kind === 'node' ? gesture.id : null);
  let suppressNextClick = false;
  let lastTap: { id: string; at: number } | null = null;
  const doubleTapMs = 400;
  const unsavedPositions = new Map<string, Point>();
  let layoutPositions = $state<Record<string, { x: number; y: number }>>({});
  let inspectorExpanded = $state(true);
  let mapReady = $state(false);
  let mapElement: HTMLElement;
  let svgElement: SVGSVGElement;
  const pointers = new Map<number, Point>();
  let pinchOrigin: { distance: number; zoom: number; anchorX: number; anchorY: number } | null = null;
  let points = $derived(createFleetLayout(agents, width, height).map((point) => ({
    ...point,
    ...(layoutPositions[point.id] ?? {}),
  })));
  let paintedPoints = $derived(draggedId ? [...points.filter((point) => point.id !== draggedId), ...points.filter((point) => point.id === draggedId)] : points);
  let selected = $derived(agents.find((agent) => agent.id === selectedId));
  let pointById = $derived(new Map(points.map((point) => [point.id, point])));
  let now = $state(Date.now());
  let terminalEvents = $derived(events.filter((event) => event.type !== 'communication.sent'));
  let recentEvents = $derived(terminalEvents.filter((event) =>
    now - Date.parse(event.occurredAt) < 30_000 &&
    (event.fromAgentId === selectedId || event.toAgentId === selectedId)
  ));

  function select(id: string) {
    selectedId = id;
    document.getElementById(`fleet-node-${CSS.escape(id)}`)?.focus();
  }

  function moveSelection(direction: number) {
    const index = Math.max(0, agents.findIndex((agent) => agent.id === selectedId));
    select(agents[(index + direction + agents.length) % agents.length]?.id ?? '');
  }

  function handleNodeKeydown(event: KeyboardEvent, id: string) {
    const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (event.shiftKey && nudge) {
      event.preventDefault();
      event.stopPropagation();
      const current = pointById.get(id);
      if (!current) return;
      setPosition(id, { x: current.x + nudge[0] * keyboardStep, y: current.y + nudge[1] * keyboardStep });
      void saveLayout(id);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      onOpenConversation(id);
      return;
    }
    if (event.key === ' ') {
      event.preventDefault();
      select(id);
      return;
    }
    event.stopPropagation();
    handleKeydown(event);
  }

  function mapPoint(clientX: number, clientY: number): Point {
    const matrix = svgElement.getScreenCTM();
    if (!matrix) return { x: width / 2, y: height / 2 };
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  }

  function graphPoint(clientX: number, clientY: number): Point {
    const view = mapPoint(clientX, clientY);
    return { x: (view.x - panX) / zoom, y: (view.y - panY) / zoom };
  }

  function clampToCanvas(point: Point): Point {
    return {
      x: Math.max(-width, Math.min(width * 2, point.x)),
      y: Math.max(-height, Math.min(height * 2, point.y)),
    };
  }

  function setPosition(id: string, point: Point) {
    layoutPositions = { ...layoutPositions, [id]: clampToCanvas(point) };
  }

  async function saveLayout(id: string) {
    const position = layoutPositions[id];
    if (!position) return;
    unsavedPositions.set(id, position);
    const response = await fetch('/api/fleet/layout', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ positions: { [id]: position } }),
    }).catch(() => null);
    if (response?.ok && unsavedPositions.get(id) === position) unsavedPositions.delete(id);
  }

  function setZoom(value: number, anchor = { x: width / 2, y: height / 2 }) {
    const nextZoom = Math.max(0.55, Math.min(2.5, value));
    const graphX = (anchor.x - panX) / zoom;
    const graphY = (anchor.y - panY) / zoom;
    panX = anchor.x - graphX * nextZoom;
    panY = anchor.y - graphY * nextZoom;
    zoom = nextZoom;
  }

  function resetView() {
    zoom = 1;
    panX = 0;
    panY = 0;
  }

  function startPinch() {
    const [first, second] = [...pointers.values()];
    const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    pinchOrigin = {
      distance: Math.hypot(second.x - first.x, second.y - first.y),
      zoom,
      anchorX: (midpoint.x - panX) / zoom,
      anchorY: (midpoint.y - panY) / zoom,
    };
    gesture = { kind: 'pinch' };
  }

  function startGesture(event: PointerEvent) {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    suppressNextClick = false;
    if ((event.target as Element).closest('.map-tools, .map-hint')) return;
    pointers.set(event.pointerId, mapPoint(event.clientX, event.clientY));
    try {
      mapElement.setPointerCapture(event.pointerId);
    } catch {}
    if (pointers.size >= 2) {
      if (gesture.kind === 'node') setPosition(gesture.id, gesture.origin);
      startPinch();
      return;
    }
    const node = (event.target as Element).closest<SVGGElement>('.node');
    const id = node?.dataset.agentId;
    const position = id ? pointById.get(id) : undefined;
    if (id && position) {
      const pointer = graphPoint(event.clientX, event.clientY);
      gesture = {
        kind: 'press',
        pointerId: event.pointerId,
        id,
        client: { x: event.clientX, y: event.clientY },
        grab: { x: position.x - pointer.x, y: position.y - pointer.y },
        origin: { x: position.x, y: position.y },
      };
      return;
    }
    gesture = { kind: 'pan', pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, panX, panY };
  }

  function moveGesture(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, mapPoint(event.clientX, event.clientY));
    if (gesture.kind === 'pinch' && pinchOrigin && pointers.size >= 2) {
      const [first, second] = [...pointers.values()];
      const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      const nextZoom = Math.max(0.55, Math.min(2.5, pinchOrigin.zoom * distance / Math.max(1, pinchOrigin.distance)));
      panX = midpoint.x - pinchOrigin.anchorX * nextZoom;
      panY = midpoint.y - pinchOrigin.anchorY * nextZoom;
      zoom = nextZoom;
      return;
    }
    if (gesture.kind === 'press' && gesture.pointerId === event.pointerId) {
      if (Math.hypot(event.clientX - gesture.client.x, event.clientY - gesture.client.y) < dragThreshold) return;
      gesture = { kind: 'node', pointerId: gesture.pointerId, id: gesture.id, grab: gesture.grab, origin: gesture.origin };
    }
    if (gesture.kind === 'node' && gesture.pointerId === event.pointerId) {
      const pointer = graphPoint(event.clientX, event.clientY);
      setPosition(gesture.id, { x: pointer.x + gesture.grab.x, y: pointer.y + gesture.grab.y });
      return;
    }
    if (gesture.kind === 'pan' && gesture.pointerId === event.pointerId) {
      const start = mapPoint(gesture.start.x, gesture.start.y);
      const current = mapPoint(event.clientX, event.clientY);
      panX = gesture.panX + current.x - start.x;
      panY = gesture.panY + current.y - start.y;
    }
  }

  function finishGesture(pointerId: number, commit: boolean) {
    if (!pointers.has(pointerId)) return;
    pointers.delete(pointerId);
    if (mapElement.hasPointerCapture(pointerId)) mapElement.releasePointerCapture(pointerId);
    if (gesture.kind === 'press' && gesture.pointerId === pointerId && commit) {
      suppressNextClick = true;
      const tappedId = gesture.id;
      const now = Date.now();
      if (lastTap?.id === tappedId && now - lastTap.at < doubleTapMs) {
        lastTap = null;
        gesture = { kind: 'idle' };
        onOpenConversation(tappedId);
        return;
      }
      lastTap = { id: tappedId, at: now };
      select(tappedId);
    }
    if (gesture.kind === 'node' && gesture.pointerId === pointerId) {
      suppressNextClick = true;
      if (commit) void saveLayout(gesture.id);
      else setPosition(gesture.id, gesture.origin);
    }
    if (gesture.kind === 'pinch' && pointers.size > 0) {
      suppressNextClick = true;
      const [remainingId, remaining] = [...pointers.entries()][0];
      const client = new DOMPoint(remaining.x, remaining.y).matrixTransform(svgElement.getScreenCTM() ?? new DOMMatrix());
      gesture = { kind: 'pan', pointerId: remainingId, start: { x: client.x, y: client.y }, panX, panY };
      pinchOrigin = null;
      return;
    }
    if (pointers.size === 0) {
      gesture = { kind: 'idle' };
      pinchOrigin = null;
    }
  }

  function endGesture(event: PointerEvent) {
    finishGesture(event.pointerId, true);
  }

  function cancelGesture(event: PointerEvent) {
    finishGesture(event.pointerId, false);
  }

  function cancelActiveDrag(): boolean {
    if (gesture.kind !== 'node' && gesture.kind !== 'press') return false;
    if (gesture.kind === 'node') setPosition(gesture.id, gesture.origin);
    const pointerId = gesture.pointerId;
    pointers.delete(pointerId);
    if (mapElement.hasPointerCapture(pointerId)) mapElement.releasePointerCapture(pointerId);
    suppressNextClick = true;
    gesture = { kind: 'idle' };
    return true;
  }

  function wheelMap(event: WheelEvent) {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) setZoom(zoom * Math.exp(-event.deltaY * 0.008), mapPoint(event.clientX, event.clientY));
    else {
      const start = mapPoint(0, 0);
      const end = mapPoint(event.deltaX, event.deltaY);
      panX -= end.x - start.x;
      panY -= end.y - start.y;
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (cancelActiveDrag()) return;
      onClose();
      return;
    }
    const target = event.target as HTMLElement;
    if (target.classList.contains('node') && (event.key === 'ArrowRight' || event.key === 'ArrowDown')) {
      event.preventDefault();
      moveSelection(1);
    }
    if (target.classList.contains('node') && (event.key === 'ArrowLeft' || event.key === 'ArrowUp')) {
      event.preventDefault();
      moveSelection(-1);
    }
    if (event.key === 'Tab') {
      const focusable = [...panel.querySelectorAll<HTMLElement>('button,[href],[tabindex]:not([tabindex="-1"])')].filter((item) => {
        if (item.hasAttribute('disabled')) return false;
        const style = getComputedStyle(item);
        return style.display !== 'none' && style.visibility !== 'hidden' && item.getClientRects().length > 0;
      });
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel)) {
        event.preventDefault();
        first?.focus();
      }
    }
  }

  function edgePath(event: FleetOperationsEvent) {
    const source = pointById.get(event.fromAgentId);
    const target = pointById.get(event.toAgentId);
    return source && target ? `M${source.x},${source.y} L${target.x},${target.y}` : '';
  }

  function agentName(id: string) {
    return agents.find((agent) => agent.id === id)?.title ?? 'Agent';
  }

  function activityVerb(event: FleetOperationsEvent) {
    if (event.type === 'communication.failed') return 'could not send';
    if (event.action === 'job-summary') return 'shared a job update with';
    if (event.action === 'file') return 'shared a file with';
    return 'sent a message to';
  }

  function relativeTime(occurredAt: string) {
    const seconds = Math.max(0, Math.round((now - Date.parse(occurredAt)) / 1_000));
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.round(seconds / 60);
    return `${minutes}m ago`;
  }

  async function refresh() {
    const [response, layoutResponse] = await Promise.all([
      fetch('/api/fleet/operations'),
      fetch('/api/fleet/layout'),
    ]);
    if (!response.ok) return;
    const result = await response.json() as { agents: FleetOperationsAgent[]; events: FleetOperationsEvent[] };
    const layout = layoutResponse.ok ? await layoutResponse.json() as { positions?: Record<string, Point> } : {};
    const held = draggedId ? { [draggedId]: layoutPositions[draggedId] } : {};
    layoutPositions = { ...layoutPositions, ...(layout.positions ?? {}), ...Object.fromEntries(unsavedPositions), ...held };
    agents = result.agents;
    events = result.events;
    if (!agents.some((agent) => agent.id === selectedId)) selectedId = agents[0]?.id ?? '';
    mapReady = true;
  }

  onMount(() => {
    previousFocus = document.activeElement as HTMLElement | null;
    selectedId = activeId || nodes[0]?.id || '';
    agents = nodes.map((node) => ({ ...node, context: node.context ?? { used: 0, capacity: 0, ratio: 0 } }));
    panel.focus();
    void refresh().catch(() => {
      mapReady = true;
    });
    const scheduleRefresh = coalescedTask(refresh);
    const fleetEvents = openLiveConnection({
      path: () => '/api/fleet/events?after=latest',
      onOpen: scheduleRefresh,
      onMessage: (message) => {
        if (message.type === 'fleet') scheduleRefresh();
      },
    });
    const desktopQuery = window.matchMedia('(min-width: 721px)');
    const revealDesktopInspector = () => {
      if (desktopQuery.matches) inspectorExpanded = true;
    };
    desktopQuery.addEventListener('change', revealDesktopInspector);
    const cancelDragOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !cancelActiveDrag()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener('keydown', cancelDragOnEscape, true);
    const timer = window.setInterval(() => now = Date.now(), 1_000);
    return () => {
      fleetEvents.close();
      window.removeEventListener('keydown', cancelDragOnEscape, true);
      pointers.clear();
      desktopQuery.removeEventListener('change', revealDesktopInspector);
      window.clearInterval(timer);
      previousFocus?.focus();
    };
  });
</script>

<div class="backdrop">
  <div bind:this={panel} class="operations" role="dialog" aria-modal="true" aria-labelledby="fleet-title" tabindex="-1" onkeydown={handleKeydown}>
    <header>
      <div><h2 id="fleet-title">Fleet map</h2><p>{agents.length} agents</p></div>
      <button class="icon" type="button" aria-label="Close fleet map" onclick={onClose}><X size={20} /></button>
    </header>
    <div class="workspace" class:map-ready={mapReady}>
      <div bind:this={mapElement} class="map" class:dragging role="application" aria-label="Fleet canvas" aria-describedby="fleet-map-instructions" onpointerdown={startGesture} onpointermove={moveGesture} onpointerup={endGesture} onpointercancel={cancelGesture} onlostpointercapture={cancelGesture} onwheel={wheelMap} ondragstart={(event) => event.preventDefault()}>
        <p id="fleet-map-instructions" class="sr-only">Drag an agent to move it, or drag empty space to pan. Press Escape while dragging to put the agent back. Shift plus arrow keys moves the selected agent. Pinch or use the zoom buttons to zoom. Use the fit button to reset the fleet. Tab to an agent, use arrow keys to change selection, press Space to inspect it, or press Enter to open its conversation.</p>
        <svg bind:this={svgElement} viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Agents in the fleet">
          <defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" /></marker></defs>
          <g transform={`translate(${panX} ${panY}) scale(${zoom})`}>
            {#each points.filter((point) => point.parentId) as point}
              {@const parent = pointById.get(point.parentId ?? '')}
              {#if parent}<line class="hierarchy" data-parent-id={point.parentId} data-agent-id={point.id} x1={parent.x} y1={parent.y} x2={point.x} y2={point.y} />{/if}
            {/each}
            {#each recentEvents as event (event.id)}
              <path class="communication" class:failed={event.type === 'communication.failed'} data-from-agent-id={event.fromAgentId} data-to-agent-id={event.toAgentId} data-action={event.action} data-result={event.type} d={edgePath(event)} marker-end="url(#arrow)" />
            {/each}
            {#each paintedPoints as point (point.id)}
              <g id={`fleet-node-${point.id}`} data-agent-id={point.id} class="node" class:selected={point.id === selectedId} class:lifted={point.id === draggedId} transform={`translate(${point.x},${point.y})`} role="button" tabindex={point.id === selectedId ? 0 : -1} aria-label={`${point.title}, ${point.status}, context ${Math.round(point.context.ratio * 100)} percent`} onclick={() => { if (suppressNextClick) { suppressNextClick = false; return; } select(point.id); }} onkeydown={(event) => handleNodeKeydown(event, point.id)}>
                {#if point.id === selectedId}<circle class="selection" r="36" />{/if}
                <foreignObject x="-32" y="-32" width="64" height="64"><AgentAvatar hash={point.avatarSeed} size={64} options={{ scale: 1.2 }} /></foreignObject>
              </g>
            {/each}
          </g>
        </svg>
        <div class="map-tools" aria-label="Map controls">
          <button type="button" aria-label="Zoom in" onclick={() => setZoom(zoom * 1.2)}><Plus size={20} /></button>
          <button type="button" aria-label="Zoom out" onclick={() => setZoom(zoom / 1.2)}><Minus size={20} /></button>
          <button type="button" aria-label="Fit fleet to view" onclick={resetView}><Maximize2 size={19} /></button>
        </div>
        <div class="map-hint"><Move size={15} /><span role="status" aria-live="polite">Zoom {Math.round(zoom * 100)}%</span></div>
      </div>
      <aside aria-label="Fleet inspector" class:collapsed={!inspectorExpanded}>
        <button class="inspector-toggle" type="button" aria-expanded={inspectorExpanded} aria-controls="fleet-inspector-content" onclick={() => inspectorExpanded = !inspectorExpanded}>
          <span>{inspectorExpanded ? 'Hide details' : 'Show details'}</span>
          {#if inspectorExpanded}<ChevronDown size={20} />{:else}<ChevronUp size={20} />{/if}
        </button>
        <div id="fleet-inspector-content" inert={!inspectorExpanded} aria-hidden={!inspectorExpanded}>
        {#if selected}
          <div class="identity"><AgentAvatar hash={selected.avatarSeed} size={48} /><div><h3>{selected.title}</h3><p>{selected.status}</p></div></div>
          <div class="meter"><span>Context</span><strong>{Math.round(selected.context.ratio * 100)}%</strong><progress max="1" value={selected.context.ratio}> {Math.round(selected.context.ratio * 100)}% </progress></div>
          <button class="open" type="button" onclick={() => onOpenConversation(selected.id)}>Open conversation <ExternalLink size={15} /></button>
        {:else}<p>Select an agent to inspect it.</p>{/if}
        <section class="activity"><div class="activity-heading"><div><h3>Recent handoffs</h3><p>Delivered and failed communication between agents</p></div><span>{terminalEvents.length}</span></div><ol>
          {#each terminalEvents.slice(0, 12) as event}
            <li class:failed={event.type === 'communication.failed'}>
              <div class="route"><AgentAvatar hash={agents.find((agent) => agent.id === event.fromAgentId)?.avatarSeed} size={28} /><ArrowRight size={13} /><AgentAvatar hash={agents.find((agent) => agent.id === event.toAgentId)?.avatarSeed} size={28} /></div>
              <p><strong>{agentName(event.fromAgentId)}</strong> {activityVerb(event)} <strong>{agentName(event.toAgentId)}</strong>.</p>
              <small>{event.type === 'communication.failed' ? 'Failed' : 'Delivered'} · {relativeTime(event.occurredAt)}</small>
            </li>
          {:else}<li class="empty">Handoffs will appear here as agents communicate.</li>{/each}
        </ol></section>
        </div>
      </aside>
    </div>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 30; background: rgb(0 0 0 / 48%); }
  .operations { width: 100%; height: 100%; outline: 0; background: var(--surface, #fff); color: var(--text, #171717); }
  header { height: 72px; display: flex; align-items: center; justify-content: space-between; padding: 0 24px; border-bottom: 1px solid var(--border, #ddd); }
  h2, h3, p { margin: 0; } header h2 { font-size: 18px; } header p, aside p, small { color: var(--text-secondary, #666); font-size: 12px; }
  button { font: inherit; } .icon { display: grid; width: 44px; height: 44px; place-items: center; border: 1px solid var(--border, #ddd); border-radius: 12px; background: var(--surface-secondary, #f7f7f7); color: inherit; cursor: pointer; }
  .workspace { height: calc(100% - 72px); display: grid; grid-template-columns: minmax(0, 1fr) clamp(280px, 27vw, 360px); }
  .workspace:not(.map-ready) svg, .workspace:not(.map-ready) aside > :not(.inspector-toggle) { visibility: hidden; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
  .map { position: relative; min-width: 0; overflow: hidden; touch-action: none; cursor: grab; background-color: color-mix(in srgb, var(--surface-secondary, #f7f7f7) 80%, transparent); background-image: radial-gradient(circle, color-mix(in srgb, var(--text-secondary, #666) 22%, transparent) 1px, transparent 1px); background-size: 22px 22px; }
  .map.dragging { cursor: grabbing; } svg { width: 100%; height: 100%; user-select: none; } .hierarchy { stroke: color-mix(in srgb, var(--text-secondary, #666) 38%, transparent); stroke-width: 1.5; }
  .communication { fill: none; stroke: #3979e8; stroke-width: 3; stroke-dasharray: 8 6; animation: flow 1s linear infinite; } .communication.failed { stroke: var(--error, #b42318); }
  marker path { fill: #3979e8; } .node { cursor: grab; outline: none; } .map.dragging .node { cursor: grabbing; } .node.lifted { filter: drop-shadow(0 10px 14px rgb(0 0 0 / 35%)); } .node.lifted :global(foreignObject) { transform: scale(1.08); transform-origin: center; transform-box: fill-box; } .node :global(svg), .node :global(img) { pointer-events: none; -webkit-user-drag: none; } .selection { fill: none; stroke: #3979e8; stroke-width: 3; vector-effect: non-scaling-stroke; }
  .node:focus-visible .selection { stroke-width: 5; } .map-tools { position: absolute; left: 16px; bottom: 16px; display: grid; overflow: hidden; border: 1px solid var(--border, #ddd); border-radius: 12px; background: var(--surface, #fff); box-shadow: 0 8px 24px rgb(0 0 0 / 12%); }
  .map-tools button { display: grid; width: 46px; height: 46px; place-items: center; border: 0; border-bottom: 1px solid var(--border, #ddd); background: transparent; color: inherit; cursor: pointer; } .map-tools button:last-child { border-bottom: 0; } .map-tools button:hover { background: var(--surface-secondary, #f7f7f7); }
  .map-hint { position: absolute; right: 16px; bottom: 16px; display: flex; align-items: center; gap: 7px; padding: 8px 11px; border: 1px solid var(--border, #ddd); border-radius: 10px; background: color-mix(in srgb, var(--surface, #fff) 92%, transparent); color: var(--text-secondary, #666); font-size: 12px; pointer-events: none; }
  aside { min-width: 0; overflow: auto; padding: 24px; border-left: 1px solid var(--border, #ddd); background: var(--surface, #fff); } .inspector-toggle { display: none; } aside.collapsed #fleet-inspector-content { visibility: hidden; } .identity { display: flex; align-items: center; gap: 12px; } .identity h3 { font-size: 16px; }
  .meter { display: grid; grid-template-columns: 1fr auto; gap: 8px; margin-top: 24px; } progress { grid-column: 1 / -1; width: 100%; accent-color: #3979e8; }
  .open { width: 100%; min-height: 44px; display: flex; align-items: center; justify-content: center; gap: 7px; margin-top: 18px; padding: 10px; border: 0; border-radius: 10px; background: #2463cf; color: #fff; cursor: pointer; }
  .activity { margin-top: 30px; } .activity-heading { display: flex; align-items: start; justify-content: space-between; gap: 12px; } .activity-heading h3 { font-size: 14px; } .activity-heading > span { min-width: 26px; padding: 4px 7px; border-radius: 999px; background: var(--surface-secondary, #f2f2f2); text-align: center; font-size: 11px; }
  ol { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 8px; } .activity li { display: grid; grid-template-columns: auto 1fr; column-gap: 10px; padding: 11px; border: 1px solid var(--border, #ddd); border-radius: 11px; background: var(--surface-secondary, #fafafa); } .activity li.failed { border-color: color-mix(in srgb, var(--error, #b42318) 35%, var(--border, #ddd)); } .route { grid-row: 1 / 3; display: flex; align-items: center; gap: 2px; } .activity li p { align-self: end; color: inherit; line-height: 1.35; } .activity li small { align-self: start; margin-top: 3px; } .empty { display: block !important; color: var(--text-secondary, #666); font-size: 12px; }
  @keyframes flow { to { stroke-dashoffset: -14; } }
  @media (prefers-reduced-motion: reduce) { .communication { animation: none; stroke-dasharray: none; } aside { transition: none; } }
  @media (max-width: 720px) { header { height: 64px; padding: 0 14px; } header p { max-width: 240px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .workspace { height: calc(100% - 64px); display: grid; grid-template-columns: 1fr; grid-template-rows: minmax(0, 1fr) auto; overflow: hidden; } .map { min-height: 0; overflow: hidden; } aside { max-height: 44vh; padding: 8px 18px 18px; border: 0; border-top: 1px solid var(--border, #ddd); border-radius: 18px 18px 0 0; box-shadow: 0 -10px 30px rgb(0 0 0 / 10%); transition: max-height 160ms ease; } aside.collapsed { max-height: 58px; overflow: hidden; } .inspector-toggle { display: flex; width: 100%; min-height: 48px; align-items: center; justify-content: space-between; border: 0; background: transparent; color: inherit; font-weight: 650; } .map-tools { left: 10px; bottom: 10px; grid-auto-flow: column; } .map-tools button { width: 48px; height: 48px; border-bottom: 0; border-right: 1px solid var(--border, #ddd); } .map-tools button:last-child { border-right: 0; } .map-hint { right: 10px; bottom: 10px; } .activity { margin-top: 22px; } }
</style>
