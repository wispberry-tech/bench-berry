<!-- Svelte 5 story convention (see design doc §4.6 v2): the story file's
     default export is implicit (the component itself); preview props come
     through $props; meta/scenarios live in a <script module> block. -->
<script>
  let { label = 'Click me', variant = 'primary' } = $props();
</script>

<button class="{variant}">{label}</button>

<script module>
  export const meta = {
    title: "Button",
    "description": "Primary action trigger.",
    "props": { "label": "Click me", "variant": "primary" },
    "schema": {
      "label": { "type": "string" },
      "variant": { "type": "enum", "options": ["primary", "secondary", "ghost"] }
    },
    "code": "<Button variant=\"primary\">Click me</Button>"
  };
  export const scenarios = [{ "name": "Empty", "props": { "label": "" } }];
</script>

<style>
  .btn {
    padding: 0.5rem 1rem;
  }
</style>