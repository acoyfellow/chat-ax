<script lang="ts" module>
  export const showcaseDuration = 44;
</script>

<script lang="ts">
  import AgentAvatar from './AgentAvatar.svelte';
  import Chat from './Chat.svelte';
  import { approvalScene, viewers } from './showcase-script';

  let { time = 0 } = $props<{ time?: number }>();

  type Point = { x: number; y: number };
  type Mood = 'idle' | 'thinking' | 'speaking';
  type Caption = { start: number; end: number; text: string };

  const captions: Caption[] = [
    { start: 0.6, end: 3.8, text: 'Meet your agent.' },
    { start: 4.0, end: 8.4, text: 'Your whole team talks to the same one.' },
    { start: 8.6, end: 12.4, text: 'It has its own skills, files, memory and jobs.' },
    { start: 12.6, end: 16.4, text: 'It can change them itself.' },
    { start: 16.6, end: 20.6, text: 'Kill it mid-reply. The same reply finishes.' },
    { start: 20.8, end: 23.4, text: 'Sam asks to use Jordan’s GitLab.' },
    { start: 23.6, end: 25.6, text: 'Nothing runs. Jordan is asked.' },
    { start: 25.8, end: 28.4, text: 'Jordan approves. It runs once.' },
    { start: 29.0, end: 32.6, text: 'Every agent can have its own helpers.' },
    { start: 32.8, end: 36.4, text: 'They only talk to their parent and children.' },
    { start: 36.6, end: 40.0, text: 'Drive the whole fleet from your own agent.' },
  ];

  const people = [
    { name: 'Sam', color: '#78b7ff', from: { x: 120, y: 160 }, ask: 'Summarize the billing changes' },
    { name: 'Priya', color: '#f7a8ff', from: { x: 960, y: 200 }, ask: 'Typo in the email?' },
    { name: 'Jordan', color: '#9be38a', from: { x: 540, y: 980 }, ask: 'Draft the release notes' },
  ];
  const space = ['Skills', 'Files', 'Memory', 'Jobs', 'Tools'];
  const web = [
    { seed: 'chat-ax-lead', name: 'Lead', x: 540, y: 440, parent: null, at: 28.6, size: 150 },
    { seed: 'helper-research', name: 'Research', x: 260, y: 290, parent: 0, at: 29.2, size: 104 },
    { seed: 'helper-review', name: 'Review', x: 820, y: 290, parent: 0, at: 29.4, size: 104 },
    { seed: 'helper-deploy', name: 'Deploy', x: 260, y: 610, parent: 0, at: 29.6, size: 104 },
    { seed: 'helper-notes', name: 'Notes', x: 820, y: 610, parent: 0, at: 29.8, size: 104 },
    { seed: 'sub-tester', name: 'Tester', x: 980, y: 450, parent: 2, at: 30.8, size: 80 },
    { seed: 'sub-scout', name: 'Scout', x: 110, y: 450, parent: 1, at: 31.1, size: 80 },
  ];
  const handoffs = [
    { from: 1, to: 0, at: 33.0 },
    { from: 0, to: 2, at: 33.6 },
    { from: 2, to: 5, at: 34.2 },
  ];
  const sideways = { from: 3, to: 4, at: 34.9 };
  const pi = [
    { at: 37.0, text: '$ pi', kind: 'prompt' },
    { at: 37.4, text: '› tell Research to brief Review', kind: 'prompt' },
    { at: 38.0, text: '  chat-ax · send_agent_message', kind: '' },
    { at: 38.4, text: '  ✓ delivered · Review replied', kind: 'ok' },
    { at: 38.9, text: '› pause every job in the fleet', kind: 'prompt' },
    { at: 39.4, text: '  ✓ 3 jobs paused', kind: 'ok' },
  ];
  const reply = 'Checking incidents… 1 of 4 done. 2 of 4. 3 of 4. All 4 owners listed.';
  const cutAt = 38;

  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const ease = (value: number) => {
    const x = clamp(value);
    return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
  };
  const pop = (value: number) => {
    const c = 1.70158;
    const x = clamp(value) - 1;
    return 1 + (c + 1) * x * x * x + c * x * x;
  };
  const progress = (start: number, length: number) => clamp((time - start) / length);
  const during = (start: number, end: number, fade = 0.4) => ease(progress(start, fade)) * (1 - ease(progress(end - fade, fade)));
  const typed = (text: string, start: number, length: number) => text.slice(0, Math.floor(progress(start, length) * text.length));
  const mix = (from: Point, to: Point, amount: number): Point => ({ x: from.x + (to.x - from.x) * amount, y: from.y + (to.y - from.y) * amount });
  const curve = (from: Point, to: Point) => `M${from.x} ${from.y}Q${(from.x + to.x) / 2} ${(from.y + to.y) / 2 - 40} ${to.x} ${to.y}`;
  const onCurve = (from: Point, to: Point, t: number): Point => {
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - 40 };
    const u = 1 - t;
    return { x: u * u * from.x + 2 * u * t * mid.x + t * t * to.x, y: u * u * from.y + 2 * u * t * mid.y + t * t * to.y };
  };
  const replyText = (): string => {
    if (time < 18.6) return typed(reply, 17.0, 3.0);
    if (time < 19.6) return reply.slice(0, cutAt);
    return reply.slice(0, cutAt + Math.floor(progress(19.6, 0.9) * (reply.length - cutAt)));
  };
  const replyProgress = (): number => {
    if (time < 18.6) return progress(17.0, 3.0);
    if (time < 19.6) return cutAt / reply.length;
    return cutAt / reply.length + (1 - cutAt / reply.length) * progress(19.6, 0.9);
  };

  const caption = $derived(captions.find((item) => time >= item.start && time < item.end));
  const captionOpacity = $derived(caption ? during(caption.start, caption.end) : 0);
  const solo = $derived(time < 20.8);
  const agentScale = $derived(pop(progress(0.2, 1.0)) * (1 - 0.3 * ease(progress(8.4, 0.6))) * (1 - ease(progress(20.2, 0.5))));
  const agentShift = $derived(-220 * ease(progress(8.4, 0.6)) * (1 - ease(progress(16.2, 0.6))));
  const agentLift = $derived(-130 * ease(progress(16.2, 0.6)));
  const killed = $derived(time > 18.6 && time < 19.6);
  const agentMood = $derived<Mood>(killed ? 'idle' : time > 5.6 && time < 8.2 ? 'thinking' : time > 13 && time < 16 ? 'speaking' : time > 17 && time < 20.4 ? 'speaking' : 'idle');
  const crowd = $derived(during(4.0, 8.4));
  const queueOrder = $derived(time > 6.4 ? [1, 0, 2] : [0, 1, 2]);
  const spaceCard = $derived(during(8.8, 12.4));
  const selfEdit = $derived(during(12.8, 16.2));
  const restart = $derived(during(16.8, 20.6));
  const ui = $derived(during(20.6, 28.6, 0.5));
  const approval = $derived(approvalScene(time + 2.8));
  const webOpacity = $derived(during(28.6, 36.6, 0.5));
  const terminal = $derived(during(36.6, 40.4));
  const end = $derived(ease(progress(40.4, 0.8)));
  const connector = { configured: true, id: 'mcp', name: 'GitLab', connected: true };
  const samChat = $derived({ state: approval.sam, paletteOpen: false, paletteTab: 'account', theme: 'dark', followLatest: true });
  const jordanChat = $derived({ state: approval.jordan, paletteOpen: false, paletteTab: 'account', theme: 'dark', followLatest: true });
