<script lang="ts">
  import yaml from 'js-yaml';
  import Editable from '../components/Editable.svelte';
  import FmValue from '../components/FmValue.svelte';
  import Markdown from '../components/Markdown.svelte';
  import StatusPill from '../components/StatusPill.svelte';
  import { deleteCard, patchCard } from '../lib/api';
  import { renderMermaidBlocks } from '../lib/markdown';
  import { notice, plan, route, theme } from '../lib/state.svelte';
  import { isHandle, TYPE_META } from '../lib/types';

  let { handle }: { handle: string } = $props();

  const RESERVED = new Set(['name', 'kind', 'status', 'connections']);

  const card = $derived(plan.byHandle.get(handle));
  const meta = $derived(card ? TYPE_META[card.type] : undefined);
  const fields = $derived(
    card ? Object.entries(card.frontmatter).filter(([key]) => !RESERVED.has(key)) : [],
  );

  const ownConnections = $derived(
    new Set(
      Array.isArray(card?.frontmatter.connections)
        ? (card!.frontmatter.connections as string[])
        : [],
    ),
  );

  const neighborsByType = $derived.by(() => {
    const grouped = new Map<string, string[]>();
    for (const n of plan.neighbors.get(handle) ?? []) {
      const type = n.split('-')[0];
      if (!grouped.has(type)) grouped.set(type, []);
      grouped.get(type)!.push(n);
    }
    return [...grouped.entries()];
  });

  const constellationSrc = $derived.by(() => {
    const neighbors = plan.neighbors.get(handle) ?? [];
    if (neighbors.length < 2) return null;
    return ['flowchart LR', ...neighbors.map((n) => `  ${handle} --- ${n}`)].join('\n');
  });

  let diagramHost: HTMLElement | undefined = $state();
  $effect(() => {
    if (!diagramHost || !constellationSrc) return;
    diagramHost.innerHTML = `<div class="mermaid-block" data-src="${encodeURIComponent(constellationSrc)}"></div>`;
    theme.current; // re-tint diagrams when the theme switches
    void renderMermaidBlocks(diagramHost);
  });

  function patch(p: Parameters<typeof patchCard>[1]) {
    return patchCard(handle, { ...p, if_mtime: card?.mtime });
  }

  function isPrimitive(v: unknown) {
    return v === null || ['string', 'number', 'boolean'].includes(typeof v);
  }

  function parseYamlValue(raw: string): unknown {
    try {
      return yaml.load(raw) ?? null;
    } catch {
      notice.show('invalid YAML — not saved');
      return undefined;
    }
  }

  function saveField(key: string, raw: string) {
    const parsed = parseYamlValue(raw);
    if (parsed === undefined) return;
    void patch({ fields: { [key]: parsed } });
  }

  // ghost "+ field" — one input, "key: value"
  let addingField = $state(false);
  let fieldDraft = $state('');
  function saveNewField() {
    addingField = false;
    const colon = fieldDraft.indexOf(':');
    if (colon < 1) return;
    const key = fieldDraft.slice(0, colon).trim();
    const parsed = parseYamlValue(fieldDraft.slice(colon + 1).trim() || "''");
    fieldDraft = '';
    if (!key || parsed === undefined) return;
    void patch({ fields: { [key]: parsed } });
  }

  // ghost "+" connection
  let addingConn = $state(false);
  let connDraft = $state('');
  const connCandidates = $derived(
    plan.cards
      .map((c) => c.handle)
      .filter((h) => h !== handle && !(plan.neighbors.get(handle) ?? []).includes(h)),
  );
  function saveConnection() {
    const target = connDraft.trim().toUpperCase();
    addingConn = false;
    connDraft = '';
    if (!target) return;
    if (!isHandle(target) || !plan.byHandle.has(target)) {
      notice.show(`${target} is not an existing card`);
      return;
    }
    void patch({ connections: [...ownConnections, target] });
  }
  function removeConnection(target: string) {
    void patch({ connections: [...ownConnections].filter((h) => h !== target) });
  }

  // inline delete confirm
  let confirmingDelete = $state(false);
  async function confirmDelete() {
    const folder = meta?.folder ?? '';
    const result = await deleteCard(handle);
    if (result.ok) route.go(`/type/${folder}`);
  }
</script>

