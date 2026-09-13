// packages/shell/src/lib/highlight.ts
// Syntax highlighting for rendered code/JSON. highlight.js core build with
// ONLY the languages the shell renders (json for schema/op blocks, xml+yaml
// for story code blobs, bash for curl examples) so the bundle stays lean. hljs
// escapes code content and emits <span class="hljs-*"> markup, so its output
// is {@html}-safe.
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

hljs.registerLanguage("json", json);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("bash", bash);

/** JSON-stringify `v` and highlight it as JSON (2-space pretty print). */
export function highlightJson(v: unknown): string {
  return hljs.highlight(JSON.stringify(v, null, 2), { language: "json" }).value;
}

/** Highlight a shell/curl command as bash. */
export function highlightBash(code: string): string {
  return hljs.highlight(code, { language: "bash" }).value;
}

/** Highlight a story code blob with auto-detection (xml/yaml only). */
export function highlightCode(code: string): string {
  return hljs.highlightAuto(code, ["xml", "yaml"]).value;
}