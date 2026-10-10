#!/bin/sh
# Starts the binary under systemd and under pm2 from one testate.env, and checks it comes back
# after a restart and after a crash. Linux with systemd and sudo: the release smoke job's runner.
#
#   sh scripts/binary/smoke-service.sh <path-to-testate-binary>
#
# Docs: the README's "Run it as a service". Decisions: docs/decisions/2026-10-10-native-
# binaries.md (Q4, Q5).
set -eu

bin=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
root=$(cd "$(dirname "$0")/../.." && pwd)
health=http://127.0.0.1:7378/api/v1/health/live
PM2_VERSION=7.0.4

# Waits for /health/live to answer 204. $1 says what was just done, for the failure message.
wait_live() {
  for _ in $(seq 1 30); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' "$health" || true)" = 204 ] && return 0
    sleep 1
  done
  echo "Testate did not answer /health/live after: $1" >&2
  return 1
}

# Waits until the port no longer answers, so the next start cannot meet the previous process.
wait_down() {
  for _ in $(seq 1 45); do
    curl -s -o /dev/null "$health" || return 0
    sleep 1
  done
  echo "Testate still answered after: $1" >&2
  return 1
}

# One env file for both, from the example everyone copies, with a key and a password set.
env_file=$(mktemp)
sed -e "s|^TESTATE_SECRETS_ACTIVE_KEY=.*|TESTATE_SECRETS_ACTIVE_KEY=$(openssl rand -base64 32)|" \
  -e "s|^TESTATE_ADMIN_PASSWORD=.*|TESTATE_ADMIN_PASSWORD=service-smoke-password-1|" \
  "$root/deploy/.env.example" > "$env_file"

echo "== systemd"
sudo install -m 755 "$bin" /usr/local/bin/testate
sudo install -d -m 700 /etc/testate
sudo install -m 600 "$env_file" /etc/testate/testate.env
sudo install -m 644 "$root/deploy/systemd/testate.service" /etc/systemd/system/testate.service
sudo systemctl daemon-reload
sudo systemctl start testate
if ! wait_live "systemctl start"; then
  sudo journalctl -u testate --no-pager | tail -50
  exit 1
fi
sudo systemctl restart testate
wait_live "systemctl restart"
before=$(systemctl show -p MainPID --value testate)
sudo kill -9 "$before"
sleep 3
wait_live "kill -9 (Restart=on-failure)"
after=$(systemctl show -p MainPID --value testate)
[ "$before" != "$after" ] || { echo "systemd did not start a new process" >&2; exit 1; }
sudo test -f /var/lib/private/testate/metadata.db || { echo "no metadata.db in the state directory" >&2; exit 1; }
sudo systemctl stop testate
wait_down "systemctl stop"
echo "systemd: started, restarted, came back from kill -9 ($before -> $after)"

echo "== pm2"
npm install -g --silent "pm2@$PM2_VERSION"
work=$(mktemp -d)
sed "s|^TESTATE_DATA_DIR=.*|TESTATE_DATA_DIR=$work/data|" "$env_file" > "$work/testate.env"
cd "$work"
pm2 start "$root/deploy/pm2/ecosystem.config.cjs"
if ! wait_live "pm2 start"; then
  pm2 logs testate --nostream --lines 50
  exit 1
fi
pm2 restart testate
wait_live "pm2 restart"
pm2 delete testate
wait_down "pm2 delete"
echo "pm2: started and restarted from the same testate.env"
rm -f "$env_file"