<div class="page">
  {#if !card || !meta}
    <p class="empty">No card with handle {handle}.</p>
  {:else}
    <div class="page-head" style="--c: var(--t-{card.type})">
      {#if plan.editable}
        <span class="head-actions">
          {#if confirmingDelete}
            <button class="quiet-action danger" onclick={confirmDelete}>delete?</button>
            <button class="quiet-action" onclick={() => (confirmingDelete = false)}>no</button>
          {:else}
            <button class="quiet-action" onclick={() => (confirmingDelete = true)}>delete</button>
          {/if}
        </span>
      {/if}
      <div class="handle">{card.handle}</div>
      <h1>
        <Editable
          value={card.name ?? ''}
          placeholder={card.handle}
          onsave={(v) => patch({ name: v.trim() || null })}
        >{card.name ?? card.handle}</Editable>
      </h1>
      <div class="meta">
        <StatusPill status={card.status} onpick={(s) => patch({ status: s })} />
        <span class="kind">
          <Editable
            mono
            value={card.kind ?? ''}
            placeholder="+ kind"
            onsave={(v) => patch({ kind: v.trim() || null })}
          />
        </span>
      </div>
    </div>

    {#if fields.length > 0 || plan.editable}
      <div class="section">
        <h3>Fields</h3>
        <div class="fm">
          {#each fields as [key, value] (key)}
            <div class="k">{key}</div>
            <div class="v">
              {#if isPrimitive(value)}
                <Editable
                  value={String(value ?? '')}
                  onsave={(raw) => saveField(key, raw)}
                ><FmValue {value} /></Editable>
              {:else}
                <Editable
                  multiline
                  mono
                  value={yaml.dump(value).trimEnd()}
                  onsave={(raw) => saveField(key, raw)}
                ><FmValue {value} /></Editable>
              {/if}
            </div>
          {/each}
          {#if plan.editable}
            <div class="k"></div>
            <div class="v">
              {#if addingField}
                <input
                  class="inline-edit mono"
                  placeholder="key: value"
                  bind:value={fieldDraft}
                  onblur={saveNewField}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') saveNewField();
                    if (e.key === 'Escape') { addingField = false; fieldDraft = ''; }
                  }}
                  {@attach (el) => el.focus()}
                />
              {:else}
                <button class="ghost" onclick={() => (addingField = true)}>+ field</button>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    {/if}

    <div class="section">
      {#if card.body.trim() || !plan.editable}
        <Editable
          multiline
          value={card.body}
          ignore="a, .mermaid-block"
          onsave={(body) => patch({ body })}
        ><Markdown source={card.body} /></Editable>
      {:else}
        <Editable
          multiline
          value=""
          placeholder="+ write something"
          onsave={(body) => patch({ body })}
        />
      {/if}
    </div>

    {#if neighborsByType.length > 0 || plan.editable}
      <div class="section">
        <h3>Connections</h3>
        {#each neighborsByType as [type, handles]}
          <div class="conn-group">
            <span class="t">{TYPE_META[type]?.label ?? type}</span>
            <span>
              {#each handles as n}
                <span class="chip-wrap" style="--c: var(--t-{type})">
                  <a class="chip" href="#/card/{n}"><span class="star">✦</span>{n}</a>
                  {#if plan.editable && ownConnections.has(n)}
                    <button class="chip-x" title="remove connection" onclick={() => removeConnection(n)}>×</button>
                  {/if}
                </span>
              {/each}
            </span>
          </div>
        {/each}
        {#if plan.editable}
          <div class="conn-group">
            <span class="t"></span>
            {#if addingConn}
              <input
                class="inline-edit mono"
                placeholder="HANDLE…"
                list="conn-candidates-{handle}"
                bind:value={connDraft}
                onblur={saveConnection}
                onkeydown={(e) => {
                  if (e.key === 'Enter') saveConnection();
                  if (e.key === 'Escape') { addingConn = false; connDraft = ''; }
                }}
                {@attach (el) => el.focus()}
              />
              <datalist id="conn-candidates-{handle}">
                {#each connCandidates as c}<option value={c}></option>{/each}
              </datalist>
            {:else}
              <button class="ghost" onclick={() => (addingConn = true)}>+ connect</button>
            {/if}
          </div>
        {/if}
      </div>
    {/if}

    {#if constellationSrc}
      <div class="section">
        <h3>Neighborhood</h3>
        <div bind:this={diagramHost}></div>
      </div>
    {/if}
  {/if}
</div>
