<!-- Svelte 5 story convention (see design doc §4.6 v2): the story file's
     default export is implicit (the component itself); preview props come
     through $props; meta/scenarios live in a <script module> block. The meta
     object uses an unquoted `title:` key and quoted JSON keys for every other
     field so the ws-design extractor can parse each literal. -->
<script>
  import Button from './button.svelte';
  let { label = 'Click me', variant = 'primary' } = $props();
</script>

<Button {label} {variant} />

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