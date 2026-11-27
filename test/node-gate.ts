// test-only proxy. hold merchant submission before it reaches the regtest node.
// NODE_GATE_UPSTREAM can name another port of the same node, for example its restricted port
const upstream = Bun.env.NODE_GATE_UPSTREAM || "http://127.0.0.1:18081";
const info = await fetch(upstream + "/get_info").then((response) => response.json());
if (info.nettype !== "fakechain" || !info.offline) throw new Error("node gate requires an offline regtest node");
let release = () => {};
let gate = Promise.resolve();
let pending = 0;
let tx_as_hex = "";
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
  const path = new URL(req.url).pathname;
  if (path === "/hold" && req.method === "POST") {
    release();
    gate = new Promise<void>((resolve) => { release = resolve; });
    return Response.json({ held: true });
  }
  if (path === "/release" && req.method === "POST") { release(); return Response.json({ held: false }); }
  if (path === "/state") return Response.json({ pending, tx_as_hex });
  const body = await req.arrayBuffer();
  const submit = path === "/send_raw_transaction";
  if (submit) {
    tx_as_hex = JSON.parse(new TextDecoder().decode(body)).tx_as_hex;
    pending++;
    await gate;
  }
  try {
    return await fetch(upstream + path, { method: req.method, headers: { "Content-Type": "application/json" }, ...(req.method === "POST" ? { body } : {}) });
  } finally { if (submit) pending--; }
} });
const endpoint = { pid: process.pid, url: `http://127.0.0.1:${server.port}` };
await Bun.write(Bun.env.NODE_GATE_FILE || "testdata/node-gate/endpoint.json", JSON.stringify(endpoint));
console.log(endpoint.url);
