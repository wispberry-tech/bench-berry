import type { ProjectContext, WorkspacePlugin } from '../core/workspace.ts';
import { expandGlob } from '@std/fs';
import { join, relative, resolve } from '@std/path';

export interface DesignStory {
  file: string;
  title?: string;
}

export interface DesignSnapshot {
  packageName?: string;
  version?: string;
  stories: DesignStory[];
}

const STORY_PATTERNS = ['src/**/*.story.svelte', 'src/**/*.story.tsx'] as const;

/** First `title:` literal found in the first 2000 chars of a story file. */
const TITLE_RE = /title:\s*['"]([^'"]+)['"]/;

async function loadPackageMeta(
  ctx: ProjectContext,
): Promise<Pick<DesignSnapshot, 'packageName' | 'version'>> {
  try {
    const parsed = JSON.parse(
      await Deno.readTextFile(join(ctx.root, 'package.json')),
    ) as Record<string, unknown>;
    return {
      packageName: typeof parsed.name === 'string' ? parsed.name : undefined,
      version: typeof parsed.version === 'string' ? parsed.version : undefined,
    };
  } catch {
    // Missing or unreadable package.json -> empty metadata, never throw.
    return {};
  }
}

async function loadStories(ctx: ProjectContext): Promise<DesignStory[]> {
  const root = resolve(ctx.root);
  let srcStat: Deno.FileInfo;
  try {
    srcStat = await Deno.stat(join(root, 'src'));
  } catch {
    return [];
  }
  if (!srcStat.isDirectory) return [];
  const stories: DesignStory[] = [];
  for (const pattern of STORY_PATTERNS) {
    for await (const entry of expandGlob(pattern, { root, extended: true })) {
      if (!entry.isFile) continue;
      const text = await Deno.readTextFile(entry.path);
      const match = text.slice(0, 2000).match(TITLE_RE);
      stories.push({ file: relative(root, entry.path), title: match?.[1] });
    }
  }
  return stories;
}

export const designPlugin: WorkspacePlugin<DesignSnapshot> = {
  id: 'design',
  label: 'Design System',
  icon: 'i-cube',
  defaultEnabled: true,
  requiredDeps: ['package.json'],
  async detect(ctx) {
    try {
      await Deno.stat(join(ctx.root, 'package.json'));
      return true;
    } catch {
      return false;
    }
  },
  async load(ctx) {
    return { ...(await loadPackageMeta(ctx)), stories: await loadStories(ctx) };
  },
};