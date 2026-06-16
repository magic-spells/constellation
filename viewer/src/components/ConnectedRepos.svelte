<script lang="ts">
  interface RepoEntry {
    name: string;
    path: string;
    description?: string;
  }
  let { repos }: { repos: RepoEntry[] } = $props();
</script>

{#if repos.length > 0}
  <div class="section">
    <h3>Connected repos</h3>
    <div class="repos">
      {#each repos as r, i}
        <div class="repo" style="--i: {i}">
          <span class="r-name">{r.name}</span>
          <code class="r-path">{r.path}</code>
          {#if r.description}<span class="r-desc">{r.description}</span>{/if}
        </div>
      {/each}
    </div>
    <p class="repos-note">
      Separate plans — open each repo's own viewer to browse it.
    </p>
  </div>
{/if}
