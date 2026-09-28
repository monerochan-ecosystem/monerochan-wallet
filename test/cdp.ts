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
