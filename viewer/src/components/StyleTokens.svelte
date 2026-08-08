<script lang="ts">
  import type { Card } from '../lib/types';

  let { card }: { card: Card } = $props();

  interface Token {
    name: string;
    value: string;
    description?: string;
    role?: string;
    weights?: string;
    src?: string;
    line_height?: string;
    weight?: string;
    sample?: string;
  }

  const CATEGORIES = ['font', 'color', 'type-scale', 'spacing', 'radius', 'shadow', 'other'];

  const category = $derived.by(() => {
    const c = card.frontmatter.category;
    return typeof c === 'string' && CATEGORIES.includes(c) ? c : 'other';
  });

  const tokens = $derived.by(() => {
    const t = card.frontmatter.tokens;
    if (!Array.isArray(t)) return [] as Token[];
    return t.filter(
      (x): x is Token =>
        !!x && typeof x === 'object' &&
        typeof (x as Token).name === 'string' &&
        typeof (x as Token).value === 'string',
    );
  });

  // Real-font specimens: tokens with src get an @font-face registered under the
  // token name, served by /api/style-asset. The stack falls back to the declared value.
  const fontFaces = $derived(
    category === 'font'
      ? tokens
          .filter((t) => t.src)
          .map(
            (t) =>
              `@font-face { font-family: "cst-${t.name}"; src: url("/api/style-asset?path=${encodeURIComponent(t.src!)}"); }`,
          )
          .join('\n')
      : '',
  );

  function fontStack(t: Token): string {
    return t.src ? `"cst-${t.name}", ${t.value}` : t.value;
  }

  // spacing bars scale relative to the largest token so the biggest step spans the row
  const maxSpacing = $derived.by(() => {
    const px = tokens.map((t) => parseFloat(t.value) || 0);
    return Math.max(...px, 1);
  });

  const SPECIMEN_ROWS = [
    ['Uppercase', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'],
    ['Lowercase', 'abcdefghijklmnopqrstuvwxyz'],
    ['Numbers', '0123456789'],
    ['Characters', "!@#\$%^&*()_+-=[]{}|;:',./<>?"],
  ];
</script>

{#if tokens.length > 0}
  {#if fontFaces}
    <svelte:element this={'style'}>{fontFaces}</svelte:element>
  {/if}

  <div class="style-tokens style-{category}">
    {#if category === 'color'}
      <div class="swatch-grid">
        {#each tokens as t, i (i)}
          <div class="swatch">
            <div class="swatch-chip" style="background: {t.value}"></div>
            <div class="swatch-name">{t.name}</div>
            <div class="swatch-value">{t.value}</div>
            {#if t.description}<div class="token-desc">{t.description}</div>{/if}
          </div>
        {/each}
      </div>
    {:else if category === 'font'}
      <div class="specimen-grid">
        {#each tokens as t, i (i)}
          <div class="specimen">
            {#if t.role}<div class="specimen-role">{t.role}</div>{/if}
            <div class="specimen-name" style="font-family: {fontStack(t)}">{t.name}</div>
            {#if t.weights}<div class="specimen-weights">{t.weights}</div>{/if}
            {#each SPECIMEN_ROWS as [label, chars]}
              <div class="specimen-row">
                <div class="specimen-label">{label}</div>
                <div class="specimen-chars" style="font-family: {fontStack(t)}">{chars}</div>
              </div>
            {/each}
            {#if t.description}<div class="token-desc">{t.description}</div>{/if}
          </div>
        {/each}
      </div>
    {:else if category === 'type-scale'}
      {#each tokens as t, i (i)}
        <div class="scale-row">
          <div class="token-label">{t.name} · {t.value}{t.weight ? ` · ${t.weight}` : ''}</div>
          <div
            style="font-size: {t.value}; font-weight: {t.weight ?? 'inherit'}; line-height: {t.line_height ?? 'normal'}"
          >{t.sample ?? 'The quick brown fox jumps over the lazy dog'}</div>
        </div>
      {/each}
    {:else if category === 'spacing'}
      {#each tokens as t, i (i)}
        <div class="spacing-row">
          <div class="token-label">{t.name} · {t.value}</div>
          <div class="spacing-bar" style="width: {(100 * (parseFloat(t.value) || 0)) / maxSpacing}%"></div>
        </div>
      {/each}
    {:else if category === 'radius'}
      <div class="radius-grid">
        {#each tokens as t, i (i)}
          <div class="radius-item">
            <div class="radius-box" style="border-radius: {t.value}"></div>
            <div class="token-label">{t.name} · {t.value}</div>
          </div>
        {/each}
      </div>
    {:else if category === 'shadow'}
      <div class="shadow-grid">
        {#each tokens as t, i (i)}
          <div class="shadow-item">
            <div class="shadow-box" style="box-shadow: {t.value}"></div>
            <div class="token-label">{t.name}</div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="token-table">
        {#each tokens as t, i (i)}
          <div class="k">{t.name}</div>
          <div class="v">{t.value}{t.description ? ` — ${t.description}` : ''}</div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
