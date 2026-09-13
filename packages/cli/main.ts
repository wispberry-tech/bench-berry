import { loadSync } from "@std/dotenv";
import { join, resolve } from "@std/path";
import { dispatch } from "./commands.ts";

export { VERSION } from "./commands.ts";

/** Runtime context handed to every command; output defaults to the console. */
export interface CliContext {
  /** Directory commands resolve relative paths against (never Deno.cwd() inside core/plugins). */
  cwd: string;
  env: Record<string, string | undefined>;
  /** Replace console.log; each call receives one line without a trailing newline. */
  stdout?: (s: string) => void;
  /** Replace console.error; each call receives one line without a trailing newline. */
  stderr?: (s: string) => void;
}

/**
 * Run the CLI once. Returns the process exit code; never throws for
 * user-facing errors (init overwrite, unknown commands, resolution failures).
 */
export async function run(args: string[], ctx: CliContext): Promise<number> {
  return dispatch(args, ctx);
}

/**
 * Parse `<root>/.env` with the standard dotenv grammar. A missing or
 * unparseable file yields {} — the CLI must never crash over a stray .env.
 */
export function parseProjectEnvFile(root: string): Record<string, string> {
  const envPath = join(root, ".env");
  try {
    Deno.statSync(envPath);
  } catch {
    return {};
  }
  try {
    return loadSync({ envPath, export: false });
  } catch {
    return {};
  }
}

/**
 * The project root whose `.env` belongs to this invocation. Commands take an
 * optional positional dir (`config enable/disable` keeps it third); without
 * one the current directory is the project — mirrors projectDir() parsing.
 */
export function projectDirFromArgs(args: string[], cwd: string): string {
  const [cmd, ...rest] = args;
  let dirArg: string | undefined;
  if (cmd === "config") {
    const verb = rest[0];
    if (verb === "enable" || verb === "disable") dirArg = rest[2];
  } else {
    dirArg = rest.find((arg) => !arg.startsWith("-"));
  }
  return resolve(cwd, dirArg ?? ".");
}

/**
 * Merge `<root>/.env` into the process environment so every BERRYBENCH_* read
 * (ctx.env and the direct Deno.env.get call sites) sees it. Existing process
 * variables win — .env only fills gaps, like any dotenv loader.
 */
export function loadProjectEnvFile(root: string): Record<string, string> {
  const parsed = parseProjectEnvFile(root);
  for (const [key, value] of Object.entries(parsed)) {
    if (Deno.env.get(key) === undefined) Deno.env.set(key, value);
  }
  return parsed;
}

if (import.meta.main) {
  const cwd = Deno.cwd();
  loadProjectEnvFile(projectDirFromArgs(Deno.args, cwd));
  Deno.exit(await run(Deno.args, { cwd, env: Deno.env.toObject() }));
}
