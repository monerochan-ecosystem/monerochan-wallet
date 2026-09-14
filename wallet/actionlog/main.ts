import { html, renderRoot } from "../../mininext/mininext";
import { initActionLogPage } from "./init";
import { router } from "./router";

const container = document.getElementById("container");
if (!container) throw new Error("Could not find container element");
renderRoot({
  component: () => html`<div class="log-root">${router.component}</div>`,
  container,
});
await initActionLogPage();
