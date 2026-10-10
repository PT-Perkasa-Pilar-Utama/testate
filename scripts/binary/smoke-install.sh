#!/bin/sh
# Runs docs/install.sh against local archives, the way the release smoke job does.
#
#   sh scripts/binary/smoke-install.sh <dist-dir> [shell ...]     # default shell: sh
#
# Serves <dist-dir> (the archives and checksums.txt from package.sh) on 127.0.0.1:7392, installs
# with each shell into a fresh directory, checks the binary answers --version, then checks that
# a corrupted archive is refused and nothing is installed (docs/decisions/2026-10-10-native-
# binaries.md, Q5).
set -eu

dist=$(cd "$1" && pwd)
shift
[ "$#" -gt 0 ] || set -- sh
root=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
port=7392
url="http://127.0.0.1:$port"

serve() {
  python3 -m http.server "$port" --bind 127.0.0.1 --directory "$1" > "$work/http.log" 2>&1 &
  server=$!
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    curl -fsS -o /dev/null "$url/checksums.txt" 2> /dev/null && return 0
    sleep 0.5
  done
  echo "the local server did not start" >&2
  cat "$work/http.log" >&2
  exit 1
}
server=""
cleanup() {
  [ -z "$server" ] || kill "$server" 2> /dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT

serve "$dist"
for shell in "$@"; do
  dir="$work/$shell/bin"
  TESTATE_DOWNLOAD_URL=$url TESTATE_INSTALL_DIR=$dir "$shell" "$root/docs/install.sh"
  "$dir/testate" --version
  echo "installed and ran under $shell"
done
kill "$server"

# A corrupted archive: same name, one byte more, so checksums.txt no longer matches it.
cp -R "$dist" "$work/bad"
for archive in "$work"/bad/testate_*.tar.gz; do printf x >> "$archive"; done
serve "$work/bad"
if TESTATE_DOWNLOAD_URL=$url TESTATE_INSTALL_DIR="$work/bad-install" sh "$root/docs/install.sh"; then
  echo "install.sh accepted a corrupted archive" >&2
  exit 1
fi
if [ -e "$work/bad-install/testate" ]; then
  echo "install.sh left a binary behind after refusing" >&2
  exit 1
fi
echo "a corrupted archive was refused and nothing was installed"
