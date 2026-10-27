export type SendFn = (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<any>;

// BRAVE_PORT moves the tests off 9333 when the emulator or another Brave holds it.
let port = Number(process.env.BRAVE_PORT) || 9333;
export function setDebugPort(p: number): void {
  port = p;
}
export function debugPort(): number {
  return port;
}
export function debugHttp(): string {
  return "http://127.0.0.1:" + port;
}

export async function cdp(onEvent?: (msg: { method?: string; params?: any; sessionId?: string }) => void): Promise<{ ws: WebSocket; send: SendFn }> {
  const ver: any = await (await fetch(debugHttp() + "/json/version")).json();
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
      return;
    }
    if (m.method) onEvent?.(m);
  };
  await new Promise<void>((r) => {
    ws.onopen = () => r();
  });
  return { ws, send };
}

export async function targetByUrl(match: string): Promise<{ id: string; url: string }> {
  const list: any[] = await (await fetch(debugHttp() + "/json/list")).json();
  const t = list.find((x) => (x.url || "").includes(match));
  if (!t) throw new Error("no target " + match);
  return t;
}

async function targetList(): Promise<any[]> {
  return await (await fetch(debugHttp() + "/json/list")).json();
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

export async function recordTabs(matches: string[], outPath: string, opts: { trimStartSec?: number } = {}) {
  // versioned frames dir: never destroy a previous run's raw frames
  let framesDir = `${outPath}.frames`;
  if (await Bun.file(`${framesDir}/meta.json`).exists()) {
    let v = 2;
    while (await Bun.file(`${outPath}.v${v}.frames/meta.json`).exists()) v++;
    framesDir = `${outPath}.v${v}.frames`;
  }
  const c = await cdp();
  const sessions: string[] = [];
  for (const m of matches) {
    const t = await targetByUrl(m);
    const s = await c.send("Target.attachToTarget", { targetId: t.id, flatten: true });
    sessions.push(s.sessionId);
  }
  const tmp = framesDir;
  await Bun.$`mkdir -p ${tmp}`.quiet();
  const counts = matches.map(() => 0);
  const stamps: number[][] = matches.map(() => []);
  const t0 = Date.now();
  let running = true;
  const loop = (async () => {
    while (running) {
      const shots = await Promise.all(
        sessions.map((sid) =>
          c.send("Page.captureScreenshot", { format: "jpeg", quality: 85 }, sid).catch(() => null),
        ),
      );
      // stamp AFTER capture resolves: the pixels show this moment, not loop start
      const tick = (Date.now() - t0) / 1000;
      for (let k = 0; k < shots.length; k++) {
        const r = shots[k];
        const count = counts[k];
        const stamp = stamps[k];
        if (r?.data && count !== undefined && stamp) {
          counts[k] = count + 1;
          const i = String(count).padStart(4, "0");
          await Bun.write(`${tmp}/t${k}_${i}.jpg`, Buffer.from(r.data, "base64"));
          stamp.push(tick);
        }
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  })();
  return {
    framesDir: tmp,
    async stop() {
      running = false;
      await loop.catch(() => {});
      const seconds = Math.max(1, (Date.now() - t0) / 1000);
      const n = Math.min(...counts);
      if (!n) {
        c.ws.close();
        throw new Error("no frames captured");
      }
      const fps = n / seconds;
      await Bun.write(
        `${tmp}/meta.json`,
        JSON.stringify({ fps, trimStartSec: opts.trimStartSec ?? 0, counts, matches, seconds, stamps }),
      );
      c.ws.close();
      return { frames: n, seconds, fps, outPath, framesDir: tmp };
    },
  };
}

export async function recordTab(match: string, outPath: string) {
  const frames: Buffer[] = [];
  const c = await cdp();
  let sessId = "";
  async function attach(m: string) {
    if (sessId) await c.send("Target.detachFromTarget", { sessionId: sessId }).catch(() => {});
    const t = await targetByUrl(m);
    const s = await c.send("Target.attachToTarget", { targetId: t.id, flatten: true });
    sessId = s.sessionId;
  }
  await attach(match);
  const t0 = Date.now();
  let running = true;
  const loop = (async () => {
    while (running) {
      try {
        if (!sessId) continue;
        const r = await c.send("Page.captureScreenshot", { format: "jpeg", quality: 60 }, sessId);
        if (r?.data) frames.push(Buffer.from(r.data, "base64"));
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
  })();
  return {
    switchTo: attach,
    async stop() {
      running = false;
      await loop.catch(() => {});
      const seconds = Math.max(1, (Date.now() - t0) / 1000);
      if (!frames.length) {
        c.ws.close();
        throw new Error("no frames captured");
      }
      const fps = Math.min(15, Math.max(1, Math.round(frames.length / seconds)));
      const proc = Bun.spawn(
        ["ffmpeg", "-y", "-framerate", String(fps), "-f", "image2pipe", "-vcodec", "mjpeg", "-i", "pipe:0", "-c:v", "libx264", "-vf", "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=#1a1a1a", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outPath],
        { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
      );
      for (const f of frames) proc.stdin.write(f);
      proc.stdin.end();
      await proc.exited;
      c.ws.close();
      return { frames: frames.length, seconds, fps, outPath };
    },
  };
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
