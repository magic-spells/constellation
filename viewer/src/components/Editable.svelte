<script lang="ts">
  import type { Snippet } from 'svelte';
  import { plan } from '../lib/state.svelte';

  let {
    value = '',
    multiline = false,
    mono = false,
    placeholder = 'empty — click to edit',
    ignore = 'a',
    onsave,
    children,
  }: {
    value?: string;
    multiline?: boolean;
    mono?: boolean;
    placeholder?: string;
    /** Selector for click targets that should NOT start editing (links etc). */
    ignore?: string;
    onsave: (next: string) => void | Promise<void>;
    children?: Snippet;
  } = $props();

  let editing = $state(false);
  let draft = $state('');
  let el: HTMLInputElement | HTMLTextAreaElement | undefined = $state();

  function begin(event?: Event) {
    if (event && (event.target as HTMLElement).closest(ignore)) return;
    draft = value;
    editing = true;
  }

  $effect(() => {
    if (editing && el) {
      el.focus();
      autosize();
      if (el instanceof HTMLTextAreaElement) {
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }
  });

  function autosize() {
    if (el instanceof HTMLTextAreaElement) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight + 2}px`;
    }
  }

  function commit() {
    if (!editing) return;
    editing = false;
    if (draft !== value) void onsave(draft);
  }

  function cancel() {
    editing = false;
  }

  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    } else if (
      event.key === 'Enter' &&
      (!multiline || event.metaKey || event.ctrlKey)
    ) {
      event.preventDefault();
      commit();
    }
  }
</script>

{#if !plan.editable}
  <span class="editable-static" class:block={multiline}>
    {#if children}{@render children()}{:else}{value}{/if}
  </span>
{:else if editing}
  {#if multiline}
    <span class="editing-wrap block">
      <textarea
        bind:this={el}
        bind:value={draft}
        class="inline-edit"
        class:mono
        onblur={commit}
        onkeydown={keydown}
        oninput={autosize}
      ></textarea>
      <span class="edit-hint">⌘↩ save · esc cancel</span>
    </span>
  {:else}
    <input
      bind:this={el}
      bind:value={draft}
      class="inline-edit"
      class:mono
      onblur={commit}
      onkeydown={keydown}
      {placeholder}
    />
  {/if}
{:else}
  <span
    class="editable"
    class:block={multiline}
    role="button"
    tabindex="0"
    onclick={begin}
    onkeydown={(e) => e.key === 'Enter' && begin()}
  >
    {#if children}{@render children()}{:else if value}{value}{:else}<span class="editable-empty">{placeholder}</span>{/if}
  </span>
{/if}
