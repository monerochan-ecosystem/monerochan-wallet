import { html, renderRoot } from "../../mininext/mininext";
import { router } from "./router";
import { initSidebar, initToolInvocation, selectedWalletRouteStore } from "./init";
import { allWallets } from "./segments/walletRoute";

const container = document.getElementById("container");
if (!container) throw new Error("Could not find container element");
// Restore the route before the first wallet render.
await initSidebar();

function saveSelectedWalletRoute() {
  void selectedWalletRouteStore.save(window.location.hash.slice(1), allWallets())
    .catch((error) => console.error("Could not save selected wallet route", error));
}
window.addEventListener("hashchange", saveSelectedWalletRoute);
saveSelectedWalletRoute();

renderRoot({
  component: () => html`<div style="height: 100%">${router.component}</div>`,
  container,
});
// The invocation buttons must exist before their initial UI state is applied.
await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
await initToolInvocation();
