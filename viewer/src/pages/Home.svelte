<script lang="ts">
  import Editable from '../components/Editable.svelte';
  import Markdown from '../components/Markdown.svelte';
  import { patchCard } from '../lib/api';
  import { plan } from '../lib/state.svelte';
  import { GROUPS, TYPE_META } from '../lib/types';

  const planCard = $derived(plan.byHandle.get('PLAN-PROJECT'));
  const tiles = $derived(
    GROUPS.flatMap((group) =>
      Object.entries(TYPE_META)
        .filter(([, meta]) => meta.group === group)
        .map(([type, meta]) => ({
          type,
          meta,
          count: plan.byType.get(type)?.length ?? 0,
        }))
        .filter((t) => t.count > 0),
    ),
  );
</script>

<div class="page">
  <div class="stats">
    <div class="stat"><span class="n">{plan.cards.length}</span><span class="label">cards</span></div>
    <div class="stat"><span class="n">{plan.connections.length}</span><span class="label">connections</span></div>
    <div class="stat" class:bad={plan.errors.length > 0} class:good={plan.errors.length === 0}>
      <span class="n">{plan.errors.length === 0 ? '✓' : plan.errors.length}</span>
      <span class="label">{plan.errors.length === 0 ? 'integrity' : 'errors'}</span>
    </div>
    {#if plan.warnings.length > 0}
      <div class="stat"><span class="n">{plan.warnings.length}</span><span class="label">warnings</span></div>
    {/if}
  </div>

  {#if planCard}
    <Editable
      multiline
      value={planCard.body}
      ignore="a, .mermaid-block"
      onsave={(body) =>
        patchCard('PLAN-PROJECT', { body, if_mtime: planCard.mtime })}
    ><Markdown source={planCard.body} /></Editable>
  {:else}
    <p class="empty">No plan.md yet — run `constellation init`.</p>
  {/if}

  <div class="section">
    <h3>Browse</h3>
    <div class="tiles">
      {#each tiles as { type, meta, count }, i}
        <a class="tile" href="#/type/{meta.folder}" style="--c: var(--t-{type}); --i: {i}">
          <span class="star">✦</span><span class="t-label">{meta.label}</span>
          <span class="t-count">{count} card{count === 1 ? '' : 's'}</span>
        </a>
      {/each}
    </div>
  </div>
</div>
