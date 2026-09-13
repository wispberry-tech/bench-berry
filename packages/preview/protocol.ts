// packages/preview/protocol.ts
// PostMessage protocol between the shell and the live preview iframe (§4.6).
// Direction: shell -> preview is setProps/setStory/setTheme; preview -> shell
// is ready/error. Pure TS with no DOM dependency so this file stays
// deno-checkable anywhere. The shell mirrors the same union in
// packages/shell/src/lib/types.ts (it must not import from this package).
export type PreviewMessage =
  | { type: "ready" }
  | { type: "error"; message: string }
  | { type: "setProps"; props: Record<string, unknown> }
  | { type: "setStory"; storyId: string }
  | { type: "setTheme"; theme: "light" | "dark" };

/**
 * Validate unknown postMessage data as a PreviewMessage. Returns null for
 * anything malformed. `ready` must carry no fields besides `type`; the other
 * variants require their documented fields with the right types (unknown extra
 * fields are tolerated on shell->preview messages for forward compatibility).
 */
export function parsePreviewMessage(data: unknown): PreviewMessage | null {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (typeof record.type !== "string") return null;
  switch (record.type) {
    case "ready":
      return Object.keys(record).length === 1 ? { type: "ready" } : null;
    case "error":
      return typeof record.message === "string" ? { type: "error", message: record.message } : null;
    case "setProps":
      return record.props !== null && typeof record.props === "object" &&
          !Array.isArray(record.props)
        ? { type: "setProps", props: record.props as Record<string, unknown> }
        : null;
    case "setStory":
      return typeof record.storyId === "string"
        ? { type: "setStory", storyId: record.storyId }
        : null;
    case "setTheme":
      return record.theme === "light" || record.theme === "dark"
        ? { type: "setTheme", theme: record.theme }
        : null;
    default:
      return null;
  }
}
