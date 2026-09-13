import type { ProjectContext, WorkspacePlugin } from "../core/workspace.ts";
import { expandGlob } from "@std/fs";
import { join, relative, resolve } from "@std/path";

/** One scenario of a story: a named props override (contract §4.6). */
export type StoryScenario = { name: string; props: Record<string, unknown> };

/** Meta extracted from a `*.story.{svelte,tsx}` file (contract §4.6). */
export interface DesignStory {
  file: string;
  title?: string;
  description?: string;
  props?: Record<string, unknown>;
  schema?: Record<string, unknown>;
  code?: string;
  scenarios?: StoryScenario[];
}

export interface DesignSnapshot {
  packageName?: string;
  version?: string;
  /** Design package dir relative to the project root ('.' for root, else 'frontend' & co). */
  srcRoot?: string;
  stories: DesignStory[];
}

const STORY_PATTERNS = ["src/**/*.story.svelte", "src/**/*.story.tsx"] as const;

/** Candidate dirs for the design package, probed in order (root first). */
const DESIGN_DIRS = [".", "frontend", "web", "ui", "app", "client"] as const;

/**
 * Where the design package lives: the first DESIGN_DIRS entry holding a
 * package.json, else undefined. Lets monorepos (Go backend + frontend/ web
 * app) get their component library found without forcing a root package.json.
 */
export async function designRootOf(root: string): Promise<string | undefined> {
  for (const dir of DESIGN_DIRS) {
    const candidate = join(root, dir);
    try {
      const stat = await Deno.stat(join(candidate, "package.json"));
      if (stat.isFile) return candidate;
    } catch {
      // Absent package.json: keep probing.
    }
  }
  return undefined;
}

/** First `title:` literal found in the first 2000 chars of a story file. */
const TITLE_RE = /title:\s*['"]([^'"]+)['"]/;

// Extraction caps (contract §4.6): description at 2000 chars, code at 8000. They
// mirror the title's fixed 2000-char scan window so one huge literal can't
// bloat snapshots; both are hard truncations of the extracted value.
const DESCRIPTION_MAX = 2000;
const CODE_MAX = 8000;

/** Plain-object guard; no canonical export exists in this package's graph. */
function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Best-effort JSON.parse; undefined on any failure (never throws). */
function tryParseJson(lit: string): unknown {
  try {
    return JSON.parse(lit);
  } catch {
    return undefined;
  }
}

/**
 * Value of the first `key: '…' | "…" | `…`` literal in `text`, tolerating
 * either unquoted (`props:`) or quoted (`"props":`) keys. Scans past escaped
 * same-quote chars (`\'`, `\"`, `` \` ``) and emits the bare delimiter; an
 * unterminated literal yields undefined.
 */
function quotedValue(text: string, key: string): string | undefined {
  const m = new RegExp(`["']?${key}["']?\\s*:\\s*(['"\`])`).exec(text);
  if (m === null) return undefined;
  const quote = m[1]!;
  let out = "";
  for (let i = m.index + m[0].length; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\\") {
      const next = text[i + 1];
      if (next === quote) {
        out += quote;
        i++;
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === quote) return out;
    out += ch;
  }
  return undefined;
}

/**
 * Balanced `{…}`/`[…]` literal starting right after `keyRe`, or undefined when
 * the scan starts on neither bracket or never closes. Strings inside are
 * skipped so braces/brackets in string values can't unbalance the scan.
 */
function literalAfter(text: string, keyRe: RegExp): string | undefined {
  const m = keyRe.exec(text);
  if (m === null) return undefined;
  let i = m.index + m[0].length;
  while (i < text.length && /\s/.test(text[i]!)) i++;
  const open = text[i];
  if (open !== "{" && open !== "[") return undefined;
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  for (; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      const q = ch;
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "\\") {
          j += 2;
          continue;
        }
        if (text[j] === q) break;
        j++;
      }
      i = j;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(m.index + m[0].length, i + 1);
    }
  }
  return undefined;
}

/** `key:`/`"key":` literal parsed as a plain object; undefined on capture or parse failure. */
function parseRecordLiteral(text: string, keyRe: RegExp): Record<string, unknown> | undefined {
  const lit = literalAfter(text, keyRe);
  if (lit === undefined) return undefined;
  const parsed = tryParseJson(lit);
  return isPlainRecord(parsed) ? parsed : undefined;
}

