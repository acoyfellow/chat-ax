<script lang="ts">
  import AgentAvatar from './AgentAvatar.svelte';

  let { time = 0, duration = 8 } = $props<{ time?: number; duration?: number }>();

  type FleetAgent = { seed: string; x: number; y: number; parent: number | null; appearAt: number; size: number };

  const center = { x: 540, y: 440 };
  const fleet: FleetAgent[] = [
    { seed: 'chat-ax-lead', x: center.x, y: center.y, parent: null, appearAt: 0.15, size: 200 },
    { seed: 'helper-research', x: 260, y: 300, parent: 0, appearAt: 1.7, size: 120 },
    { seed: 'helper-review', x: 820, y: 300, parent: 0, appearAt: 1.95, size: 120 },
    { seed: 'helper-deploy', x: 250, y: 640, parent: 0, appearAt: 2.2, size: 120 },
    { seed: 'helper-notes', x: 830, y: 640, parent: 0, appearAt: 2.45, size: 120 },
    { seed: 'sub-crawler', x: 105, y: 470, parent: 1, appearAt: 2.9, size: 92 },
    { seed: 'sub-tester', x: 975, y: 470, parent: 2, appearAt: 3.1, size: 92 },
    { seed: 'sub-scheduler', x: 110, y: 790, parent: 3, appearAt: 3.3, size: 92 },
  ];
  const messages = [
    { from: 1, to: 0, at: 3.7 },
    { from: 0, to: 2, at: 4.1 },
    { from: 2, to: 6, at: 4.4 },
    { from: 3, to: 7, at: 4.7 },
    { from: 4, to: 0, at: 5.0 },
  ];
  const people = [
    { name: 'Sam', color: '#78b7ff', from: { x: 1180, y: 160 }, to: { x: 655, y: 345 }, at: 3.6 },
    { name: 'Priya', color: '#f7a8ff', from: { x: -120, y: 1000 }, to: { x: 395, y: 545 }, at: 3.9 },
  ];
  const reply = 'On it. Research is reading the docs and Review is checking the diff.';

  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const easeOutBack = (value: number) => {
    const c = 1.70158;
    const x = clamp(value) - 1;
    return 1 + (c + 1) * x * x * x + c * x * x;
  };
  const easeInOut = (value: number) => {
    const x = clamp(value);
    return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
  };
  const progress = (start: number, length: number) => clamp((time - start) / length);

  const outro = $derived(easeInOut(progress(duration - 0.6, 0.6)));
  const visible = (appearAt: number) => easeOutBack(progress(appearAt, 0.55)) * (1 - outro);
  const agentScale = (agent: FleetAgent) => visible(agent.appearAt);
  const lineDraw = (agent: FleetAgent) => easeInOut(progress(agent.appearAt - 0.1, 0.5)) * (1 - outro);

  function curve(from: FleetAgent, to: FleetAgent): string {
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2 - 40;
    return `M${from.x} ${from.y}Q${midX} ${midY} ${to.x} ${to.y}`;
  }

  function pointOnCurve(from: FleetAgent, to: FleetAgent, t: number) {
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2 - 40;
    const inverse = 1 - t;
    return {
      x: inverse * inverse * from.x + 2 * inverse * t * midX + t * t * to.x,
      y: inverse * inverse * from.y + 2 * inverse * t * midY + t * t * to.y,
    };
  }

  const leadMood = $derived(time > 5.5 && time < duration - 0.8 ? 'speaking' : time > 3.6 && time <= 5.5 ? 'thinking' : 'idle');
  const typed = $derived(reply.slice(0, Math.floor(clamp((time - 5.6) / 1.4) * reply.length)));
  const bubble = $derived(easeOutBack(progress(5.5, 0.4)) * (1 - outro));
  const wordmark = $derived(easeInOut(progress(0.5, 0.7)) * (1 - outro));
  const tagline = $derived(easeInOut(progress(1.0, 0.7)) * (1 - outro));
</script>

