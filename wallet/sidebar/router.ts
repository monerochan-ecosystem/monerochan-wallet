import { createRouter, type Mini, type Params } from "../../mininext/mininext";
import { onboarding } from "./segments/onboarding";
import { navigateToFirstWallet, walletRoute } from "./segments/walletRoute";
export type WalletRouteParams =
  Params<"/:identity/:domain/:wallet_type/:wallet_slot">;
const routes = {
  "/onboarding": ({}, mini: Mini) => onboarding(),
  "/:identity/:domain/:wallet_type/:wallet_slot": (
    params: Params<"/:identity/:domain/:wallet_type/:wallet_slot">,
    mini: Mini,
  ) => walletRoute(mini, params),
} as const;

export const router = createRouter(routes);

//TODO navigate to last selected wallet

navigateToFirstWallet();
