<script>
  import AgentAvatar from './AgentAvatar.svelte';
  import {
    avatarAntennaStyles,
    avatarDetailStyles,
    avatarEarStyles,
    avatarEyeStyles,
    avatarHeadShapes,
    avatarMoods,
    avatarMotions,
    avatarMouthStyles,
    avatarPalettes,
    avatarStyles,
    avatarTextures,
    generateAvatarOptions,
  } from './avatar-options';

  let seed = $state('agent-explorer');
  let style = $state('wild');
  let mood = $state('idle');
  let animate = $state(true);
  let zoom = $state(1);
  const zoomLevels = [0.5, 1, 2, 4];
  let options = $state(generateAvatarOptions('agent-explorer', 'wild'));
  let gallerySeeds = $state(Array.from({ length: 24 }, (_, index) => `robot-${index + 1}`));

  const ranges = {
    scale: [0.7, 1.8],
    headWidth: [44, 90],
    headHeight: [36, 74],
    tilt: [-30, 30],
    wobble: [0, 4],
    aberration: [0, 6],
    eyeSize: [1, 10],
    eyeSpacing: [14, 52],
    eyeY: [52, 74],
    mouthWidth: [10, 40],
    mouthY: [70, 92],
    antennaHeight: [6, 36],
    earSize: [3, 13],
    lineWidth: [2, 10],
  };

  const choices = {
    palette: avatarPalettes,
    texture: avatarTextures,
    headShape: avatarHeadShapes,
    eyes: avatarEyeStyles,
    mouth: avatarMouthStyles,
    antenna: avatarAntennaStyles,
    ears: avatarEarStyles,
    detail: avatarDetailStyles,
    joins: ['round', 'square'],
    motion: avatarMotions,
  };

  const labels = {
    palette: 'Palette', texture: 'Texture', scale: 'Scale', wobble: 'Hand wobble', aberration: 'Aberration',
    headShape: 'Head shape', headWidth: 'Head width', headHeight: 'Head height', tilt: 'Tilt', lineWidth: 'Line width', joins: 'Line joins',
    eyes: 'Eyes', eyeSize: 'Eye size', eyeSpacing: 'Eye spacing', eyeY: 'Eye height',
    mouth: 'Mouth', mouthWidth: 'Mouth width', mouthY: 'Mouth height',
    antenna: 'Antenna', antennaHeight: 'Antenna height', ears: 'Ears', earSize: 'Ear size', detail: 'Detail',
    stroke: 'Outline', fill: 'Features', background: 'Background', accent: 'Accent', motion: 'Idle motion',
  };

  const groups = [
    { title: 'Silhouette', keys: ['headShape', 'headWidth', 'headHeight', 'scale', 'tilt', 'lineWidth', 'joins'] },
    { title: 'Surface', keys: ['palette', 'texture', 'wobble', 'aberration'] },
    { title: 'Expression', keys: ['eyes', 'eyeSize', 'eyeSpacing', 'eyeY', 'mouth', 'mouthWidth', 'mouthY'] },
    { title: 'Hardware', keys: ['antenna', 'antennaHeight', 'ears', 'earSize', 'detail'] },
    { title: 'Motion', keys: ['motion'] },
  ];

  function applySeed(nextSeed) {
    seed = nextSeed;
    options = generateAvatarOptions(nextSeed, style);
  }

  function applyStyle(nextStyle) {
    style = nextStyle;
    options = generateAvatarOptions(seed, nextStyle);
  }

  function randomize() {
    applySeed(crypto.randomUUID());
  }

  function reshuffleGallery() {
    gallerySeeds = Array.from({ length: 24 }, () => crypto.randomUUID().slice(0, 8));
  }

</script>

