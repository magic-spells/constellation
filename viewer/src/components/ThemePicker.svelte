<script lang="ts">
  import { theme, THEMES } from '../lib/state.svelte';

  let open = $state(false);
  const current = $derived(THEMES.find((t) => t.id === theme.current) ?? THEMES[0]);

  function pick(id: (typeof THEMES)[number]['id']) {
    theme.set(id);
    open = false;
  }
</script>

<div class="theme-picker">
  <button class="theme-btn" onclick={() => (open = !open)}>
    <span class="swatch" data-swatch={current.id}></span>
    {current.label}
  </button>
  {#if open}
    <button class="theme-backdrop" aria-label="close" onclick={() => (open = false)}></button>
    <div class="theme-menu">
      {#each THEMES as t}
        <button
          class="theme-opt"
          class:current={t.id === theme.current}
          onclick={() => pick(t.id)}
        >
          <span class="swatch" data-swatch={t.id}></span>
          {t.label}
        </button>
      {/each}
    </div>
  {/if}
</div>
