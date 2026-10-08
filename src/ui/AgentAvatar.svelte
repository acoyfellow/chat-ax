<script lang="ts">
  import { type AvatarMood, type AvatarOptions, generateAvatarOptions, roll, stringToHash } from './avatar-options';

  let { hash = 'agent', size = 32, options, mood = 'idle', animate = true, framed = true } = $props<{
    hash?: string;
    size?: number;
    options?: Partial<AvatarOptions>;
    mood?: AvatarMood;
    animate?: boolean;
    framed?: boolean;
  }>();

  const resolved = $derived<AvatarOptions>({ ...generateAvatarOptions(hash), ...options });
  const seed = $derived(stringToHash(hash));
  const patternId = $derived(`avatar-${seed.toString(36)}`);
  const headX = $derived(70 - resolved.headWidth / 2);
  const headY = $derived(70 - resolved.headHeight / 2);
  const headRight = $derived(headX + resolved.headWidth);
  const headBottom = $derived(headY + resolved.headHeight);
  const leftEyeX = $derived(70 - resolved.eyeSpacing / 2);
  const rightEyeX = $derived(70 + resolved.eyeSpacing / 2);
  const mouthLeft = $derived(70 - resolved.mouthWidth / 2);
  const mouthRight = $derived(70 + resolved.mouthWidth / 2);
  const antennaTop = $derived(headY - resolved.antennaHeight);
  const linecap = $derived(resolved.joins === 'round' ? 'round' : 'square');
  const linejoin = $derived(resolved.joins === 'round' ? 'round' : 'miter');
  const earGap = $derived(resolved.earSize + 2);
  const headFill = $derived(resolved.texture === 'flat' ? 'none' : `url(#${patternId})`);
  const motion = $derived(animate ? resolved.motion : 'none');
  const motionDelay = $derived(`${-(roll(seed, 800, 40) / 10)}s`);
  const blinkDuration = $derived(`${3.2 + roll(seed, 801, 30) / 10}s`);
  const eyeCenterY = $derived(resolved.eyes === 'cluster' ? headY + resolved.headHeight * 0.35 : resolved.eyeY);

  function jitter(x: number, y: number, slot: number): string {
    if (resolved.wobble === 0) return `${x} ${y}`;
    const range = resolved.wobble * 20 + 1;
    const dx = (roll(seed, 100 + slot, range) - resolved.wobble * 10) / 10;
    const dy = (roll(seed, 200 + slot, range) - resolved.wobble * 10) / 10;
    return `${x + dx} ${y + dy}`;
  }

  function polygonHead(sides: number, roughness: number, smooth: boolean): string {
    const rx = resolved.headWidth / 2;
    const ry = resolved.headHeight / 2;
    const points: Array<[number, number]> = [];
    for (let index = 0; index < sides; index += 1) {
      const angle = (index / sides) * Math.PI * 2 + (roll(seed, 300 + index, 100) / 100) * (Math.PI / sides) * roughness;
      const radial = 1 - (roll(seed, 400 + index, 100) / 100) * 0.25 * roughness;
      points.push([70 + Math.cos(angle) * rx * radial, 70 + Math.sin(angle) * ry * radial]);
    }
    if (!smooth) return `M${points.map(([x, y]) => `${x} ${y}`).join('L')}Z`;
    const segments = points.map((current, index) => {
      const next = points[(index + 1) % points.length];
      return { control: current, end: [(current[0] + next[0]) / 2, (current[1] + next[1]) / 2] as [number, number] };
    });
    const start = segments[segments.length - 1].end;
    return `M${start[0]} ${start[1]}${segments.map(({ control, end }) => `Q${control[0]} ${control[1]} ${end[0]} ${end[1]}`).join('')}Z`;
  }

  const headPath = $derived.by(() => {
    const { headShape, headWidth, headHeight } = resolved;
    const x = headX;
    const y = headY;
    const r = headRight;
    const b = headBottom;
    if (headShape === 'blob') return polygonHead(5 + roll(seed, 500, 4), 1, true);
    if (headShape === 'shard') return polygonHead(5 + roll(seed, 500, 3), 1.2, false);
    if (headShape === 'dome') {
      const radius = headWidth / 2;
      return `M${jitter(x, b, 1)}V${y + radius}A${radius} ${radius} 0 0 1 ${r} ${y + radius}V${b}Z`;
    }
    if (headShape === 'trapezoid') {
      const inset = headWidth * 0.14;
      return `M${jitter(x + inset, y, 1)}L${jitter(r - inset, y, 2)}L${jitter(r, b, 3)}L${jitter(x, b, 4)}Z`;
    }
    if (headShape === 'wide') {
      const radius = headHeight / 2;
      return `M${x + radius} ${y}H${r - radius}A${radius} ${radius} 0 0 1 ${r - radius} ${b}H${x + radius}A${radius} ${radius} 0 0 1 ${x + radius} ${y}Z`;
    }
    const radius = headShape === 'boxy' ? 3 : Math.min(18, headHeight / 3);
    return `M${x + radius} ${y}H${r - radius}Q${jitter(r, y, 1)} ${r} ${y + radius}V${b - radius}Q${jitter(r, b, 2)} ${r - radius} ${b}H${x + radius}Q${jitter(x, b, 3)} ${x} ${b - radius}V${y + radius}Q${jitter(x, y, 4)} ${x + radius} ${y}Z`;
  });

  const mouthPath = $derived.by(() => {
    const { mouth, mouthY } = resolved;
    const l = mouthLeft;
    const r = mouthRight;
    if (mouth === 'flat') return `M${jitter(l, mouthY, 10)}L${jitter(r, mouthY, 11)}`;
    if (mouth === 'frown') return `M${l} ${mouthY + 4}Q70 ${mouthY - 6} ${r} ${mouthY + 4}`;
    if (mouth === 'zigzag') {
      const step = (r - l) / 4;
      return `M${l} ${mouthY}l${step} 4l${step} -4l${step} 4l${step} -4`;
    }
    if (mouth === 'grin') return `M${l} ${mouthY}Q70 ${mouthY + 14} ${r} ${mouthY}Z`;
    return `M${jitter(l, mouthY, 10)}Q70 ${mouthY + 10} ${jitter(r, mouthY, 11)}`;
  });

  const clusterEyes = $derived(
    Array.from({ length: 3 + roll(seed, 600, 3) }, (_, index) => ({
      x: headX + 10 + roll(seed, 610 + index, Math.max(1, resolved.headWidth - 20)),
      y: headY + 8 + roll(seed, 620 + index, Math.max(1, Math.round(resolved.headHeight * 0.55))),
      r: 2 + roll(seed, 630 + index, 5),
    })),
  );

  const antennaArray = $derived.by(() => {
    const count = 3 + roll(seed, 700, 3);
    return Array.from({ length: count }, (_, index) => ({
      x: headX + 8 + ((resolved.headWidth - 16) / (count - 1)) * index,
      h: resolved.antennaHeight * (0.5 + roll(seed, 710 + index, 60) / 100),
    }));
  });
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 140 130"
  role="img"
  aria-label="Agent"
  class:framed
  style:background={resolved.background}
  style:border-color={resolved.stroke}