<svelte:head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main>
  <header>
    <div><a href="/">Chat AX</a><h1>Agent avatar explorer</h1><p>Every variable that gives a robot personality, exposed so we can see what earns its place.</p></div>
    <div class="header-actions">
      <div class="segmented" role="group" aria-label="Zoom">
        {#each zoomLevels as level}
          <button type="button" class:active={zoom === level} onclick={() => (zoom = level)}>{level}×</button>
        {/each}
      </div>
      <div class="segmented" role="group" aria-label="Mood">
        {#each avatarMoods as candidate}
          <button type="button" class:active={mood === candidate} onclick={() => (mood = candidate)}>{candidate}</button>
        {/each}
      </div>
      <button type="button" class="quiet" aria-pressed={animate} onclick={() => (animate = !animate)}>{animate ? 'Motion on' : 'Motion off'}</button>
      <div class="segmented" role="group" aria-label="Style">
        {#each avatarStyles as candidate}
          <button type="button" class:active={style === candidate} onclick={() => applyStyle(candidate)}>{candidate}</button>
        {/each}
      </div>
      <button onclick={randomize}>Randomize everything</button>
    </div>
  </header>

  <section class="workspace">
    <div class="preview">
      <AgentAvatar hash={seed} size={Math.round(140 * zoom * 1.5)} {options} {mood} {animate} />
      <div class="sizes">
        {#each [24, 32, 44, 64] as size}
          <AgentAvatar hash={seed} size={Math.round(size * zoom)} {options} {mood} {animate} />
        {/each}
      </div>
      <label class="seed">Seed<input bind:value={seed} onchange={() => applySeed(seed)} /></label>
    </div>

    <form onsubmit={(event) => event.preventDefault()}>
      <fieldset class="colors">
        <legend>Color</legend>
        {#each ['stroke', 'fill', 'background', 'accent'] as key}
          <label>{labels[key]}<input type="color" bind:value={options[key]} /></label>
        {/each}
      </fieldset>
      {#each groups as group}
        <fieldset>
          <legend>{group.title}</legend>
          {#each group.keys as key}
            {#if choices[key]}
              <label>{labels[key]}<select bind:value={options[key]}>{#each choices[key] as choice}<option value={choice}>{choice}</option>{/each}</select></label>
            {:else}
              <label>{labels[key]} <output>{options[key]}</output><input type="range" min={ranges[key][0]} max={ranges[key][1]} step={key === 'scale' ? 0.1 : 1} bind:value={options[key]} /></label>
            {/if}
          {/each}
        </fieldset>
      {/each}
    </form>
  </section>

  <section class="variance">
    <div class="variance-heading"><div><h2>Generated range</h2><p>Deterministic from seed. Click one to edit it.</p></div><button class="quiet" onclick={reshuffleGallery}>New batch</button></div>
    <div class="grid" style:--sample-size={`${Math.round(84 * Math.min(zoom, 2)) + 40}px`}>
      {#each gallerySeeds as sample (sample)}
        <button class="sample" aria-label={`Use ${sample}`} onclick={() => applySeed(sample)}><AgentAvatar hash={sample} size={Math.round(84 * Math.min(zoom, 2))} options={generateAvatarOptions(sample, style)} {mood} {animate} /><span>{sample}</span></button>
      {/each}
    </div>
  </section>
</main>

<style>
  :global(*) { box-sizing: border-box; }
  :global(:root) { color-scheme: light; --surface: #fff; --quiet: #f7f7f7; --text: #171717; --muted: #646464; --line: #dedede; --strong: #a8a8a8; }
  :global(body) { margin: 0; background: var(--quiet); color: var(--text); font: 14px/1.5 Geist, ui-sans-serif, system-ui, sans-serif; }
  button, input, select { font: inherit; }
  main { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 32px 0 64px; }
  header { display: flex; justify-content: space-between; gap: 24px; align-items: end; margin-bottom: 24px; }
  header a { color: var(--muted); text-decoration: none; }
  h1 { margin: 4px 0; font-size: clamp(28px, 5vw, 44px); font-weight: 600; line-height: 1.1; }
  h2 { margin: 0; font-size: 20px; font-weight: 600; }
  p { margin: 0; color: var(--muted); }
  button { border: 1px solid var(--text); border-radius: 8px; background: var(--text); color: var(--surface); padding: 9px 14px; font-weight: 600; cursor: pointer; }
  button.quiet { border-color: var(--line); background: var(--surface); color: var(--text); }
  .header-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: end; gap: 12px; }
  .segmented { display: flex; gap: 2px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); padding: 2px; }
  .segmented button { border: 0; border-radius: 6px; background: transparent; color: var(--muted); padding: 7px 12px; text-transform: capitalize; }
  .segmented button.active { background: var(--text); color: var(--surface); }
  .workspace { display: grid; grid-template-columns: minmax(300px, 0.75fr) minmax(440px, 1.25fr); overflow: hidden; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
  .preview { display: grid; place-items: center; align-content: center; gap: 20px; overflow: hidden; border-right: 1px solid var(--line); background: var(--quiet); padding: 32px; }
  .preview :global(svg) { max-width: 100%; height: auto; }
  .sizes { display: flex; align-items: center; gap: 16px; }
  .seed { display: grid; gap: 6px; width: 100%; color: var(--muted); }
  .seed input { width: 100%; }
  form { display: grid; grid-template-columns: 1fr 1fr; align-content: start; gap: 20px 24px; padding: 24px; }
  fieldset { display: grid; align-content: start; gap: 10px; margin: 0; border: 0; padding: 0; }
  legend { margin-bottom: 8px; padding: 0; font-weight: 600; }
  label { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; align-items: center; color: var(--muted); }
  label input[type='range'] { grid-column: 1 / -1; width: 100%; margin: 0; accent-color: var(--text); }
  input:not([type='range']), select { min-height: 36px; border: 1px solid var(--strong); border-radius: 6px; background: var(--surface); color: var(--text); padding: 6px 9px; }
  select { min-width: 140px; }
  label input[type='color'] { width: 44px; padding: 3px; }
  output { color: var(--text); font: 0.9em Geist Mono, ui-monospace, monospace; }
  .colors { grid-column: 1 / -1; grid-template-columns: repeat(4, 1fr); }
  .colors legend { grid-column: 1 / -1; }
  .variance { display: grid; gap: 16px; margin-top: 24px; }
  .variance-heading { display: flex; justify-content: space-between; align-items: end; gap: 16px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--sample-size, 124px), 1fr)); gap: 8px; }
  .sample { display: grid; place-items: center; gap: 8px; min-width: 0; border-color: var(--line); background: var(--surface); color: var(--text); padding: 12px 6px; }
  .sample span { max-width: 100%; overflow: hidden; color: var(--muted); font: 0.8em Geist Mono, ui-monospace, monospace; text-overflow: ellipsis; }
  @media (prefers-color-scheme: dark) { :global(:root) { color-scheme: dark; --surface: #101010; --quiet: #181818; --text: #f5f5f5; --muted: #a0a0a0; --line: #303030; --strong: #707070; } }
  @media (max-width: 820px) { header { align-items: start; flex-direction: column; } .workspace { grid-template-columns: 1fr; } .preview { border-right: 0; border-bottom: 1px solid var(--line); } form { grid-template-columns: 1fr; } .colors { grid-template-columns: 1fr 1fr; } .grid { grid-template-columns: repeat(3, 1fr); } }
</style>
