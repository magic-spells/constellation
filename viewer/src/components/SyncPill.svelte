<script lang="ts">
  import { plan } from '../lib/state.svelte';
  import { relTime, SYNC_META } from '../lib/format';

  const sync = $derived(plan.sync);

  const detail = $derived.by(() => {
    if (!sync) return '';
    if (sync.state === 'drifted') {
      const parts: string[] = [];
      const c = sync.code_commits_since_marker;
      const p = sync.plan_changes_since_marker;
      if (c > 0) parts.push(`${c} commit${c === 1 ? '' : 's'} behind`);
      if (p > 0) parts.push(`${p} card${p === 1 ? '' : 's'} ahead`);
      return parts.join(' · ');
    }
    if (sync.state === 'in-sync' && sync.marker) return relTime(sync.marker.synced_at);
    return '';
  });
</script>

{#if sync && sync.state !== 'no-git'}
  <a
    class="sync-pill {sync.state}"
    href="#/"
    title="Plan freshness — derived live from git. Click for the activity dashboard."
  >
    <span class="sp-icon">{SYNC_META[sync.state].icon}</span>
    <span class="sp-label">{SYNC_META[sync.state].label}</span>
    {#if detail}<span class="sp-detail">{detail}</span>{/if}
  </a>
{/if}
