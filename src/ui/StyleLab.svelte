<script>
  import { AlertCircle, Check, LoaderCircle, Paperclip, RotateCcw, SendHorizontal, Sparkles } from '@lucide/svelte';
  import { untrack } from 'svelte';

  let { initialMessageState = 'thinking' } = $props();
  const states = ['queued', 'thinking', 'streaming', 'complete', 'error'];
  const stateCopy = {
    queued: 'Waiting for the room agent',
    thinking: 'Reasoning about the request',
    streaming: 'The capability boundary follows the author of the turn, not a name mentioned inside the prompt.',
    complete: 'The capability boundary follows the author of the turn, not a name mentioned inside the prompt.',
    error: 'The response stopped before it completed.',
  };
  let messageState = $state(untrack(() => initialMessageState));
  let composerState = $state('ready');
</script>

<svelte:head>
  <title>Chat AX · Interface lab</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400..600&family=Geist+Mono:wght@400..600&display=swap" rel="stylesheet" referrerpolicy="no-referrer" />
</svelte:head>

<main>
  <header>
    <div>
      <span class="eyebrow">Chat AX interface lab</span>
      <h1>Conversation state language</h1>
      <p>One visual grammar for waiting, reasoning, streaming, completion, and recovery.</p>
    </div>
    <a href="/">Return to room</a>
  </header>

  <section class="tokens" aria-label="Brand tokens">
    <div><span class="swatch ink"></span><strong>Ink</strong><code>#1a1a1a</code></div>
    <div><span class="swatch paper"></span><strong>Paper</strong><code>#ffffff</code></div>
    <div><span class="swatch quiet"></span><strong>Quiet</strong><code>#f2f2f2</code></div>
    <div><span class="swatch signal"></span><strong>Signal</strong><code>#ef2b2d</code></div>
    <div><span class="swatch danger"></span><strong>Failure</strong><code>#b42318</code></div>
  </section>

  <div class="grid">
    <section class="panel preview-panel">
      <div class="panel-heading">
        <div><span class="eyebrow">Live specimen</span><h2>Agent response</h2></div>
        <div class="segmented" aria-label="Response state">
          {#each states as state}
            <button class:active={messageState === state} onclick={() => (messageState = state)}>{state}</button>
          {/each}
        </div>
      </div>

      <div class="conversation">
        <article class="user-message">
          <div class="user-meta"><strong>Jordan Coeyman</strong><time>05:38 AM</time></div>
          <p>Can Sam use my connected MCP if they ask the shared agent?</p>
        </article>

        <article class:failed={messageState === 'error'} class="agent-message">
          <div class="agent-mark"><Sparkles size={17} aria-hidden="true" /></div>
          <div class="response">
            <div class="agent-meta">
              <strong>Agent</strong>
              {#if messageState === 'queued'}<span>Queued</span>{/if}
              {#if messageState === 'thinking'}<span class="activity"><i></i>Thinking</span>{/if}
              {#if messageState === 'streaming'}<span class="activity"><i></i>Responding</span>{/if}
              {#if messageState === 'complete'}<span class="success"><Check size={13} />Complete</span>{/if}
              {#if messageState === 'error'}<span class="failure"><AlertCircle size={13} />Interrupted</span>{/if}
            </div>
            {#if messageState === 'queued'}
              <div class="queued-block"><span></span><span></span><span></span></div>
            {:else if messageState === 'thinking'}
              <div class="thinking-block"><div class="shimmer"></div><p>Establishing the turn author and available capability scope</p></div>
            {:else if messageState === 'error'}
              <p>{stateCopy.error}</p><button class="retry"><RotateCcw size={14} />Retry response</button>
            {:else}
              <p class:streaming={messageState === 'streaming'}>{stateCopy[messageState]}</p>
            {/if}
          </div>
        </article>
      </div>
    </section>

    <section class="panel">
      <div class="panel-heading"><div><span class="eyebrow">Composer</span><h2>Input states</h2></div></div>
      <div class="segmented composer-states" aria-label="Composer state">
        {#each ['empty', 'ready', 'attachment', 'sending'] as state}
          <button class:active={composerState === state} onclick={() => (composerState = state)}>{state}</button>
        {/each}
      </div>
      <div class:disabled={composerState === 'sending'} class="composer">
        <textarea aria-label="Composer specimen" rows="3" readonly value={composerState === 'empty' ? '' : 'Explain the authority boundary.'} placeholder="Message the agent"></textarea>
        {#if composerState === 'attachment'}<div class="attachment">capability-notes.md <span>12 KB</span></div>{/if}
        <div class="composer-actions">
          <button class="icon-button secondary" aria-label="Attach files"><Paperclip size={18} /></button>
          <button class="icon-button primary" aria-label="Send message" disabled={composerState === 'empty'}>
            {#if composerState === 'sending'}<LoaderCircle class="spin" size={18} />{:else}<SendHorizontal size={18} />{/if}
          </button>
        </div>
      </div>
    </section>
  </div>

  <section class="principles">
    <div><strong>Stable geometry</strong><p>Status changes never resize the transcript or move the composer.</p></div>
    <div><strong>Motion with meaning</strong><p>Pulse means work is live. A caret means text is arriving. Everything else rests.</p></div>
    <div><strong>One status source</strong><p>The message owns queued, thinking, streaming, complete, or error. No duplicate working row.</p></div>
    <div><strong>Accessible by default</strong><p>State is always expressed in text and shape, never through color alone.</p></div>
  </section>
</main>

<style>
  :global(*) { box-sizing: border-box; }
  :global(:root) { color-scheme: light dark; --paper: #fff; --quiet: #f7f7f7; --muted: #646464; --ink: #171717; --line: #dedede; --signal: #ef2b2d; --danger: #b42318; }
  :global(body) { margin: 0; background: var(--quiet); color: var(--ink); font: 14px/1.5 Geist, ui-sans-serif, system-ui, sans-serif; }
  button, textarea { font: inherit; }
  main { width: min(1240px, calc(100% - 40px)); margin: 0 auto; padding: 48px 0 72px; }
  header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; margin-bottom: 32px; }
  h1 { margin: 4px 0 6px; font-size: clamp(30px, 5vw, 48px); font-weight: 600; line-height: 1.05; }
  h2 { margin: 2px 0 0; font-size: 18px; font-weight: 600; }
  header p, .principles p { margin: 0; color: var(--muted); }
  header a { border: 1px solid var(--line); border-radius: 8px; background: var(--paper); color: var(--ink); padding: 8px 12px; text-decoration: none; }
  .eyebrow { color: var(--muted); font: 600 14px/1.2 Geist, ui-sans-serif, system-ui, sans-serif; }
  .tokens { display: grid; grid-template-columns: repeat(5, 1fr); overflow: hidden; margin-bottom: 16px; border: 1px solid var(--line); border-radius: 12px; background: var(--paper); }
  .tokens div { display: grid; grid-template-columns: 18px 1fr; gap: 0 8px; align-items: center; padding: 14px; border-right: 1px solid var(--line); }
  .tokens div:last-child { border: 0; }
  .tokens code { grid-column: 2; color: var(--muted); font-size: 0.9em; }
  .swatch { grid-row: 1 / 3; width: 18px; height: 36px; border: 1px solid var(--line); border-radius: 5px; }
  .ink { background: #1a1a1a; } .paper { background: #fff; } .quiet { background: #f2f2f2; } .signal { background: #ef2b2d; } .danger { background: #b42318; }
  .grid { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(320px, 0.8fr); gap: 16px; }
  .panel { overflow: hidden; min-height: 470px; border: 1px solid var(--line); border-radius: 14px; background: var(--paper); }
  .panel-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 20px; border-bottom: 1px solid var(--line); }
  .segmented { display: flex; flex-wrap: wrap; gap: 3px; padding: 3px; border-radius: 8px; background: var(--quiet); }
  .segmented button { border: 0; border-radius: 6px; background: transparent; color: var(--muted); padding: 5px 8px; font-size: 14px; text-transform: capitalize; cursor: pointer; }
  .segmented button.active { background: var(--paper); color: var(--ink); }
  .conversation { min-height: 380px; padding: 42px 36px; }
  .user-message { display: grid; justify-items: end; margin-left: auto; width: min(75%, 540px); }
  .user-meta, .agent-meta { display: flex; align-items: center; gap: 8px; }
  time, .agent-meta span { color: var(--muted); font: 0.9em "Geist Mono", monospace; }
  .user-message p { margin: 8px 0 44px; border: 1px solid var(--line); border-radius: 8px; background: var(--quiet); padding: 11px 15px; }
  .agent-message { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 11px; opacity: 1; animation: arrive 180ms ease-out; }
  .agent-mark { display: grid; place-items: center; width: 34px; height: 34px; border: 1px solid var(--signal); border-radius: 50%; color: var(--signal); }
  .response { min-height: 112px; padding-top: 5px; }
  .response > p { max-width: 620px; margin: 14px 0 0; font-size: 16px; line-height: 1.65; }
  .activity, .success, .failure { display: inline-flex; align-items: center; gap: 5px; }
  .activity i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: pulse 1.2s ease-in-out infinite; }
  .success { color: #237a43 !important; } .failure { color: var(--danger) !important; }
  .thinking-block { max-width: 520px; margin-top: 15px; }
  .thinking-block p { margin: 9px 0 0; color: var(--muted); font-size: 14px; }
  .shimmer { width: 100%; height: 3px; overflow: hidden; border-radius: 999px; background: var(--quiet); }
  .shimmer::after { display: block; width: 35%; height: 100%; border-radius: inherit; background: var(--ink); content: ''; animation: think 1.35s ease-in-out infinite; }
  .queued-block { display: flex; gap: 5px; margin-top: 19px; }
  .queued-block span { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); animation: pulse 1.2s ease-in-out infinite; }
  .queued-block span:nth-child(2) { animation-delay: 120ms; } .queued-block span:nth-child(3) { animation-delay: 240ms; }
  .streaming::after { display: inline-block; width: 2px; height: 1em; margin-left: 3px; background: currentColor; vertical-align: -2px; content: ''; animation: blink 800ms steps(1) infinite; }
  .retry { display: inline-flex; align-items: center; gap: 6px; margin-top: 15px; border: 1px solid var(--line); border-radius: 7px; background: var(--paper); color: var(--ink); padding: 7px 9px; }
  .composer-states { margin: 18px 20px 0; }
  .composer { margin: 20px; overflow: hidden; border: 1px solid #a1a1a1; border-radius: 10px; transition: opacity 140ms ease; }
  .composer:focus-within { border-color: var(--ink); outline: 2px solid color-mix(in srgb, var(--ink) 12%, transparent); outline-offset: 2px; }
  .composer.disabled { opacity: 0.68; }
  .composer textarea { width: 100%; resize: none; border: 0; outline: 0; background: transparent; color: var(--ink); padding: 14px; }
  .attachment { margin: 0 12px 4px; width: fit-content; border: 1px solid var(--line); border-radius: 6px; background: var(--quiet); padding: 5px 8px; font-size: 14px; }
  .attachment span { color: var(--muted); }
  .composer-actions { display: flex; justify-content: space-between; padding: 8px 10px 10px; }
  .icon-button { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 8px; }
  .secondary { border: 0; background: transparent; color: var(--muted); }
  .primary { border: 0; background: var(--ink); color: var(--paper); }
  .primary:disabled { opacity: 0.4; }
  :global(.spin) { animation: spin 900ms linear infinite; }
  .principles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; overflow: hidden; margin-top: 16px; border: 1px solid var(--line); border-radius: 12px; background: var(--line); }
  .principles div { background: var(--paper); padding: 18px; }
  .principles p { margin-top: 5px; font-size: 14px; }
  @keyframes arrive { from { opacity: 0; transform: translateY(4px); } }
  @keyframes pulse { 50% { opacity: 0.3; transform: scale(0.85); } }
  @keyframes think { 0% { transform: translateX(-110%); } 100% { transform: translateX(310%); } }
  @keyframes blink { 50% { opacity: 0; } }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } .tokens, .principles { grid-template-columns: repeat(2, 1fr); } .preview-panel { min-height: 0; } }
  @media (max-width: 600px) { main { width: min(100% - 24px, 1240px); padding-top: 24px; } header, .panel-heading { display: grid; } .tokens, .principles { grid-template-columns: 1fr; } .conversation { padding: 28px 20px; } .user-message { width: 90%; } }
  @media (prefers-color-scheme: dark) { :global(:root) { --paper: #101010; --quiet: #181818; --muted: #a0a0a0; --ink: #f5f5f5; --line: #303030; --danger: #ff7770; } :global(body) { background: #0b0b0b; } }
  @media (prefers-reduced-motion: reduce) { *, *::after { animation-duration: 1ms !important; animation-iteration-count: 1 !important; transition: none !important; } }
</style>