>
  <defs>
    {#if resolved.texture === 'hatch'}
      <pattern id={patternId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <path d="M0 0V6" stroke={resolved.fill} stroke-width="1.5" />
      </pattern>
    {:else if resolved.texture === 'dots'}
      <pattern id={patternId} width="7" height="7" patternUnits="userSpaceOnUse">
        <circle cx="3.5" cy="3.5" r="1.4" fill={resolved.fill} />
      </pattern>
    {:else if resolved.texture === 'split'}
      <pattern id={patternId} width="140" height="130" patternUnits="userSpaceOnUse">
        <rect x="70" y="0" width="70" height="130" fill={resolved.fill} opacity="0.35" />
      </pattern>
    {/if}
  </defs>
  <g class={`figure motion-${motion} mood-${mood}`} style:animation-delay={motionDelay} style:transform-origin="70px 70px">
  <g transform={`translate(70 70) scale(${resolved.scale}) rotate(${resolved.tilt}) translate(-70 -70)`}>
    {#if resolved.aberration > 0}
      <g transform={`translate(${resolved.aberration} ${-resolved.aberration})`} stroke={resolved.accent} stroke-width={resolved.lineWidth} stroke-linecap={linecap} stroke-linejoin={linejoin} fill="none" opacity="0.85">
        <path d={headPath} />
      </g>
    {/if}
    <g stroke={resolved.stroke} stroke-width={resolved.lineWidth} stroke-linecap={linecap} stroke-linejoin={linejoin} fill="none">
      <g class="antenna" style:transform-origin={`70px ${headY}px`}>
      {#if resolved.antenna === 'single'}
        <path d={`M${jitter(70, antennaTop + 4, 20)}L${jitter(70, headY, 21)}`} />
        <circle cx="70" cy={antennaTop} r={resolved.lineWidth * 0.8} fill={resolved.accent} stroke="none" />
      {:else if resolved.antenna === 'double'}
        <path d={`M58 ${antennaTop + 3}V${headY}M82 ${antennaTop + 3}V${headY}`} />
        <circle cx="58" cy={antennaTop} r={resolved.lineWidth * 0.6} fill={resolved.accent} stroke="none" />
        <circle cx="82" cy={antennaTop} r={resolved.lineWidth * 0.6} fill={resolved.accent} stroke="none" />
      {:else if resolved.antenna === 'offset'}
        <path d={`M${headX + 12} ${antennaTop + 6}Q${headX + 10} ${headY - 4} ${headX + 14} ${headY}`} />
        <circle cx={headX + 12} cy={antennaTop + 2} r={resolved.lineWidth * 0.8} fill={resolved.accent} stroke="none" />
      {:else if resolved.antenna === 'loop'}
        <path d={`M70 ${headY}V${antennaTop + 10}`} />
        <circle cx="70" cy={antennaTop + 4} r="6" />
      {:else if resolved.antenna === 'array'}
        {#each antennaArray as rod, index}
          <path d={`M${rod.x} ${headY}V${headY - rod.h}`} />
          <circle cx={rod.x} cy={headY - rod.h} r={resolved.lineWidth * 0.55} fill={index % 2 === 0 ? resolved.accent : resolved.fill} stroke="none" />
        {/each}
      {/if}
      </g>

      <path d={headPath} fill={headFill} />

      {#if resolved.ears === 'round'}
        <circle cx={headX - earGap} cy="70" r={resolved.earSize} />
        <circle cx={headRight + earGap} cy="70" r={resolved.earSize} />
      {:else if resolved.ears === 'square'}
        <rect x={headX - earGap - resolved.earSize} y={70 - resolved.earSize} width={resolved.earSize * 2} height={resolved.earSize * 2} rx="1.5" />
        <rect x={headRight + earGap - resolved.earSize} y={70 - resolved.earSize} width={resolved.earSize * 2} height={resolved.earSize * 2} rx="1.5" />
      {:else if resolved.ears === 'bars'}
        <path d={`M${headX - 4} ${70 - resolved.earSize * 1.4}V${70 + resolved.earSize * 1.4}M${headRight + 4} ${70 - resolved.earSize * 1.4}V${70 + resolved.earSize * 1.4}`} />
      {:else if resolved.ears === 'mismatched'}
        <circle cx={headX - earGap} cy="68" r={resolved.earSize} />
        <rect x={headRight + 2} y={66 - resolved.earSize * 0.6} width={resolved.earSize * 1.2} height={resolved.earSize * 1.8} rx="1.5" />
      {/if}

      <g class="eyes" style:transform-origin={`70px ${eyeCenterY}px`} style:--blink={blinkDuration}>
      {#if resolved.eyes === 'dots'}
        <circle cx={leftEyeX} cy={resolved.eyeY} r={resolved.eyeSize} fill={resolved.fill} stroke="none" />
        <circle cx={rightEyeX} cy={resolved.eyeY} r={resolved.eyeSize} fill={resolved.fill} stroke="none" />
      {:else if resolved.eyes === 'rings'}
        <circle cx={leftEyeX} cy={resolved.eyeY} r={resolved.eyeSize + 1} />
        <circle cx={rightEyeX} cy={resolved.eyeY} r={resolved.eyeSize + 1} />
        <circle cx={leftEyeX} cy={resolved.eyeY} r={resolved.lineWidth * 0.3} fill={resolved.stroke} stroke="none" />
        <circle cx={rightEyeX} cy={resolved.eyeY} r={resolved.lineWidth * 0.3} fill={resolved.stroke} stroke="none" />
      {:else if resolved.eyes === 'visor'}
        <rect x={leftEyeX - resolved.eyeSize - 3} y={resolved.eyeY - resolved.eyeSize} width={resolved.eyeSpacing + resolved.eyeSize * 2 + 6} height={resolved.eyeSize * 2} rx={resolved.eyeSize} fill={resolved.fill} stroke="none" />
        <circle cx={leftEyeX} cy={resolved.eyeY} r={Math.max(1.5, resolved.eyeSize - 2.5)} fill={resolved.background} stroke="none" />
        <circle cx={rightEyeX} cy={resolved.eyeY} r={Math.max(1.5, resolved.eyeSize - 2.5)} fill={resolved.background} stroke="none" />
      {:else if resolved.eyes === 'wink'}
        <circle cx={leftEyeX} cy={resolved.eyeY} r={resolved.eyeSize} fill={resolved.fill} stroke="none" />
        <path d={`M${rightEyeX - resolved.eyeSize} ${resolved.eyeY}H${rightEyeX + resolved.eyeSize}`} />
      {:else if resolved.eyes === 'sleepy'}
        <path d={`M${leftEyeX - resolved.eyeSize} ${resolved.eyeY}A${resolved.eyeSize} ${resolved.eyeSize} 0 0 0 ${leftEyeX + resolved.eyeSize} ${resolved.eyeY}`} fill={resolved.fill} stroke="none" />
        <path d={`M${rightEyeX - resolved.eyeSize} ${resolved.eyeY}A${resolved.eyeSize} ${resolved.eyeSize} 0 0 0 ${rightEyeX + resolved.eyeSize} ${resolved.eyeY}`} fill={resolved.fill} stroke="none" />
      {:else if resolved.eyes === 'cyclops'}
        <circle cx="70" cy={resolved.eyeY} r={resolved.eyeSize * 2.4} fill={resolved.fill} stroke="none" />
        <circle cx={70 + resolved.eyeSize * 0.6} cy={resolved.eyeY - resolved.eyeSize * 0.4} r={resolved.eyeSize * 0.9} fill={resolved.background} stroke="none" />
      {:else if resolved.eyes === 'cluster'}
        {#each clusterEyes as eye, index}
          <circle cx={eye.x} cy={eye.y} r={eye.r} fill={index === 0 ? resolved.accent : resolved.fill} stroke="none" />
        {/each}
      {:else}
        <circle cx={leftEyeX} cy={resolved.eyeY + 1} r={resolved.eyeSize * 0.7} fill={resolved.fill} stroke="none" />
        <circle cx={rightEyeX} cy={resolved.eyeY - 1} r={resolved.eyeSize * 1.3} />
        <circle cx={rightEyeX} cy={resolved.eyeY - 1} r={resolved.lineWidth * 0.3} fill={resolved.stroke} stroke="none" />
      {/if}
      </g>

      <g class="mouth" style:transform-origin={`70px ${resolved.mouthY}px`}>
      {#if resolved.mouth === 'open'}
        <ellipse cx="70" cy={resolved.mouthY + 3} rx={resolved.mouthWidth / 4} ry={resolved.mouthWidth / 5} fill={resolved.fill} stroke="none" />
      {:else if resolved.mouth !== 'none'}
        <path d={mouthPath} fill={resolved.mouth === 'grin' ? resolved.background : 'none'} />
        {#if resolved.mouth === 'grin'}
          <path d={`M${70 - resolved.mouthWidth / 4} ${resolved.mouthY}V${resolved.mouthY + 5}M70 ${resolved.mouthY}V${resolved.mouthY + 7}M${70 + resolved.mouthWidth / 4} ${resolved.mouthY}V${resolved.mouthY + 5}`} />
        {/if}
      {/if}
      </g>

      {#if resolved.detail === 'bolts'}
        <circle cx={headX + 7} cy={headBottom - 7} r={resolved.lineWidth * 0.4} fill={resolved.stroke} stroke="none" />
        <circle cx={headRight - 7} cy={headBottom - 7} r={resolved.lineWidth * 0.4} fill={resolved.stroke} stroke="none" />
      {:else if resolved.detail === 'cheeks'}
        <circle cx={leftEyeX - 2} cy={resolved.eyeY + resolved.eyeSize + 8} r="3" fill={resolved.accent} stroke="none" opacity="0.7" />
        <circle cx={rightEyeX + 2} cy={resolved.eyeY + resolved.eyeSize + 8} r="3" fill={resolved.accent} stroke="none" opacity="0.7" />
      {:else if resolved.detail === 'seam'}
        <path d={`M${headX + 6} ${headBottom - 10}H${headRight - 6}`} />
      {:else if resolved.detail === 'lights'}
        <circle cx={headX + 7} cy={headY + 8} r={resolved.lineWidth * 0.4} fill={resolved.accent} stroke="none" />
        <circle cx={headX + 13} cy={headY + 8} r={resolved.lineWidth * 0.4} fill={resolved.fill} stroke="none" />
      {:else if resolved.detail === 'stamp'}
        <text x="70" y={headBottom - 6} text-anchor="middle" font-family="ui-monospace, monospace" font-weight="700" font-size="9" fill={resolved.accent} stroke="none" letter-spacing="1">{resolved.stamp}</text>
      {/if}
    </g>
  </g>
  </g>
</svg>

<style>
  svg { display: block; flex: none; overflow: hidden; border: 0; border-radius: 50%; }
  svg.framed { border: 1px solid; }
  .figure, .eyes, .antenna, .mouth { transform-box: view-box; }
  .motion-float { animation: float 3.4s ease-in-out infinite; }
  .motion-bob .antenna { animation: bob 1.8s ease-in-out infinite; }
  .motion-wobble { animation: wobble 4.2s ease-in-out infinite; }
  .motion-bounce { animation: bounce 2.6s cubic-bezier(.34,1.56,.64,1) infinite; }
  .motion-glance .eyes { animation: glance 5s ease-in-out infinite; }
  .motion-blink .eyes, .motion-float .eyes, .motion-bob .eyes, .motion-wobble .eyes, .motion-bounce .eyes { animation: blink var(--blink, 3.6s) infinite; }
  .motion-glance .eyes { animation: glance 5s ease-in-out infinite, blink var(--blink, 4.4s) infinite; }
  .mood-thinking .antenna { animation: pulse 0.9s ease-in-out infinite; }
  .mood-thinking .eyes { animation: glance 1.6s ease-in-out infinite; }
  .mood-speaking .mouth { animation: talk 0.35s ease-in-out infinite alternate; }
  .mood-speaking { animation: nod 0.7s ease-in-out infinite alternate; }
  @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
  @keyframes bob { 0%, 100% { transform: rotate(-8deg); } 50% { transform: rotate(8deg); } }
  @keyframes wobble { 0%, 100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
  @keyframes bounce { 0%, 100% { transform: scaleY(1); } 45% { transform: scaleY(0.94) translateY(2px); } 60% { transform: scaleY(1.03) translateY(-1px); } }
  @keyframes glance { 0%, 40%, 100% { transform: translateX(0); } 50%, 80% { transform: translateX(4px); } }
  @keyframes blink { 0%, 92%, 100% { transform: scaleY(1); } 95% { transform: scaleY(0.08); } }
  @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.18) translateY(-1px); } }
  @keyframes talk { from { transform: scaleY(0.6); } to { transform: scaleY(1.25); } }
  @keyframes nod { from { transform: rotate(-1.5deg); } to { transform: rotate(1.5deg); } }
  @media (prefers-reduced-motion: reduce) { .figure, .eyes, .antenna, .mouth { animation: none !important; } }
</style>
