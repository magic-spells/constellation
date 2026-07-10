<script lang="ts">
  import { relTime } from '../lib/format';
  import { plan } from '../lib/state.svelte';
  import type { Card } from '../lib/types';

  // "Shipped" = merged or better; everything else (planned/building/no status)
  // is future work. Each section sorts by file mtime, freshest edit first.
  const SHIPPED = new Set(['built', 'verified']);

  const features = $derived(
    [...(plan.byType.get('FEATURE') ?? [])].sort((a, b) => b.mtime - a.mtime),
  );
  const upNext = $derived(features.filter((c) => !SHIPPED.has(c.status ?? '')));
  const shipped = $derived(features.filter((c) => SHIPPED.has(c.status ?? '')));

  function str(card: Card, key: string): string | null {
    const v = card.frontmatter?.[key];
    return typeof v === 'string' && v ? v : null;
  }
  const isUrl = (v: string) => /^https?:\/\//.test(v);
</script>

{#snippet section(title: string, cards: Card[])}
  <section class="feat-section">
    <h3>{title} <span class="feat-count">{cards.length}</span></h3>
    {#each cards as card (card.handle)}
      {@const release = str(card, 'release')}
      {@const branch = str(card, 'branch')}
      {@const pr = str(card, 'pr')}
      <div class="feat-row">
        <a class="feat-main" href="#/card/{card.handle}">
          <span class="feat-name">{card.name ?? card.handle}</span>
          <span class="feat-handle">{card.handle}</span>
        </a>
        <span class="feat-meta">
          {#if release}
            <a class="feat-chip" style="--c: var(--t-RELEASE)" href="#/card/{release}">✦ {release}</a>
          {/if}
          {#if branch}<span class="feat-chip mono">⎇ {branch}</span>{/if}
          {#if pr}
            {#if isUrl(pr)}
              <a class="feat-chip mono" href={pr} target="_blank" rel="noopener noreferrer">PR ↗</a>
            {:else}
              <span class="feat-chip mono">PR {pr}</span>
            {/if}
          {/if}
          {#if card.status}<span class="pill {card.status}">{card.status}</span>{/if}
          <span class="feat-when">{relTime(card.mtime)}</span>
        </span>
      </div>
    {:else}
      <p class="empty sm">Nothing here yet.</p>
    {/each}
  </section>
{/snippet}

<div class="page">
  <h2 class="feat-title" style="--c: var(--t-FEATURE)"><span class="star">✦</span> Features</h2>
  {#if features.length === 0}
    <p class="empty">
      No FEATURE cards yet. A FEATURE groups a coherent slice of future work —
      create one in <code>feature/FEATURE-*.md</code>, connect the cards it
      touches, and it shows up here.
    </p>
  {:else}
    {@render section('Up next', upNext)}
    {#if shipped.length > 0}
      {@render section('Shipped', shipped)}
    {/if}
  {/if}
</div>
