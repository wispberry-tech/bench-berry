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

if (import.meta.main) {
  Deno.exit(await run(Deno.args, { cwd: Deno.cwd(), env: Deno.env.toObject() }));
}
