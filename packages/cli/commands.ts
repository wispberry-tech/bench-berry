// Re-export shim: command implementations live in commands/*.ts. The public
// surface (VERSION, plugins, usage, dispatch) is unchanged for consumers
// importing from '../cli/commands.ts'.
export { VERSION, plugins, usage } from './commands/shared.ts';
export { dispatch } from './commands/dispatch.ts';