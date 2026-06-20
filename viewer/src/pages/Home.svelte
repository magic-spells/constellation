<script lang="ts">
  import ConnectedRepos from '../components/ConnectedRepos.svelte';
  import Editable from '../components/Editable.svelte';
  import Markdown from '../components/Markdown.svelte';
  import { patchCard } from '../lib/api';
  import { relTime, SYNC_META } from '../lib/format';
  import { plan } from '../lib/state.svelte';
  import { GROUPS, TYPE_META } from '../lib/types';

  const planCard = $derived(plan.byHandle.get('PLAN-PROJECT'));
  const connectedRepos = $derived.by(() => {
    const raw = planCard?.frontmatter?.connected_repos;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
      .map((e) => ({
        name: String(e.name ?? ''),
        path: String(e.path ?? ''),
        description: typeof e.description === 'string' ? e.description : undefined,
      }))
      .filter((e) => e.name && e.path);
  });
  const sync = $derived(plan.sync);
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
  {#if sync && sync.state !== 'no-git'}
    <section class="sync-dash">
      <div class="sd-head {sync.state}">
        <span class="sd-dot"></span>
        <span class="sd-state">{SYNC_META[sync.state].label}</span>
        <span class="sd-meta">
          {#if sync.marker}last synced {relTime(sync.marker.synced_at)}{:else}no sync point yet{/if}
          {#if sync.state === 'drifted'}
            {#if sync.marker_error}
              · {sync.marker_error}
            {:else}
              · {sync.code_commits_since_marker} code commit{sync.code_commits_since_marker === 1 ? '' : 's'} / {sync.plan_changes_since_marker} plan change{sync.plan_changes_since_marker === 1 ? '' : 's'} since
            {/if}
          {/if}
          {#if sync.plan_dirty} · uncommitted plan edits{/if}
        </span>
      </div>
      {#if sync.activity.length}
        <ul class="activity">
          {#each sync.activity as a}
            <li class:sync={a.is_sync_point}>
              <span class="ac-when">{relTime(a.date)}</span>
              <span class="ac-subject">{a.subject}</span>
              {#if a.is_sync_point}<span class="ac-tag">sync</span>{/if}
              {#if a.cards.length}
                <span class="ac-cards">
                  {#each a.cards.slice(0, 4) as h}<a class="ac-card" href="#/card/{h}">{h}</a>{/each}
                  {#if a.cards.length > 4}<span class="ac-more">+{a.cards.length - 4}</span>{/if}
                </span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}

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

  <ConnectedRepos repos={connectedRepos} />

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
