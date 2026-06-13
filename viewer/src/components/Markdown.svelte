<script lang="ts">
  import { renderMarkdown, renderMermaidBlocks } from '../lib/markdown';
  import { theme } from '../lib/state.svelte';

  let { source }: { source: string } = $props();

  let container: HTMLElement | undefined = $state();
  const html = $derived(renderMarkdown(source));

  $effect(() => {
    if (!container) return;
    html;
    theme.current; // re-tint diagrams when the theme switches
    void renderMermaidBlocks(container);
  });
</script>

<div class="md" bind:this={container}>
  <!-- eslint-disable-next-line svelte/no-at-html-tags — local trusted plan files -->
  {@html html}
</div>
