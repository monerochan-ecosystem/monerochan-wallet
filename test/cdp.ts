type SendFn = (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<any>;

export async function cdp(): Promise<{ ws: WebSocket; send: SendFn }> {
  const ver: any = await (await fetch("http://127.0.0.1:9222/json/version")).json();
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let n = 0;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  const send: SendFn = (method, params = {}, sessionId) => {
    const id = ++n;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("cdp timeout " + method));
      }, 20000);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      const msg: Record<string, unknown> = { id, method, params };
      if (sessionId) msg.sessionId = sessionId;
      ws.send(JSON.stringify(msg));
    });
  };
  ws.onmessage = (e: MessageEvent) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id)!;
      pending.delete(m.id);
      if (m.error) p.reject(new Error(JSON.stringify(m.error)));
      else p.resolve(m.result);
    }
  };
  await new Promise<void>((r) => {
    ws.onopen = () => r();
  });
  return { ws, send };
}

export async function targetByUrl(match: string): Promise<{ id: string; url: string }> {
  const list: any[] = await (await fetch("http://127.0.0.1:9222/json/list")).json();
  const t = list.find((x) => (x.url || "").includes(match));
  if (!t) throw new Error("no target " + match);
  return t;
}

async function targetList(): Promise<any[]> {
  return await (await fetch("http://127.0.0.1:9222/json/list")).json();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function sidePanelListed(): Promise<boolean> {
  const list = await targetList();
  return list.some((x) => (x.url || "").includes("sidebar.html"));
}

async function triggerSidePanel(send: SendFn): Promise<void> {
  // Extensions.triggerAction needs the tab target, not the page target.
  // Do not open sidebar.html as a tab.
  const list = await targetList();
  const ext = list.find((x) => (x.url || "").startsWith("chrome-extension://"));
  if (!ext) throw new Error("extension not loaded");
  const id = String(ext.url).split("/")[2];
  const tabs = await send("Target.getTargets", { filter: [{ type: "tab" }] });
  let tab = (tabs.targetInfos || []).find((x: any) => /^https?:/.test(x.url || ""));
  if (!tab) {
    await send("Target.createTarget", { url: "http://127.0.0.1:18081/get_height" });
    const again = await send("Target.getTargets", { filter: [{ type: "tab" }] });
    tab = (again.targetInfos || []).find((x: any) => /^https?:/.test(x.url || ""));
  }
  if (!tab) throw new Error("no tab for side panel");
  await send("Extensions.triggerAction", { id, targetId: tab.targetId });
}

async function ensureSidePanelWith(send: SendFn): Promise<void> {
  // Sense first. A second triggerAction can close an open panel.
  for (let round = 0; round < 2; round++) {
    if (await sidePanelListed()) return;
    await triggerSidePanel(send);
    const start = Date.now();
    while (Date.now() - start < 8000) {
      if (await sidePanelListed()) return;
      await sleep(250);
    }
  }
  throw new Error("side panel did not open");
}

export async function ensureSidePanel(send?: SendFn): Promise<void> {
  if (send) {
    await ensureSidePanelWith(send);
    return;
  }
  const c = await cdp();
  try {
    await ensureSidePanelWith(c.send);
  } finally {
    c.ws.close();
  }
}
