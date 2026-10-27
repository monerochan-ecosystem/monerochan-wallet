#!/usr/bin/env bash
# Start the regtest node and the shop when their ports do not answer. Then keep one test Brave.
# Leave a running node or shop up. Do not start a second copy.
# Brave: test/brave.sh keeps ONE test Brave and closes every other Brave.
#   The pid file /tmp/monerochan-test-brave.pid holds its pid. It is the global mutex.
#   SKIP_BRAVE=1 leaves the browser to the caller.
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
SHOP="$ROOT/../monero-payment-links"
# BRAVE_PORT moves Brave off 9333 when the emulator or another Brave holds it.
PORT="${BRAVE_PORT:-9333}"

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

if [ "${SKIP_BRAVE:-0}" = 1 ]; then
  echo "Brave left to the caller"
else
  bash "$ROOT/test/brave.sh" ensure --profile "$PROFILE" --port "$PORT" --log "$ROOT/testdata/brave.log"
fi
