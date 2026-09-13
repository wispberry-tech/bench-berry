<!-- Svelte 5 component scaffolded by `berrybench init` (story convention §4.6 v2). -->
<script>
  let { label = 'Click me', variant = 'primary' } = $props();
</script>

<button class="btn {variant}" type="button">{label}</button>

<style>
  .btn {
    padding: 0.5rem 1rem;
    border-radius: 6px;
    border: 1px solid var(--v-border, #d0d7de);
    background: var(--v-surface, #ffffff);
    cursor: pointer;
  }
  .btn.primary {
    border-color: transparent;
    background: var(--v-accent, #4f46e5);
    color: #ffffff;
  }
</style>