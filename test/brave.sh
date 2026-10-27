#!/usr/bin/env bash
# One test Brave at a time. The pid file is the global mutex.
#
#   test/brave.sh ensure  [options] [-- brave args]   keep one test Brave, close every other Brave
#   test/brave.sh restart [options] [-- brave args]   same, but always start a new process
#   test/brave.sh stop                                close every Brave, clear the pid file
#   test/brave.sh status                              show the pid file and every Brave
#
# options:
#   --profile DIR   default testdata/brave-profile
#   --port N        default BRAVE_PORT, then 9333
#   --fresh         wipe the profile first. only below testdata/.
#   --log FILE      default testdata/brave.log
#   -- ARGS         more Brave arguments
#
# pid file: BRAVE_PID_FILE, default /tmp/monerochan-test-brave.pid. It holds the pid of the test Brave.
#   A pid counts only when /proc shows a Brave browser process.
#   A dead pid, a reused pid, and garbage in the file are ignored. The script finds the real process.
# lock: the pid file name plus .lock. flock holds it, so two calls at once cannot start two Brave.
#
# Every call ends in one state: one running test Brave, and no other Brave on this machine.
# That includes your own Brave. Close nothing you need before you run a browser test.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIDFILE="${BRAVE_PID_FILE:-/tmp/monerochan-test-brave.pid}"
EXT="$ROOT/dist/chrome"
PROFILE="$ROOT/testdata/brave-profile"
PORT="${BRAVE_PORT:-9333}"
LOG="$ROOT/testdata/brave.log"
FRESH=0
EXTRA=()

CMD="${1:-ensure}"
if [ "$#" -gt 0 ]; then shift; fi
while [ "$#" -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --log) LOG="$2"; shift 2 ;;
    --fresh) FRESH=1; shift ;;
    --) shift; EXTRA=("$@"); break ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
PROFILE="$(realpath -m "$PROFILE")"
LOG="$(realpath -m "$LOG")"

# a wipe is only safe below testdata/. check it before anything else happens.
if [ "$FRESH" = 1 ]; then
  case "$PROFILE" in
    "$ROOT"/testdata/?*) ;;
    *) echo "refuse to wipe $PROFILE. it is not below $ROOT/testdata" >&2; exit 2 ;;
  esac
fi

# the wrapper script brave-browser runs the real binary as its child. the real binary is the browser process.
BRAVE_CMD="${BRAVE_CMD:-brave-browser}"
BRAVE_EXE=/opt/brave.com/brave/brave
if wrapper="$(command -v "$BRAVE_CMD" 2>/dev/null)"; then
  BRAVE_EXE="$(dirname "$(readlink -f "$wrapper")")/brave"
fi

# the command line as one string. a child process can rewrite its own command line, so never split on arguments.
cmd_of() {
  tr '\0' ' ' < "/proc/$1/cmdline" 2>/dev/null || true
}

# every Brave browser process of this user. helper processes (--type=) are skipped.
brave_browsers() {
  local link p
  while read -r link; do
    p="${link#/proc/}"
    p="${p%/exe}"
    case "$p" in ''|*[!0-9]*) continue ;; esac
    case " $(cmd_of "$p")" in *" --type="*) continue ;; esac
    echo "$p"
  done < <(find /proc -maxdepth 2 -name exe \( -lname "$BRAVE_EXE" -o -lname "$BRAVE_EXE (deleted)" \) 2>/dev/null || true)
}

# the Brave browser that runs this profile on this port.
# check each argument alone. two checks in one pattern would need two spaces between the arguments.
wanted_pid() {
  local p c
  for p in $(brave_browsers); do
    c=" $(cmd_of "$p") "
    case "$c" in *" --user-data-dir=$PROFILE "*) ;; *) continue ;; esac
    case "$c" in *" --remote-debugging-port=$PORT "*) ;; *) continue ;; esac
    echo "$p"
    return 0
  done
  return 0
}

describe() {
  local c=" $(cmd_of "$1") "
  case "$c" in
    *" --user-data-dir="*) c="${c#* --user-data-dir=}"; echo "profile ${c%% *}" ;;
    *) echo "default profile" ;;
  esac
}

is_alive() {
  [ -r "/proc/$1/status" ] && ! grep -q '^State:[[:space:]]*Z' "/proc/$1/status"
}

healthy() {
  curl --noproxy '*' -sf -m 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1
}

