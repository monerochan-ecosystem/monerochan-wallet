import { createRouter, type Params } from "../../mininext/mininext";
import { actionLogDetail, actionLogList } from "./page";

export const router = createRouter({
  "/": () => actionLogList(),
  "/invo/:invocationId": (params:Params<"/invo/:invocationId">) => actionLogDetail(params),
});
