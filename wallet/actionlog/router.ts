import { createRouter, type Params } from "@spirobel/mininext";
import { actionLogDetail, actionLogList, actionLogTx } from "./page";

export const router = createRouter({
  "/": () => actionLogList(),
  "/invo/:invocationId": (params:Params<"/invo/:invocationId">) => actionLogDetail(params),
  "/tx/:wallet/:index": (params: Params<"/tx/:wallet/:index">) => actionLogTx(params),
});
