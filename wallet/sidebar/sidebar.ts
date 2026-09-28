import { html, renderRoot } from "../../mininext/mininext";
import { router } from "./router";
import { initSidebar } from "./init";

const container = document.getElementById("container");
if (!container) throw new Error("Could not find container element");
renderRoot({
  component: () => html`<div style="height: 100%">${router.component}</div>`,
  container,
});
await initSidebar();
