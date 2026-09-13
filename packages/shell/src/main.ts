// packages/shell/src/main.ts
// Entry point: mount the shell app and pull in the shared stylesheet.
import { mount } from "svelte";
import App from "./App.svelte";
import "./lib/tokens.css";

const target = document.getElementById("app");
if (target) {
  mount(App, { target });
} else {
  console.error("BerryBench shell: #app mount target not found");
}