<div class="stage" style:--t={time}>
  <svg class="lines" viewBox="0 0 1080 1080" aria-hidden="true">
    <defs>
      <radialGradient id="glow" cx="50%" cy="44%" r="55%">
        <stop offset="0%" stop-color="#1d2a3d" />
        <stop offset="100%" stop-color="#0a0a0a" />
      </radialGradient>
    </defs>
    <rect width="1080" height="1080" fill="url(#glow)" />
    {#each Array.from({ length: 12 }, (_, index) => index) as row}
      {#each Array.from({ length: 12 }, (_, index) => index) as column}
        <circle cx={45 + column * 90} cy={45 + row * 90} r="1.6" fill="#ffffff" opacity={0.08 + 0.05 * Math.sin(time * 1.5 + row * 0.6 + column * 0.4)} />
      {/each}
    {/each}
    {#each fleet as agent}
      {#if agent.parent !== null}
        {@const parent = fleet[agent.parent]}
        <path d={curve(parent, agent)} pathLength="1" stroke="#3a3a3a" stroke-width="3" fill="none" stroke-dasharray="1" stroke-dashoffset={1 - lineDraw(agent)} stroke-linecap="round" />
      {/if}
    {/each}
    {#each messages as message}
      {@const flight = progress(message.at, 0.7)}
      {#if flight > 0 && flight < 1 && outro === 0}
        {@const point = pointOnCurve(fleet[message.from], fleet[message.to], easeInOut(flight))}
        <circle cx={point.x} cy={point.y} r="16" fill="#78b7ff" opacity="0.18" />
        <circle cx={point.x} cy={point.y} r="7" fill="#78b7ff" />
      {/if}
    {/each}
  </svg>

  {#each fleet as agent, index}
    {@const scale = agentScale(agent)}
    {#if scale > 0.01}
      <div class="agent" style:left={`${agent.x}px`} style:top={`${agent.y}px`} style:transform={`translate(-50%, -50%) scale(${scale})`}>
        <AgentAvatar hash={agent.seed} size={agent.size} mood={index === 0 ? leadMood : 'idle'} />
      </div>
    {/if}
  {/each}

  {#if bubble > 0.01}
    <div class="bubble" style:transform={`translate(-50%, 0) scale(${bubble})`}>
      <span>{typed}</span><i class:hidden={typed.length === reply.length}></i>
    </div>
  {/if}

  {#each people as person}
    {@const move = easeInOut(progress(person.at, 1.1))}
    {#if move > 0 && outro < 1}
      <div class="cursor" style:left={`${person.from.x + (person.to.x - person.from.x) * move}px`} style:top={`${person.from.y + (person.to.y - person.from.y) * move}px`} style:opacity={1 - outro}>
        <svg width="34" height="34" viewBox="0 0 24 24"><path d="M4 2l16 9-7 2-3 7z" fill={person.color} stroke="#0a0a0a" stroke-width="1.4" stroke-linejoin="round" /></svg>
        <b style:background={person.color}>{person.name}</b>
      </div>
    {/if}
  {/each}

  <header style:opacity={wordmark} style:transform={`translateY(${(1 - wordmark) * 24}px)`}>
    <h1>Chat AX</h1>
  </header>
  <footer style:opacity={tagline} style:transform={`translateY(${(1 - tagline) * 24}px)`}>
    <p>Your team and a fleet of agents, in one room.</p>
    <small>Durable · multiplayer · on your Cloudflare account</small>
  </footer>
</div>

<style>
  :global(html, body) { margin: 0; background: #0a0a0a; }
  .stage { position: relative; width: 1080px; height: 1080px; overflow: hidden; background: #0a0a0a; color: #f5f5f5; font-family: "Geist", ui-sans-serif, system-ui, sans-serif; }
  .lines { position: absolute; inset: 0; width: 100%; height: 100%; }
  .agent { position: absolute; filter: drop-shadow(0 18px 30px rgba(0, 0, 0, 0.55)); }
  .agent :global(svg) { border-radius: 28%; }
  .bubble { position: absolute; left: 540px; top: 760px; width: 600px; box-sizing: border-box; text-align: left; padding: 20px 26px; border-radius: 22px; background: #1b1b1b; border: 1.5px solid #333; font-size: 28px; line-height: 1.35; transform-origin: 50% 0; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5); }
  .bubble i { display: inline-block; width: 12px; height: 28px; margin-left: 4px; vertical-align: -4px; background: #78b7ff; border-radius: 2px; }
  .bubble i.hidden { visibility: hidden; }
  .cursor { position: absolute; display: flex; align-items: flex-start; gap: 4px; }
  .cursor b { margin-top: 24px; padding: 6px 12px; border-radius: 999px; color: #0a0a0a; font-size: 22px; font-weight: 600; }
  header { position: absolute; top: 64px; left: 0; right: 0; text-align: center; }
  h1 { margin: 0; font-size: 84px; font-weight: 600; letter-spacing: -0.04em; }
  footer { position: absolute; bottom: 56px; left: 0; right: 0; text-align: center; }
  footer p { margin: 0; font-size: 38px; font-weight: 500; letter-spacing: -0.02em; }
  footer small { display: block; margin-top: 14px; font-family: "Geist Mono", ui-monospace, monospace; font-size: 22px; color: #a0a0a0; }
</style>
