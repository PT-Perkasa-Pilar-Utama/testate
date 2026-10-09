#!/bin/sh
# Turns `.bin-build/<os>_<arch>/testate[.exe]` into the release archives and one checksums.txt.
#
#   sh scripts/binary/package.sh [in-dir] [out-dir]     # defaults: .bin-build dist
#
# testate_<os>_<arch>.tar.gz for macOS and Linux, testate_windows_amd64.zip for Windows, each
# holding the binary and LICENSE (docs/decisions/2026-10-10-native-binaries.md, Q1). The
# install script reads checksums.txt, so its format is sha256sum's: "<hex>  <file>".
set -eu

in=${1:-.bin-build}
root=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "${2:-dist}"
out=$(cd "${2:-dist}" && pwd)

for dir in "$in"/*_*/; do
  key=$(basename "$dir")
  cp "$root/LICENSE" "$dir/LICENSE"
  case "$key" in
    windows_*) (cd "$dir" && zip -q "$out/testate_$key.zip" testate.exe LICENSE) ;;
    # COPYFILE_DISABLE keeps macOS tar from adding ._ metadata files.
    *) COPYFILE_DISABLE=1 tar -czf "$out/testate_$key.tar.gz" -C "$dir" testate LICENSE ;;
  esac
done

cd "$out"
if command -v sha256sum > /dev/null 2>&1; then
  sha256sum testate_* > checksums.txt
else
  shasum -a 256 testate_* > checksums.txt
fi
cat checksums.txt