# TERM first. Brave flushes its profile on TERM. KILL only when it hangs.
stop_pid() {
  local p="$1" i
  kill -TERM "$p" 2>/dev/null || true
  for i in $(seq 1 75); do
    is_alive "$p" || return 0
    sleep 0.2
  done
  echo "Brave $p did not stop in 15 s. kill -9." >&2
  kill -KILL "$p" 2>/dev/null || true
  for i in $(seq 1 25); do
    is_alive "$p" || return 0
    sleep 0.2
  done
  echo "Brave $p is still alive" >&2
  return 1
}

close_others() {
  local keep="${1:-}" p
  for p in $(brave_browsers); do
    if [ "$p" = "$keep" ]; then continue; fi
    echo "closing Brave $p ($(describe "$p"))"
    stop_pid "$p"
  done
}

record() {
  printf '%s\n' "$1" > "$PIDFILE.tmp.$$"
  mv -f "$PIDFILE.tmp.$$" "$PIDFILE"
}

wipe_profile() {
  local i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if rm -rf "$PROFILE"; then return 0; fi
    sleep 0.3
  done
  echo "could not remove $PROFILE" >&2
  exit 1
}

# all Brave are closed here. a listener on the port is not Brave.
check_port_free() {
  local i
  for i in $(seq 1 15); do
    if ! ss -ltnH "sport = :$PORT" 2>/dev/null | grep -q .; then return 0; fi
    sleep 0.2
  done
  echo "port $PORT is in use by something that is not a Brave browser:" >&2
  ss -ltnpH "sport = :$PORT" >&2 || true
  echo "free the port, or set BRAVE_PORT to another port." >&2
  exit 1
}

launch() {
  mkdir -p "$PROFILE" "$(dirname "$LOG")"
  # 9>&- keeps the lock file out of Brave. Brave lives on after this script ends.
  setsid "$BRAVE_CMD" \
    --user-data-dir="$PROFILE" \
    --remote-debugging-port="$PORT" \
    --remote-allow-origins="http://127.0.0.1:$PORT" \
    --disable-features=DisableLoadExtensionCommandLineSwitch \
    --enable-unsafe-extension-debugging \
    --load-extension="$EXT" \
    --disable-extensions-except="$EXT" \
    --no-first-run \
    --no-default-browser-check \
    "${EXTRA[@]}" \
    >"$LOG" 2>&1 < /dev/null 9>&- &
}

ensure() {
  local restart="$1" keep pid i
  keep="$(wanted_pid)"
  if [ "$FRESH" = 1 ] || [ "$restart" = 1 ]; then
    keep=""
  elif [ -n "$keep" ] && ! healthy; then
    echo "Brave $keep does not answer on port $PORT. start a new one."
    keep=""
  fi
  close_others "$keep"
  if [ -n "$keep" ]; then
    record "$keep"
    echo "Brave already up (pid $keep, port $PORT)"
    return 0
  fi
  if [ "$FRESH" = 1 ]; then wipe_profile; fi
  check_port_free
  launch
  for i in $(seq 1 100); do
    if healthy; then break; fi
    # after 6 s the process must exist. when it does not, Brave quit at once.
    if [ "$i" -gt 12 ] && [ -z "$(wanted_pid)" ]; then break; fi
    sleep 0.5
  done
  if ! healthy; then
    echo "Brave did not answer on port $PORT. see $LOG" >&2
    exit 1
  fi
  pid="$(wanted_pid)"
  if [ -z "$pid" ]; then
    echo "port $PORT answers, but no Brave browser runs $PROFILE" >&2
    exit 1
  fi
  record "$pid"
  echo "Brave started (pid $pid, port $PORT)"
}

status() {
  local p n=0
  echo "pid file $PIDFILE: $(cat "$PIDFILE" 2>/dev/null || echo none)"
  for p in $(brave_browsers); do
    n=$((n + 1))
    echo "Brave $p: $(cmd_of "$p" | cut -c1-160)"
  done
  echo "$n Brave browser process(es)"
}

case "$CMD" in
  status) status; exit 0 ;;
  ensure | restart | stop) ;;
  *) echo "usage: $0 ensure|restart|stop|status [options] [-- brave args]" >&2; exit 2 ;;
esac

exec 9>"$PIDFILE.lock"
if ! flock -w 180 9; then
  echo "another call holds $PIDFILE.lock for more than 180 s" >&2
  exit 1
fi

case "$CMD" in
  ensure) ensure 0 ;;
  restart) ensure 1 ;;
  stop)
    close_others ""
    rm -f "$PIDFILE"
    echo "no test Brave runs"
    ;;
esac
