<script lang="ts">
  // Settings route: renders workspace toggles + theme from the RESOLVED CONFIG
  // module (via the store), not from snapshots. In the dev server the Save
  // button POSTs a delta to /__berrybench/config; in production builds a
  // read-only note explains the config is compiled in.
  import { config } from './lib/store.svelte.ts';
  import { WORKSPACE_IDS, type WorkspaceId } from './lib/types.ts';
  import { ACCENTS, DEFAULT_ACCENT, isKnownAccent, type ThemeName } from './lib/theme.ts';

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
  let defaultTheme = $state<ThemeName>('light');
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
    defaultTheme = config.theme?.defaultTheme ?? 'light';
    status = null;
  });

  function buildDelta(): {
    workspaces?: Record<string, { enabled: boolean }>;
    theme?: { accent?: string; defaultTheme?: ThemeName };
  } {
    const delta: {
      workspaces?: Record<string, { enabled: boolean }>;
      theme?: { accent?: string; defaultTheme?: ThemeName };
    } = {};
    const workspaces: Record<string, { enabled: boolean }> = {};
    for (const id of WORKSPACE_IDS) {
      const orig = config.workspaces[id]?.enabled ?? false;
      if (draft[id] !== orig) workspaces[id] = { enabled: draft[id] };
    }
    if (Object.keys(workspaces).length > 0) delta.workspaces = workspaces;
    const theme: { accent?: string; defaultTheme?: ThemeName } = {};
    if (accent !== (config.theme?.accent ?? DEFAULT_ACCENT)) theme.accent = accent;
    if (defaultTheme !== (config.theme?.defaultTheme ?? 'light')) theme.defaultTheme = defaultTheme;
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

<div class="settings-wrap">
  <div class="view-head">
    <div>
      <div class="vh-title">Settings</div>
      <div class="vh-sub">Which workspaces are enabled, and how the shell looks. Changes are written back to the project config.</div>
    </div>
  </div>

  {#if !dev}
    <div class="settings-note">
      <svg class="icon"><use href="#i-warn"/></svg>
      <span>Settings are compiled into this build — edit <span class="mono">berrybench.config.ts</span> in the project root and restart the dev server.</span>
    </div>
  {/if}

  <div class="settings-section-title">Workspaces</div>
  <div class="panel">
    {#each WORKSPACE_IDS as id (id)}
      <div class="ws-card">
        <div class="ws-card-name">
          <span class="mono">{id}</span>
          <span class="badge badge-neutral">{config.workspaces[id]?.enabledBy ?? 'default'}</span>
        </div>
        <div class="ws-card-toggle">
          {#if dev}
            <label class="hint" for="ws-{id}">
              {draft[id] ? 'enabled' : 'disabled'}
            </label>
            <input id="ws-{id}" class="checkbox" type="checkbox" bind:checked={draft[id]} />
          {:else}
            <span class="hint">{config.workspaces[id]?.enabled ? 'enabled' : 'disabled'}</span>
          {/if}
        </div>
      </div>
    {/each}
  </div>

  <div style="height:24px"></div>

  <div class="settings-section-title">Theme</div>
  <div class="panel">
    <div class="settings-theme-row">
      <div class="field">
        <span class="field-label">Accent</span>
        <span class="field-hint">Applied as <span class="mono">data-accent</span> on the shell.</span>
      </div>
      {#if dev}
        <select class="select" bind:value={accent}>
          {#each ACCENTS as a (a)}
            <option value={a}>{a}</option>
          {/each}
        </select>
      {:else}
        <span class="badge badge-accent">{isKnownAccent(accent) ? accent : DEFAULT_ACCENT}</span>
      {/if}
    </div>
    <div class="settings-theme-row">
      <div class="field">
        <span class="field-label">Default theme</span>
        <span class="field-hint">Fallback unless overridden by localStorage.</span>
      </div>
      {#if dev}
        <select class="select" bind:value={defaultTheme}>
          <option value="light">light</option>
          <option value="dark">dark</option>
        </select>
      {:else}
        <span class="badge badge-neutral">{defaultTheme}</span>
      {/if}
    </div>
  </div>

  {#if dev}
    <div class="settings-actions">
      <button class="btn btn-primary" type="button" disabled={saving} onclick={save}>
        {saving ? 'Saving…' : 'Save'}
      </button>
      {#if status}
        <span class="settings-status {status.ok ? 'ok' : 'err'}">{status.message}</span>
      {/if}
    </div>
  {/if}
</div>