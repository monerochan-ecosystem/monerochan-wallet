# Wallet browser tests

Run from the repo root:

```bash
bun test/wallettest.ts
bun test/browser-001.ts
bun test/browser-002.ts
```

`test/start-regtest.sh` starts what is down. 
- Node: `testdata/moneronode/monerod` on port 18081. `test/download-monerod.ts` fetches it. Chain data is `testdata/regtest`.
- Brave: one test Brave at a time. `test/brave.sh` starts it and closes every other Brave, your own Brave too. Close nothing you need before a browser test.
  - The pid file `/tmp/monerochan-test-brave.pid` holds the pid. It is the global mutex. A dead pid, a reused pid, or garbage in the file makes a new Brave. A stranger process is never killed.
  - Main tests: profile `testdata/brave-profile`, extension `dist/chrome`, debug port `BRAVE_PORT`, default 9333.
  - `browser-fresh-install` and `browser-direct-tool`: profile `testdata/fresh-install-profile`, port `FRESH_BRAVE_PORT`, default 9334. They close the main Brave. The next main test starts it again.
  - The flag `--enable-unsafe-extension-debugging` is required.
  - `bash test/brave.sh status` shows the pid file and every Brave. `bash test/brave.sh stop` closes all.
- Shop: `../monero-payment-links`, command `bun run production`, port 3003. Clone `https://github.com/monerochan-ecosystem/monero-payment-links.git` only when that sibling folder is missing.


## Rules

- Use the real side panel over CDP. Do not open `sidebar.html` as a tab. `Extensions.triggerAction` takes the tab target, not the page target. A second trigger closes an open panel.
- Read `window.activeWalletPlate` before a plate click. The same click closes the open plate.
- Do not trust a click. A send proves itself by the pool or by `execute_result`.
- This regtest node moves only when the test mines. Change locks for 10 blocks. A coinbase locks for 60. Mine before the next send, and mine to empty the pool.
- After a reorg, reset the wallet before any mine. Then restart Brave. The background keeps the old wallet until Brave starts again.
- `browser-001` reads an open product link from `../monero-payment-links/monero_payments.db`. Do not hardcode a link id.
- `browser-002` needs the dashboard wallets page. Log in with `ADMIN_SECRET` from the shop `.env` when that page is missing.
