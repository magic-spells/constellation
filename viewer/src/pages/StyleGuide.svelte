<script lang="ts">
  import StyleTokens from '../components/StyleTokens.svelte';
  import Markdown from '../components/Markdown.svelte';
  import { plan } from '../lib/state.svelte';

  const ORDER = ['font', 'color', 'type-scale', 'spacing', 'radius', 'shadow', 'other'];

  const styleCards = $derived.by(() => {
    const cards = plan.byType.get('STYLE') ?? [];
    return [...cards].sort((a, b) => {
      const ai = ORDER.indexOf(String(a.frontmatter.category ?? 'other'));
      const bi = ORDER.indexOf(String(b.frontmatter.category ?? 'other'));
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.handle.localeCompare(b.handle);
    });
  });
</script>

<div class="style-guide" style="--c: var(--t-STYLE)">
  <h1>Style Guide</h1>
  {#each styleCards as card (card.handle)}
    <section class="sg-section">
      <h2><a href="#/card/{card.handle}">{card.name ?? card.handle}</a></h2>
      <StyleTokens {card} />
      {#if card.body.trim()}
        <div class="sg-body"><Markdown source={card.body} /></div>
      {/if}
    </section>
  {/each}
</div>
