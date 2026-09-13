import type { CliContext } from "../main.ts";
import { type Out, output, usage, VERSION } from "./shared.ts";
import { cmdInit } from "./init.ts";
import { cmdConfig } from "./config.ts";
import { cmdDetect } from "./detect.ts";
import { cmdSnapshot } from "./snapshot.ts";
import { cmdDev } from "./dev.ts";
import { cmdBuild } from "./build.ts";

export async function dispatch(args: string[], ctx: CliContext): Promise<number> {
  const { out, err } = output(ctx);
  const [cmd, ...rest] = args;

  if (cmd === undefined || cmd === "--help") {
    out(usage());
    return 0;
  }
  if (cmd === "--version") {
    out(VERSION);
    return 0;
  }

  switch (cmd) {
    case "init":
      return cmdInit(rest, ctx, out, err);
    case "config":
      return cmdConfig(rest, ctx, out, err);
    case "detect":
      return cmdDetect(rest, ctx, out, err);
    case "snapshot":
      return cmdSnapshot(rest, ctx, out, err);
    case "dev":
      return cmdDev(rest, ctx, out, err);
    case "build":
      return cmdBuild(rest, ctx, out, err);
    default:
      err(`unknown command: ${cmd}`);
      err(usage());
      return 1;
  }
}
