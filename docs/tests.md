# Wallet browser tests

Run from the repo root:

```bash
bun test/wallettest.ts
bun test/browser-001.ts
bun test/browser-002.ts
```

`test/start-regtest.sh` starts what is down. 
- Node: `testdata/moneronode/monerod` on port 18081. `test/download-monerod.ts` fetches it. Chain data is `testdata/regtest`.
- Brave: profile `testdata/brave-profile`, extension `dist/chrome`, debug port 9222. The flag `--enable-unsafe-extension-debugging` is required.
- Shop: `../monero-payment-links`, command `bun run production`, port 3003. Clone `https://github.com/monerochan-ecosystem/monero-payment-links.git` only when that sibling folder is missing.


## Rules

- Use the real side panel over CDP. Do not open `sidebar.html` as a tab. `Extensions.triggerAction` takes the tab target, not the page target. A second trigger closes an open panel.
- Read `window.activeWalletPlate` before a plate click. The same click closes the open plate.
- Do not trust a click. A send proves itself by the pool or by `execute_result`.
- This regtest node moves only when the test mines. Change locks for 10 blocks. A coinbase locks for 60. Mine before the next send, and mine to empty the pool.
- After a reorg, reset the wallet before any mine. Then restart Brave. The background keeps the old wallet until Brave starts again.
- `browser-001` reads an open product link from `../monero-payment-links/monero_payments.db`. Do not hardcode a link id.
- `browser-002` needs the dashboard wallets page. Log in with `ADMIN_SECRET` from the shop `.env` when that page is missing.