/** Split a balanced array/object literal into its depth-0 comma-separated segments. */
function topLevelSegments(lit: string): string[] {
  const open = lit[0] ?? "";
  const close = open === "{" ? "}" : "]";
  const start = open === "{" || open === "[" ? 1 : 0;
  const end = lit.length > 0 && lit[lit.length - 1] === close ? lit.length - 1 : lit.length;
  const segments: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = start; i < end; i++) {
    const ch = lit[i]!;
    if (ch === "\\") {
      cur += ch + (lit[i + 1] ?? "");
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      const q = ch;
      cur += q;
      i++;
      while (i < end) {
        const c = lit[i]!;
        cur += c;
        if (c === "\\") {
          cur += lit[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (c === q) break;
        i++;
      }
      continue;
    }
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      segments.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== "") segments.push(cur.trim());
  return segments;
}

function isStoryScenario(v: unknown): v is StoryScenario {
  return isPlainRecord(v) && typeof v.name === "string" && isPlainRecord(v.props);
}

/**
 * Best-effort `scenarios:` extraction (contract §4.6): JSON.parse the whole
 * array first; when that fails (JS-literal syntax), fall back to per-item
 * extraction — `name` via /name\s*:\s*(['"])…/ and `props` via object scan +
 * JSON.parse. Items whose props are not JSON-parseable are dropped, keeping the
 * emitted array shape-valid (item props are required by the contract).
 */
function extractScenarios(text: string): DesignStory["scenarios"] {
  // Canonical form is `export const scenarios = [...]` (assignment); the
  // in-object `scenarios: [...]` form also occurs, so accept both.
  const lit = literalAfter(text, /scenarios\s*[:=]\s*/);
  if (lit === undefined) return undefined;
  const parsed = tryParseJson(lit);
  if (Array.isArray(parsed)) return parsed.filter(isStoryScenario);
  const items: StoryScenario[] = [];
  for (const segment of topLevelSegments(lit)) {
    const name = quotedValue(segment, "name");
    const props = parseRecordLiteral(segment, /["']?props["']?\s*:\s*/);
    if (name !== undefined && props !== undefined) items.push({ name, props });
  }
  return items;
}

/**
 * Deterministic, convention-driven extraction of a story file's meta (contract
 * §4.6). Best-effort by design: any unparseable or unbalanced field is left
 * undefined and this never throws. `description` is capped at 2000 chars, `code`
 * at 8000.
 */
export function extractStoryMeta(fileText: string, file: string): DesignStory {
  return {
    file,
    title: fileText.slice(0, 2000).match(TITLE_RE)?.[1],
    description: quotedValue(fileText, "description")?.slice(0, DESCRIPTION_MAX),
    props: parseRecordLiteral(fileText, /["']?props["']?\s*:\s*/),
    schema: parseRecordLiteral(fileText, /["']?schema["']?\s*:\s*/),
    code: quotedValue(fileText, "code")?.slice(0, CODE_MAX),
    scenarios: extractScenarios(fileText),
  };
}

async function loadPackageMeta(
  root: string,
): Promise<Pick<DesignSnapshot, "packageName" | "version">> {
  try {
    const parsed = JSON.parse(
      await Deno.readTextFile(join(root, "package.json")),
    ) as Record<string, unknown>;
    return {
      packageName: typeof parsed.name === "string" ? parsed.name : undefined,
      version: typeof parsed.version === "string" ? parsed.version : undefined,
    };
  } catch {
    // Missing or unreadable package.json -> empty metadata, never throw.
    return {};
  }
}

async function loadStories(root: string): Promise<DesignStory[]> {
  let srcStat: Deno.FileInfo;
  try {
    srcStat = await Deno.stat(join(root, "src"));
  } catch {
    return [];
  }
  if (!srcStat.isDirectory) return [];
  const stories: DesignStory[] = [];
  for (const pattern of STORY_PATTERNS) {
    for await (const entry of expandGlob(pattern, { root, extended: true })) {
      if (!entry.isFile) continue;
      const text = await Deno.readTextFile(entry.path);
      stories.push(extractStoryMeta(text, relative(root, entry.path)));
    }
  }
  return stories;
}

export const designPlugin: WorkspacePlugin<DesignSnapshot> = {
  id: "design",
  label: "Design System",
  icon: "i-cube",
  defaultEnabled: true,
  requiredDeps: ["package.json"],
  async detect(ctx) {
    return (await designRootOf(ctx.root)) !== undefined;
  },
  async load(ctx) {
    const root = (await designRootOf(ctx.root)) ?? resolve(ctx.root);
    return {
      srcRoot: relative(resolve(ctx.root), root) || ".",
      ...(await loadPackageMeta(root)),
      stories: await loadStories(root),
    };
  },
};
