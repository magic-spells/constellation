<script lang="ts">
  import Nav from './components/Nav.svelte';
  import CardList from './components/CardList.svelte';
  import ThemePicker from './components/ThemePicker.svelte';
  import SyncPill from './components/SyncPill.svelte';
  import CardPage from './pages/CardPage.svelte';
  import Home from './pages/Home.svelte';
  import TypeIntro from './pages/TypeIntro.svelte';
  import ConstellationView from './pages/ConstellationView.svelte';
  import { notice, plan, route } from './lib/state.svelte';
  import { TYPE_META } from './lib/types';

  plan.load();
  plan.listen();

  const segments = $derived(route.path.split('/').filter(Boolean));
  const planCard = $derived(plan.byHandle.get('PLAN-PROJECT'));

  // The project name (plan.md's `name:`) drives the browser tab title too, not just
  // the header — falling back to the product name when the plan is unnamed.
  $effect(() => {
    document.title = planCard?.name ? `${planCard.name} · Constellation` : 'Constellation';
  });

  // The active type folder and card are derived from the URL. A /card/HANDLE
  // route still resolves its folder, so col2 shows the card's siblings.
  const activeHandle = $derived(
    segments[0] === 'card' && segments[1] ? segments[1] : null,
  );
  const activeFolder = $derived.by(() => {
    if (segments[0] === 'type' && segments[1]) return segments[1];
    if (activeHandle) return TYPE_META[activeHandle.split('-')[0]]?.folder ?? null;
    return null;
  });
  const atHome = $derived(segments.length === 0);
  const atConstellation = $derived(segments[0] === 'constellation');

  // Convert a legacy path-style URL (/type/plan) into a hash URL on load, so old
  // links and manual edits resolve instead of showing a blank page.
  if (location.pathname !== '/' && !location.hash) {
    history.replaceState(null, '', '/#' + location.pathname + location.search);
    route.sync();
  }
</script>

<svelte:window onhashchange={() => route.sync()} />

<div class="app">
  <header class="topbar">
    <a class="brand" href="#/">
      {#if planCard?.name}
        <span class="project">{planCard.name}</span>
        <span class="star">✦</span>
        <span class="wordmark">Constellation</span>
      {:else}
        <span class="star">✦</span>
        <span class="project">Constellation</span>
      {/if}
    </a>
    <span class="spacer"></span>
    <SyncPill />
    <ThemePicker />
  </header>

  <div class="panes">
    <Nav {activeFolder} />

    {#if plan.loaded && activeFolder}
      <CardList folder={activeFolder} {activeHandle} />
    {/if}

    <main class="detail" class:wide={atHome} class:full={atConstellation}>
      {#if !plan.loaded}
        <div class="loading">reading the plan…</div>
      {:else if atConstellation}
        <ConstellationView />
      {:else if atHome}
        <div class="detail-inner"><Home /></div>
      {:else if activeHandle}
        {#key activeHandle}
          <div class="detail-inner"><CardPage handle={activeHandle} /></div>
        {/key}
      {:else if activeFolder}
        <div class="detail-inner"><TypeIntro folder={activeFolder} /></div>
      {:else}
        <div class="detail-inner"><p class="empty">Nothing at {route.path}</p></div>
      {/if}
    </main>
  </div>
</div>

{#if notice.text}
  <div class="statusline">{notice.text}</div>
{/if}
