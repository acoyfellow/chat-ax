<script lang="ts">
  import { afterUpdate } from 'svelte';

  export let open = false;
  export let title = '';
  export let value = '';
  export let placeholder = '';
  export let onSave: (value: string) => void = () => {};
  export let onClose: () => void = () => {};
  let dialog: HTMLElement;
  let input: HTMLInputElement;
  let wasOpen = false;
  let previousFocus: HTMLElement | null = null;

  afterUpdate(() => {
    if (open && !wasOpen) {
      previousFocus = document.activeElement as HTMLElement | null;
      input?.focus();
    } else if (!open && wasOpen) {
      previousFocus?.focus();
      previousFocus = null;
    }
    wasOpen = open;
  });

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button,input,[href],[tabindex]:not([tabindex="-1"])')].filter((item) => {
      if (item.hasAttribute('disabled')) return false;
      const style = getComputedStyle(item);
      return style.display !== 'none' && style.visibility !== 'hidden' && item.getClientRects().length > 0;
    });
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
      event.preventDefault();
      first?.focus();
    }
  }

  function submit() {
    const next = value.trim();
    if (next) onSave(next);
  }
</script>

{#if open}
  <div class="modal-backdrop" role="presentation" onclick={onClose}>
    <div bind:this={dialog} class="modal" role="dialog" aria-modal="true" aria-label={title} tabindex="-1" onclick={(event) => event.stopPropagation()} onkeydown={handleKeydown}>
      <header><h2>{title}</h2><button type="button" aria-label="Close" onclick={onClose}>×</button></header>
      <form onsubmit={(event) => { event.preventDefault(); submit(); }}>
        <input bind:this={input} bind:value {placeholder} />
        <footer><button type="button" onclick={onClose}>Cancel</button><button class="primary" type="submit">Save</button></footer>
      </form>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: 1rem; background: rgb(0 0 0 / 35%); backdrop-filter: blur(6px); }
  .modal { width: min(420px, calc(100vw - 2rem)); overflow: hidden; border: 1px solid #e5e7eb; border-radius: 12px; background: #fff; box-shadow: 0 20px 60px rgb(0 0 0 / 18%); }
  header { display: flex; align-items: center; justify-content: space-between; padding: 1rem 1.1rem; border-bottom: 1px solid #e5e7eb; } h2 { margin: 0; font-size: 1rem; } header button { border: 0; background: transparent; font-size: 1.4rem; cursor: pointer; }
  form { display: grid; gap: 1rem; padding: 1.1rem; } input { width: 100%; box-sizing: border-box; border: 1px solid #a3a3a3; border-radius: 7px; padding: 0.65rem 0.75rem; font: inherit; } footer { display: flex; justify-content: flex-end; gap: 0.5rem; } footer button { border: 1px solid #d4d4d4; border-radius: 7px; background: #fff; padding: 0.55rem 0.8rem; font: inherit; cursor: pointer; } footer .primary { background: #171717; color: #fff; border-color: #171717; }
</style>
