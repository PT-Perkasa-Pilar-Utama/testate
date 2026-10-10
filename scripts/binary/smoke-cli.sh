#!/bin/sh
# The CLI path from the README, with a freshly built binary: setup twice (the key is kept), a
# per-user service that answers /health/live, whereis, and uninstall. Linux with systemd and
# passwordless sudo: the CI runner. Decisions: docs/decisions/2026-10-10-cli.md.
#
#   sh scripts/binary/smoke-cli.sh <path-to-testate-binary>
set -eu

port=7390
health="http://127.0.0.1:$port/api/v1/health/live"
bin_dir="$HOME/.local/bin"
testate="$bin_dir/testate"

# A user service needs the user's systemd and its bus; linger starts them without a login.
sudo loginctl enable-linger "$(id -un)"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
for _ in $(seq 1 10); do [ -S "$XDG_RUNTIME_DIR/bus" ] && break; sleep 1; done
[ -S "$XDG_RUNTIME_DIR/bus" ] || { echo "no user bus at $XDG_RUNTIME_DIR/bus" >&2; exit 1; }

mkdir -p "$bin_dir"
install -m 755 "$1" "$testate"
"$testate" --version

key() { grep '^TESTATE_SECRETS_ACTIVE_KEY=' "$("$testate" whereis env)"; }
TESTATE_ADMIN_PASSWORD=cli-smoke-password-1 "$testate" setup --yes --port "$port"
first=$(key)
TESTATE_ADMIN_PASSWORD=cli-smoke-password-1 "$testate" setup --yes --port "$port" | grep -q "nothing changed"
[ "$first" = "$(key)" ] || { echo "a second setup replaced the sealing key" >&2; exit 1; }

"$testate" service install
for _ in $(seq 1 30); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$health" || true)" = 204 ] && break
  sleep 1
done
if [ "$(curl -s -o /dev/null -w '%{http_code}' "$health" || true)" != 204 ]; then
  journalctl --user -u testate --no-pager | tail -50
  exit 1
fi
"$testate" whereis
"$testate" service status > /dev/null

"$testate" service uninstall
sleep 2
if curl -s -o /dev/null "$health"; then
  echo "Testate still answered after service uninstall" >&2
  exit 1
fi
echo "setup kept its key; the per-user service started, answered and was removed"
