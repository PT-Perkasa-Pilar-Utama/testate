#!/bin/sh
# Installs the Testate binary for this machine.
#
#   curl -fsSL https://pt-perkasa-pilar-utama.github.io/testate/install.sh | sh
#   wget -qO- https://pt-perkasa-pilar-utama.github.io/testate/install.sh | sh
#
# TESTATE_VERSION=2.0.0      a release instead of the latest one
# TESTATE_INSTALL_DIR=<dir>  where the binary goes instead of ~/.local/bin
#
# It downloads the archive and checksums.txt from the GitHub release, checks the SHA-256, and
# stops on a mismatch. POSIX sh only, so it runs under dash and busybox too.
# Decisions: docs/decisions/2026-10-10-native-binaries.md.
set -eu

REPO="PT-Perkasa-Pilar-Utama/testate"

say() { printf '%s\n' "$*"; }
fail() {
  printf 'testate install: %s\n' "$*" >&2
  exit 1
}

detect_os() {
  case "$(uname -s)" in
    Linux) echo linux ;;
    Darwin) echo darwin ;;
    MINGW* | MSYS* | CYGWIN*) fail "on Windows, download testate_windows_amd64.zip from https://github.com/$REPO/releases" ;;
    *) fail "no binary for $(uname -s); run the container image instead (see the README)" ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64 | amd64)
      # A shell under Rosetta reports x86_64 on Apple silicon; the native build is the one to use.
      if [ "$1" = darwin ] && [ "$(sysctl -n hw.optional.arm64 2> /dev/null || echo 0)" = 1 ]; then
        echo arm64
      else
        echo amd64
      fi
      ;;
    aarch64 | arm64) echo arm64 ;;
    *) fail "no binary for $(uname -m); run the container image instead (see the README)" ;;
  esac
}

# The Linux builds link against glibc. On musl (Alpine) they fail with a confusing "not found".
refuse_musl() {
  if ldd --version 2>&1 | grep -qi musl; then
    fail "this system uses musl (Alpine?); the binaries need glibc. Run the container image instead"
  fi
}

# Where the archives live: one release, or whatever "latest" points at. TESTATE_DOWNLOAD_URL
# replaces it, so CI can test this script against archives that are not published yet.
base_url() {
  if [ -n "${TESTATE_DOWNLOAD_URL:-}" ]; then
    echo "$TESTATE_DOWNLOAD_URL"
    return
  fi
  version=${TESTATE_VERSION:-}
  version=${version#v}
  if [ -z "$version" ]; then
    echo "https://github.com/$REPO/releases/latest/download"
    return
  fi
  case "${version%%.*}" in
    0 | 1) fail "$version is older than 2.0.0, which has no install archives; download it from https://github.com/$REPO/releases/tag/v$version" ;;
  esac
  echo "https://github.com/$REPO/releases/download/v$version"
}

download() {
  if command -v curl > /dev/null 2>&1; then
    curl -fsSL -o "$2" "$1" || fail "could not download $1"
  elif command -v wget > /dev/null 2>&1; then
    wget -qO "$2" "$1" || fail "could not download $1"
  else
    fail "needs curl or wget"
  fi
}

sha256_of() {
  if command -v sha256sum > /dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  elif command -v shasum > /dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d ' ' -f 1
  else
    fail "needs sha256sum or shasum to check the download"
  fi
}

verify() {
  expected=$(grep "  $2\$" "$1/checksums.txt" | cut -d ' ' -f 1 || true)
  [ -n "$expected" ] || fail "checksums.txt does not list $2"
  actual=$(sha256_of "$1/$2")
  [ "$expected" = "$actual" ] || fail "$2 does not match checksums.txt (expected $expected, got $actual). Nothing was installed"
}

path_hint() {
  case ":$PATH:" in
    *":$1:"*) ;;
    *)
      say ""
      say "$1 is not on your PATH. Add it, for example in ~/.profile:"
      say "  export PATH=\"$1:\$PATH\""
      ;;
  esac
}

main() {
  os=$(detect_os)
  arch=$(detect_arch "$os")
  if [ "$os" = linux ]; then refuse_musl; fi
  archive="testate_${os}_${arch}.tar.gz"
  url=$(base_url)
  dir=${TESTATE_INSTALL_DIR:-$HOME/.local/bin}

  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  trap 'exit 130' INT TERM
  say "Downloading $archive"
  download "$url/checksums.txt" "$tmp/checksums.txt"
  download "$url/$archive" "$tmp/$archive"
  verify "$tmp" "$archive"
  tar -xzf "$tmp/$archive" -C "$tmp"

  mkdir -p "$dir"
  # Copy then rename, so a running testate is replaced rather than written over.
  cp "$tmp/testate" "$dir/.testate.new"
  chmod 755 "$dir/.testate.new"
  mv "$dir/.testate.new" "$dir/testate"

  installed=$("$dir/testate" --version 2>&1) || fail "$dir/testate is in place but does not run here: $installed"
  say "Installed $installed to $dir/testate"
  path_hint "$dir"
  say ""
  say "Next: make a testate.env with a data directory, a sealing key and an admin password,"
  say "then start it: https://github.com/$REPO#one-binary-no-docker"
}

# Everything runs from here, so a download cut short runs nothing.
main "$@"
