<script lang="ts">
  import { plan, route } from '../lib/state.svelte';
  import { GROUPS, TYPE_META } from '../lib/types';

  let { activeFolder }: { activeFolder: string | null } = $props();

  const groups = $derived(
    GROUPS.map((group) => ({
      group,
      types: Object.entries(TYPE_META)
        .filter(([, meta]) => meta.group === group)
        .map(([type, meta]) => ({
          type,
          meta,
          count: plan.byType.get(type)?.length ?? 0,
        }))
        .filter((entry) => entry.count > 0),
    })).filter((g) => g.types.length > 0),
  );
</script>

<nav class="sidenav">
  <a class="nav-home" class:active={route.path === '/'} href="#/">
    <span class="star">✦</span> Overview
  </a>
  <a
    class="nav-home"
    class:active={route.path === '/constellation'}
    href="#/constellation"
  >
    <span class="star">⁂</span> Constellation
  </a>
  {#each groups as { group, types }}
    <div class="nav-group">
      <h4>{group}</h4>
      {#each types as { type, meta, count }}
        <a
          href="#/type/{meta.folder}"
          class:active={activeFolder === meta.folder}
          style="--c: var(--t-{type})"
        >
          <span class="star">✦</span>
          <span class="nav-label">{meta.label}</span>
          <span class="count">{count}</span>
        </a>
      {/each}
    </div>
  {/each}
</nav>
