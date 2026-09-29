#!/usr/bin/env bash
# Start the regtest node and Brave when their ports do not answer.
# Leave a running node or browser up. Do not start a second copy.
# Download monerod with test/download-monerod.ts when testdata/moneronode/monerod is absent.
# Do not use the monero-wallet-api binary.
#
# testdata/ is gitignored. Same role as test-data/ and tests/moneronode/ in the wallet lib.
# monerod:    testdata/moneronode/monerod
# chain data: testdata/regtest
# node log:   testdata/monerod.log
# Brave profile: testdata/brave-profile
# Brave log:  testdata/brave.log
# extension:  dist/chrome
# shop:       ../monero-payment-links  (bun run production, port 3003)
# Clone that repo only when the sibling folder does not exist.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MONEROD="$ROOT/testdata/moneronode/monerod"
DATA="$ROOT/testdata/regtest"
PROFILE="$ROOT/testdata/brave-profile"
EXT="$ROOT/dist/chrome"
SHOP="$ROOT/../monero-payment-links"

wait_http() {
  local url="$1"
  local tries="$2"
  local i
  for i in $(seq 1 "$tries"); do
    if curl -sf -m 2 "$url" >/dev/null; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

if [ ! -x "$MONEROD" ]; then
  bun "$ROOT/test/download-monerod.ts"
fi

if ! curl -sf -m 2 http://127.0.0.1:18081/get_height >/dev/null; then
  mkdir -p "$DATA"
  "$MONEROD" \
    --regtest --offline --fixed-difficulty 1 \
    --rpc-bind-ip 127.0.0.1 --rpc-bind-port 18081 \
    --data-dir "$DATA" \
    --non-interactive \
    --log-file "$ROOT/testdata/monerod.log" \
    --detach
  if ! wait_http http://127.0.0.1:18081/get_height 20; then
    echo "node did not answer on port 18081" >&2
    exit 1
  fi
  echo "node started"
else
  echo "node already up"
fi

if [ ! -d "$SHOP" ]; then
  git clone https://github.com/monerochan-ecosystem/monero-payment-links.git "$SHOP"
  (cd "$SHOP" && bun install)
fi

if ! curl -sf -m 2 http://127.0.0.1:3003/login >/dev/null; then
  mkdir -p "$ROOT/testdata"
  # setsid keeps the server after this script exits.
  (
    cd "$SHOP"
    setsid bun run production >"$ROOT/testdata/payment-links.log" 2>&1 < /dev/null &
  )
  if ! wait_http http://127.0.0.1:3003/login 40; then
    echo "payment links did not answer on port 3003" >&2
    exit 1
  fi
  echo "payment links started"
else
  echo "payment links already up"
fi

if ! curl -sf -m 2 http://127.0.0.1:9222/json/version >/dev/null; then
  mkdir -p "$PROFILE"
  # setsid keeps the window after this script exits.
  # DisableLoadExtensionCommandLineSwitch blocks --load-extension on new Chrome.
  setsid brave-browser \
    --user-data-dir="$PROFILE" \
    --remote-debugging-port=9222 \
    --remote-allow-origins=http://127.0.0.1:9222 \
    --disable-features=DisableLoadExtensionCommandLineSwitch \
    --enable-unsafe-extension-debugging \
    --load-extension="$EXT" \
    --disable-extensions-except="$EXT" \
    --no-first-run \
    --no-default-browser-check \
    >"$ROOT/testdata/brave.log" 2>&1 < /dev/null &
  if ! wait_http http://127.0.0.1:9222/json/version 40; then
    echo "Brave did not answer on port 9222" >&2
    exit 1
  fi
  echo "Brave started"
else
  echo "Brave already up"
fi
