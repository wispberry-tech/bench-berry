<script lang="ts">
  // Settings route: renders workspace toggles + theme from the RESOLVED CONFIG
  // module (via the store), not from snapshots. In the dev server the Save
  // button POSTs a delta to /__berrybench/config; in production builds a
  // read-only note explains the config is compiled in.
  import { config } from './lib/store.svelte.ts';
  import { WORKSPACE_IDS, type WorkspaceId } from './lib/types.ts';
  import { ACCENTS, DEFAULT_ACCENT, isKnownAccent } from './lib/theme.ts';

  import PageHeader from './lib/components/PageHeader.svelte';
  import Section from './lib/components/Section.svelte';
  import Card from './lib/components/ui/card.svelte';
  import Badge from './lib/components/ui/badge.svelte';
  import Switch from './lib/components/ui/switch.svelte';
  import Label from './lib/components/ui/label.svelte';
  import Select from './lib/components/ui/select.svelte';
  import Alert from './lib/components/ui/alert.svelte';
  import Button from './lib/components/ui/button.svelte';

  interface SaveResponse {
    ok: boolean;
    file?: string;
    error?: string;
  }

  let draft = $state<Record<WorkspaceId, boolean>>({
    design: false,
    api: false,
    db: false,
  });
  let accent = $state<string>(DEFAULT_ACCENT);
  let saving = $state(false);
  let status = $state<{ ok: boolean; message: string } | null>(null);

  const dev = import.meta.env.DEV;

  // Keep the draft in sync with the config module (covers HMR updates).
  $effect(() => {
    for (const id of WORKSPACE_IDS) {
      draft[id] = config.workspaces[id]?.enabled ?? false;
    }
    const cfgAccent = config.theme?.accent ?? DEFAULT_ACCENT;
    accent = isKnownAccent(cfgAccent) ? cfgAccent : DEFAULT_ACCENT;
    status = null;
  });

  function buildDelta(): {
    workspaces?: Record<string, { enabled: boolean }>;
    theme?: { accent?: string };
  } {
    const delta: {
      workspaces?: Record<string, { enabled: boolean }>;
      theme?: { accent?: string };
    } = {};
    const workspaces: Record<string, { enabled: boolean }> = {};
    for (const id of WORKSPACE_IDS) {
      const orig = config.workspaces[id]?.enabled ?? false;
      if (draft[id] !== orig) workspaces[id] = { enabled: draft[id] };
    }
    if (Object.keys(workspaces).length > 0) delta.workspaces = workspaces;
    const theme: { accent?: string } = {};
    if (accent !== (config.theme?.accent ?? DEFAULT_ACCENT)) theme.accent = accent;
    if (Object.keys(theme).length > 0) delta.theme = theme;
    return delta;
  }

  async function save(): Promise<void> {
    saving = true;
    status = null;
    try {
      const res = await fetch('/__berrybench/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildDelta()),
      });
      const json = (await res.json()) as SaveResponse;
      if (json.ok) {
        status = { ok: true, message: `Saved — merged into ${json.file ?? 'berrybench.config.ts'}` };
      } else {
        status = { ok: false, message: json.error ?? 'Save failed' };
      }
    } catch (err) {
      status = { ok: false, message: err instanceof Error ? err.message : String(err) };
    } finally {
      saving = false;
    }
  }
</script>

<div class="mx-auto w-full max-w-[640px] px-8 pb-16 pt-6">
  <PageHeader
    title="Settings"
    sub="Which workspaces are enabled, and how the shell looks. Changes are written back to the project config."
  />

  {#if !dev}
    <Alert class="mb-4 flex items-start gap-2">
      <svg class="size-4 flex-none" style="stroke-width: 1.2" aria-hidden="true">
        <use href="#i-warn" />
      </svg>
      <span class="text-xs leading-relaxed"
        >Settings are compiled into this build — edit
        <code class="font-mono">berrybench.config.ts</code> in the project root and restart the dev
        server.</span
      >
    </Alert>
  {/if}

  <Section title="Workspaces">
    <Card class="divide-y divide-border overflow-hidden">
      {#each WORKSPACE_IDS as id (id)}
        <div class="flex items-center gap-3 px-4 py-3">
          <div class="min-w-0 flex-1">
            <code class="font-mono text-[12.5px] font-semibold text-foreground">{id}</code>
            <Badge variant="secondary" class="ml-2">{config.workspaces[id]?.enabledBy ?? 'default'}</Badge>
          </div>
          <div class="flex flex-none items-center gap-3">
            {#if dev}
              <span class="text-xs text-muted-foreground">{draft[id] ? 'enabled' : 'disabled'}</span>
              <Switch bind:checked={draft[id]} aria-label={`Toggle ${id}`} />
            {:else}
              <span class="text-xs text-muted-foreground"
                >{config.workspaces[id]?.enabled ? 'enabled' : 'disabled'}</span
              >
            {/if}
          </div>
        </div>
      {/each}
    </Card>
  </Section>

  <Section title="Theme" class="mt-6">
    <Card>
      <div class="flex items-center justify-between gap-3 px-4 py-3">
        <div class="flex flex-col gap-1">
          <Label class="text-secondary-foreground">Accent</Label>
          <span class="text-[11px] text-muted-foreground"
            >Applied as <code class="font-mono">data-accent</code> on the shell.</span
          >
        </div>
        {#if dev}
          <Select class="w-36" bind:value={accent}>
            {#each ACCENTS as a (a)}
              <option value={a}>{a}</option>
            {/each}
          </Select>
        {:else}
          <Badge variant="default">{isKnownAccent(accent) ? accent : DEFAULT_ACCENT}</Badge>
        {/if}
      </div>
    </Card>
  </Section>

  {#if dev}
    <div class="mt-6 flex items-center gap-3">
      <Button disabled={saving} onclick={save}>{saving ? 'Saving…' : 'Save'}</Button>
      {#if status}
        <span class="text-xs {status.ok ? 'text-success' : 'text-destructive'}">{status.message}</span>
      {/if}
    </div>
  {/if}
</div>