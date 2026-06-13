<script lang="ts">
  import { createCard } from '../lib/api';
  import { notice, plan, route } from '../lib/state.svelte';
  import { TYPE_META, typeByFolder } from '../lib/types';

  let { folder, activeHandle }: { folder: string; activeHandle: string | null } =
    $props();

  const type = $derived(typeByFolder(folder));
  const meta = $derived(type ? TYPE_META[type] : undefined);
  const cards = $derived(
    type
      ? [...(plan.byType.get(type) ?? [])].sort((a, b) =>
          a.handle.localeCompare(b.handle),
        )
      : [],
  );

  let filter = $state('');
  const shown = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter(
      (c) =>
        c.handle.toLowerCase().includes(q) ||
        (c.name ?? '').toLowerCase().includes(q),
    );
  });

  // Reset the filter when switching types.
  $effect(() => {
    folder;
    filter = '';
  });

  let creating = $state(false);
  let draft = $state('');
  async function saveNew() {
    const namePart = draft.trim().toUpperCase().replace(/\s+/g, '-');
    creating = false;
    draft = '';
    if (!namePart || !type) return;
    if (!/^[A-Z0-9][A-Z0-9-]*$/.test(namePart)) {
      notice.show('handle may only contain A–Z, 0–9, and dashes');
      return;
    }
    const handle = `${type}-${namePart}`;
    const result = await createCard({ handle });
    if (result.ok) route.go(`/card/${handle}`);
  }
</script>

<aside class="cardlist" style="--c: var(--t-{type})">
  {#if meta}
    <div class="cardlist-head">
      <div class="cardlist-title">
        <span class="star">✦</span>
        <span class="label">{meta.label}</span>
        <span class="count">{cards.length}</span>
      </div>
      <input
        class="cardlist-filter"
        placeholder="Filter…"
        bind:value={filter}
        spellcheck="false"
      />
    </div>

    <div class="cardlist-scroll">
      {#each shown as card (card.handle)}
        <a
          class="list-row"
          class:active={card.handle === activeHandle}
          href="#/card/{card.handle}"
        >
          <span class="lr-main">
            <span class="lr-name">{card.name ?? card.handle}</span>
            <span class="lr-handle">{card.handle}</span>
          </span>
          {#if card.status}<span class="dot {card.status}" title={card.status}></span>{/if}
        </a>
      {:else}
        <p class="empty sm">{filter ? 'No matches' : 'Nothing here yet'}</p>
      {/each}

      {#if plan.editable}
        {#if creating}
          <div class="list-row ghost">
            <span class="lr-prefix">{type}-</span>
            <input
              class="inline-edit mono"
              placeholder="NAME"
              bind:value={draft}
              onblur={saveNew}
              onkeydown={(e) => {
                if (e.key === 'Enter') saveNew();
                if (e.key === 'Escape') { creating = false; draft = ''; }
              }}
              {@attach (el) => el.focus()}
            />
          </div>
        {:else}
          <button class="list-row ghost" onclick={() => (creating = true)}>
            + new {meta.label.toLowerCase().replace(/s$/, '')}
          </button>
        {/if}
      {/if}
    </div>
  {/if}
</aside>