</script>

<div class="stage">
  <svg class="layer" viewBox="0 0 1080 1080" aria-hidden="true">
    <defs>
      <radialGradient id="glow" cx="50%" cy="44%" r="60%">
        <stop offset="0%" stop-color="#1b2738" />
        <stop offset="100%" stop-color="#070707" />
      </radialGradient>
    </defs>
    <rect width="1080" height="1080" fill="url(#glow)" />
    {#each Array.from({ length: 12 }, (_, index) => index) as row}
      {#each Array.from({ length: 12 }, (_, index) => index) as column}
        <circle cx={45 + column * 90} cy={45 + row * 90} r="1.6" fill="#fff" opacity={0.06 + 0.04 * Math.sin(time * 1.4 + row * 0.6 + column * 0.4)} />
      {/each}
    {/each}
  </svg>

  {#if solo}
    <div class="hero" class:killed style:transform={`translate(calc(-50% + ${agentShift}px), calc(-50% + ${agentLift}px)) scale(${agentScale})`}>
      <AgentAvatar hash="chat-ax-lead" size={260} mood={agentMood} />
    </div>
  {/if}

  {#if crowd > 0.01}
    {#each people as person, index}
      {@const arrive = ease(progress(4.2 + index * 0.35, 1.0))}
      {@const at = mix(person.from, { x: 290 + index * 250, y: index === 2 ? 210 : 170 }, arrive)}
      <div class="cursor" style:left={`${at.x}px`} style:top={`${at.y}px`} style:opacity={crowd}>
        <svg width="30" height="30" viewBox="0 0 24 24"><path d="M4 2l16 9-7 2-3 7z" fill={person.color} stroke="#0a0a0a" stroke-width="1.4" stroke-linejoin="round" /></svg>
        <b style:background={person.color}>{person.name}</b>
      </div>
    {/each}
    <div class="queue" style:opacity={ease(progress(5.4, 0.4)) * crowd}>
      <small>{time > 6.4 ? 'Queue · quick questions first' : 'Queue · first in, first out'}</small>
      {#each queueOrder as index}
        <div class="chip"><i style:background={people[index].color}></i>{people[index].name}: {people[index].ask}</div>
      {/each}
    </div>
  {/if}

  {#if spaceCard > 0.01}
    <div class="card space" style:opacity={spaceCard} style:transform={`translateX(${(1 - spaceCard) * 30}px)`}>
      <b>Its own space</b>
      {#each space as item, index}
        <div class="row" style:opacity={ease(progress(9.0 + index * 0.2, 0.3))}><i></i>{item}</div>
      {/each}
      <small>no other agent can read it</small>
    </div>
  {/if}

  {#if selfEdit > 0.01}
    <div class="card term" style:opacity={selfEdit}>
      <code><span class="prompt">›</span> {typed('create_skill("release-notes")', 13.0, 0.9)}</code>
      {#if time > 14.0}<code class="ok">✓ skill saved</code>{/if}
      <code><span class="prompt">›</span> {typed('create_job("every Monday 9:00")', 14.3, 0.9)}</code>
      {#if time > 15.3}<code class="ok">✓ job scheduled</code>{/if}
    </div>
  {/if}

  {#if restart > 0.01}
    <div class="card reply" style:opacity={restart}>
      <div class="bar"><span class:dead={killed} style:width={`${replyProgress() * 100}%`}></span></div>
      <p>{replyText()}</p>
      {#if killed}<b class="kill">Process killed</b>{:else if time > 19.6}<b class="back">Back. Same reply.</b>{/if}
    </div>
  {/if}

  {#if ui > 0.01}
    <div class="windows" style:opacity={ui}>
      <section class="window">
        <header><span class="dot" style:background="#78b7ff"></span>Sam</header>
        <div class="viewport"><Chat initialState={approval.sam} viewer={viewers.sam} {connector} scripted={samChat} threadId="agent-lead" threadTitle="Lead" threadPath="Lead" /></div>
      </section>
      <section class="window">
        <header><span class="dot" style:background="#9be38a"></span>Jordan</header>
        <div class="viewport"><Chat initialState={approval.jordan} viewer={viewers.jordan} {connector} scripted={jordanChat} threadId="agent-lead" threadTitle="Lead" threadPath="Lead" /></div>
        {#if approval.notification > 0.01}
          <div class="toast" style:opacity={approval.notification} style:transform={`translateY(${(1 - approval.notification) * -16}px)`}>
            <AgentAvatar hash="chat-ax-lead" size={30} />
            <div><b>Sam wants to use your connector</b><span>approve MR 42</span></div>
            <span class="approve" class:pressed={approval.approvePressed}>Approve</span>
          </div>
        {/if}
      </section>
    </div>
  {/if}

  {#if webOpacity > 0.01}
    <svg class="layer" viewBox="0 0 1080 1080" aria-hidden="true" style:opacity={webOpacity}>
      {#each web as agent}
        {#if agent.parent !== null}
          <path d={curve(web[agent.parent], agent)} pathLength="1" stroke="#3a3a3a" stroke-width="3" fill="none" stroke-dasharray="1" stroke-dashoffset={1 - ease(progress(agent.at - 0.1, 0.5))} />
        {/if}
      {/each}
      {#each handoffs as handoff}
        {@const flight = progress(handoff.at, 0.6)}
        {#if flight > 0 && flight < 1}
          {@const point = onCurve(web[handoff.from], web[handoff.to], ease(flight))}
          <circle cx={point.x} cy={point.y} r="16" fill="#78b7ff" opacity="0.25" />
          <circle cx={point.x} cy={point.y} r="7" fill="#78b7ff" />
        {/if}
      {/each}
      {#if time > sideways.at}
        {@const reach = Math.min(0.45, progress(sideways.at, 0.8))}
        {@const point = mix(web[sideways.from], web[sideways.to], reach)}
        <line x1={web[sideways.from].x} y1={web[sideways.from].y} x2={point.x} y2={point.y} stroke="#ff6b6b" stroke-width="3" stroke-dasharray="8 8" />
        {#if reach >= 0.45}
          <g transform={`translate(${point.x} ${point.y})`}><circle r="22" fill="#2a1414" stroke="#ff6b6b" stroke-width="3" /><path d="M-8 -8L8 8M8 -8L-8 8" stroke="#ff6b6b" stroke-width="3.5" stroke-linecap="round" /></g>
        {/if}
      {/if}
    </svg>
    <div class="layer" style:opacity={webOpacity}>
      {#each web as agent}
        {@const scale = pop(progress(agent.at, 0.5))}
        {#if scale > 0.01}
          <div class="agent" style:left={`${agent.x}px`} style:top={`${agent.y}px`} style:transform={`translate(-50%, -50%) scale(${scale})`}>
            <AgentAvatar hash={agent.seed} size={agent.size} />
            <span>{agent.name}</span>
          </div>
        {/if}
      {/each}
    </div>
  {/if}

  {#if terminal > 0.01}
    <div class="card pi" style:opacity={terminal}>
      {#each pi.filter((line) => time >= line.at) as line}
        <code class={line.kind}>{line.text}</code>
      {/each}
    </div>
  {/if}

  {#if captionOpacity > 0.01 && caption}
    <div class="caption" style:opacity={captionOpacity} style:transform={`translateY(${(1 - captionOpacity) * 16}px)`}>{caption.text}</div>
  {/if}

  {#if end > 0.01}
    <div class="end" style:opacity={end}>
      <AgentAvatar hash="chat-ax-lead" size={120} />
      <h1>Chat AX</h1>
      <p>github.com/acoyfellow/chat-ax</p>
    </div>
  {/if}
</div>

<style>
  :global(html, body) { margin: 0; background: #070707; }
  .stage { position: relative; width: 1080px; height: 1080px; overflow: hidden; background: #070707; color: #f5f5f5; font-family: Geist, ui-sans-serif, system-ui, sans-serif; }
  .layer { position: absolute; inset: 0; width: 100%; height: 100%; }
  .hero { position: absolute; left: 50%; top: 46%; filter: drop-shadow(0 30px 60px rgb(0 0 0 / 60%)); }
  .hero :global(svg) { border-radius: 28%; }
  .hero.killed { filter: grayscale(1) brightness(0.4); }
  .cursor { position: absolute; display: flex; align-items: flex-start; gap: 4px; }
  .cursor b { margin-top: 20px; padding: 5px 11px; border-radius: 999px; color: #0a0a0a; font-size: 20px; font-weight: 600; }
  .queue { position: absolute; left: 50%; top: 660px; transform: translateX(-50%); display: flex; flex-direction: column; gap: 8px; width: 560px; }
  .queue small { font-family: "Geist Mono", ui-monospace, monospace; font-size: 18px; color: #78b7ff; }
  .chip { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 12px; background: #151515; border: 1.5px solid #2c2c2c; font-size: 21px; }
  .chip i { width: 12px; height: 12px; border-radius: 50%; }
  .card { position: absolute; padding: 22px 26px; border-radius: 18px; background: #121212; border: 1.5px solid #2f2f2f; box-shadow: 0 24px 60px rgb(0 0 0 / 60%); box-sizing: border-box; }
  .space { left: 560px; top: 250px; width: 380px; }
  .space b { display: block; font-size: 26px; margin-bottom: 12px; }
  .row { display: flex; align-items: center; gap: 12px; padding: 9px 0; font-size: 25px; border-top: 1px solid #242424; }
  .row i { width: 11px; height: 11px; border-radius: 3px; background: #78b7ff; }
  .space small { display: block; margin-top: 12px; font-family: "Geist Mono", ui-monospace, monospace; font-size: 16px; color: #8a8a8a; }
  .term { left: 470px; top: 330px; width: 580px; }
  .term code { font-size: 20px; }
  .term code, .pi code { display: block; font-family: "Geist Mono", ui-monospace, monospace; font-size: 22px; line-height: 1.75; color: #e8e8e8; white-space: pre; }
  .prompt { color: #78b7ff; }
  .pi .prompt { color: #78b7ff; }
  .pi .ok, .term .ok { color: #9be38a; }
  .reply { left: 140px; right: 140px; top: 600px; }
  .reply p { margin: 14px 0 0; min-height: 60px; font-size: 24px; line-height: 1.35; color: #d8d8d8; }
  .bar { height: 8px; border-radius: 4px; background: #262626; overflow: hidden; }
  .bar span { display: block; height: 100%; background: #78b7ff; }
  .bar span.dead { background: #ff6b6b; }
  .kill, .back { display: block; margin-top: 8px; font-family: "Geist Mono", ui-monospace, monospace; font-size: 20px; }
  .kill { color: #ff6b6b; }
  .back { color: #9be38a; }
  .windows { position: absolute; left: 36px; top: 36px; width: calc((1080px - 72px) / 1.3); height: calc((1080px - 196px) / 1.3); display: flex; gap: 16px; zoom: 1.3; }
  .window { position: relative; flex: 1; display: flex; flex-direction: column; min-width: 0; border-radius: 14px; overflow: hidden; border: 1px solid #2a2a2a; background: #101010; box-shadow: 0 30px 80px rgb(0 0 0 / 60%); }
  .window header { display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 12px; font-size: 13px; color: #9a9a9a; background: #161616; border-bottom: 1px solid #242424; }
  .dot { width: 9px; height: 9px; border-radius: 50%; }
  .viewport { position: relative; flex: 1; overflow: hidden; transform: translateZ(0); }
  .viewport :global(main), .viewport :global(aside), .viewport :global(.scrim) { position: absolute !important; }
  .toast { position: absolute; top: 38px; left: 10px; right: 10px; display: flex; align-items: center; gap: 10px; padding: 12px; border-radius: 12px; background: #262626; border: 1px solid #3a3a3a; box-shadow: 0 18px 50px rgb(0 0 0 / 60%); z-index: 20; }
  .toast div { flex: 1; min-width: 0; }
  .toast b { display: block; font-size: 13px; }
  .toast span { font-size: 12px; color: #a0a0a0; }
  .toast .approve { padding: 6px 11px; border-radius: 8px; background: #f5f5f5; color: #101010; font-size: 13px; font-weight: 600; }
  .toast .approve.pressed { transform: scale(0.92); background: #c8c8c8; }
  .agent { position: absolute; display: flex; flex-direction: column; align-items: center; gap: 8px; filter: drop-shadow(0 16px 28px rgb(0 0 0 / 55%)); }
  .agent :global(svg) { border-radius: 28%; }
  .agent span { font-family: "Geist Mono", ui-monospace, monospace; font-size: 18px; color: #b8b8b8; }
  .pi { left: 120px; right: 120px; top: 260px; }
  .caption { position: absolute; left: 60px; right: 60px; bottom: 70px; text-align: center; font-size: 46px; font-weight: 600; letter-spacing: -0.025em; line-height: 1.2; text-shadow: 0 4px 30px rgb(0 0 0 / 80%); }
  .end { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; background: #070707; }
  .end :global(svg) { border-radius: 28%; }
  .end h1 { margin: 0; font-size: 110px; font-weight: 600; letter-spacing: -0.045em; }
  .end p { margin: 0; font-family: "Geist Mono", ui-monospace, monospace; font-size: 26px; color: #a0a0a0; }
</style>
