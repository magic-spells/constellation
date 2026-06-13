<script lang="ts">
  import FmValue from './FmValue.svelte';
  import { isHandle } from '../lib/types';

  let { value }: { value: unknown } = $props();

  const isPrimitive = (v: unknown) =>
    v === null || ['string', 'number', 'boolean'].includes(typeof v);

  const isObjectArray = $derived(
    Array.isArray(value) && value.length > 0 && value.every((v) => v && typeof v === 'object' && !Array.isArray(v)),
  );

  const tableKeys = $derived.by(() => {
    if (!isObjectArray) return [];
    const keys: string[] = [];
    for (const row of value as Record<string, unknown>[]) {
      for (const key of Object.keys(row)) if (!keys.includes(key)) keys.push(key);
    }
    return keys;
  });

  function chipType(handle: string): string {
    return handle.split('-')[0];
  }
</script>

{#if typeof value === 'string'}
  {#if isHandle(value)}
    <a class="chip" href="#/card/{value}" style="--c: var(--t-{chipType(value)})">
      <span class="star">✦</span>{value}
    </a>
  {:else}
    {value}
  {/if}
{:else if typeof value === 'number' || typeof value === 'boolean'}
  <code>{String(value)}</code>
{:else if value === null || value === undefined}
  <code>—</code>
{:else if isObjectArray}
  <table class="fm-table">
    <thead>
      <tr>{#each tableKeys as key}<th>{key}</th>{/each}</tr>
    </thead>
    <tbody>
      {#each value as Record<string, unknown>[] as row}
        <tr>
          {#each tableKeys as key}
            <td class:muted={row[key] === undefined}>
              {#if row[key] === undefined}·{:else}<FmValue value={row[key]} />{/if}
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
{:else if Array.isArray(value)}
  {#each value as item, i}{#if i > 0},&nbsp;{/if}<FmValue value={item} />{/each}
{:else}
  <div class="fm-nested">
    {#each Object.entries(value as Record<string, unknown>) as [key, nested]}
      <div><span class="k">{key}</span>&nbsp; <FmValue value={nested} /></div>
    {/each}
  </div>
{/if}
