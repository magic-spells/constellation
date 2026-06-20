<script lang="ts">
  import { plan } from '../lib/state.svelte';

  const STATUSES = ['planned', 'building', 'built', 'verified'];

  let {
    status,
    onpick,
  }: {
    status: string | null;
    onpick: (next: string | null) => void | Promise<unknown>;
  } = $props();

  let open = $state(false);

  function pick(next: string) {
    open = false;
    if (next !== status) void onpick(next);
  }
</script>

{#if !plan.editable}
  {#if status}<span class="pill {status}">{status}</span>{/if}
{:else if open}
  <span class="pill-row">
    {#each STATUSES as option}
      <button
        class="pill {option} pick"
        class:current={option === status}
        onclick={() => pick(option)}
      >{option}</button>
    {/each}
    <button class="pill ghost-pill" onclick={() => (open = false)}>esc</button>
  </span>
{:else if status}
  <button class="pill {status} clickable" onclick={() => (open = true)}>{status}</button>
{:else}
  <button class="pill ghost-pill" onclick={() => (open = true)}>+ status</button>
{/if}
