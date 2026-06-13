<script lang="ts">
  import { plan } from '../lib/state.svelte';
  import { TYPE_META, typeByFolder } from '../lib/types';

  let { folder }: { folder: string } = $props();

  const type = $derived(typeByFolder(folder));
  const meta = $derived(type ? TYPE_META[type] : undefined);
  const count = $derived(type ? (plan.byType.get(type)?.length ?? 0) : 0);
</script>

<div class="type-intro" style="--c: var(--t-{type})">
  {#if meta}
    <span class="ti-star star">✦</span>
    <h2>{meta.label}</h2>
    <p class="ti-count">{count} card{count === 1 ? '' : 's'}</p>
    <p class="ti-hint">Select a card from the list to view it.</p>
  {:else}
    <p class="empty">Unknown type: {folder}</p>
  {/if}
</div>
