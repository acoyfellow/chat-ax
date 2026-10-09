<script lang="ts">
  import { onMount } from 'svelte';
  import MotionHeader from './MotionHeader.svelte';

  const duration = 8;
  let time = $state(0);
  let playing = $state(true);
  let scale = $state(1);

  function fit() {
    scale = Math.min(1, (window.innerWidth - 32) / 1080, (window.innerHeight - 96) / 1080);
  }

  onMount(() => {
    const frameParam = new URLSearchParams(location.search).get('t');
    if (frameParam !== null) {
      playing = false;
      time = Number(frameParam) || 0;
    }
    const renderFrame = (seconds: number) => {
      playing = false;
      time = seconds;
    };
    Object.assign(window, { renderMotionFrame: renderFrame, motionDuration: duration });
    fit();
    window.addEventListener('resize', fit);
    let last = performance.now();
    let handle = 0;
    const tick = (now: number) => {
      if (playing) time = (time + (now - last) / 1000) % duration;
      last = now;
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(handle);
      window.removeEventListener('resize', fit);
    };
  });
</script>

<main>
  <div class="viewport" style:width={`${1080 * scale}px`} style:height={`${1080 * scale}px`}>
    <div class="frame" style:transform={`scale(${scale})`}>
      <MotionHeader {time} {duration} />
    </div>
  </div>
  <nav>
    <button type="button" onclick={() => (playing = !playing)}>{playing ? 'Pause' : 'Play'}</button>
    <input type="range" min="0" max={duration} step="0.01" value={time} oninput={(event) => { playing = false; time = Number(event.currentTarget.value); }} aria-label="Timeline" />
    <span>{time.toFixed(2)}s</span>
  </nav>
</main>

<style>
  main { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; background: #050505; color: #f5f5f5; font-family: "Geist Mono", ui-monospace, monospace; }
  .viewport { position: relative; overflow: hidden; border-radius: 12px; }
  .frame { width: 1080px; height: 1080px; transform-origin: 0 0; }
  nav { display: flex; align-items: center; gap: 12px; }
  input { width: 360px; }
  button { background: #1b1b1b; color: inherit; border: 1px solid #333; border-radius: 8px; padding: 6px 14px; font: inherit; cursor: pointer; }
</style>
