# Native binaries and the install script (#53): decisions

Date: 2026-10-10

| # | Question | Decision | Why |
|---|----------|----------|-----|
| Q1 | Archive names? | No version in the name, Docker's architecture words: `testate_linux_amd64.tar.gz`, `testate_linux_arm64.tar.gz`, `testate_darwin_arm64.tar.gz`, `testate_darwin_amd64.tar.gz`, `testate_windows_amd64.zip`, plus one `checksums.txt` (SHA-256). The version lives in the tag: `releases/download/v2.0.0/testate_linux_amd64.tar.gz`. | GitHub's `releases/latest/download/<name>` then works with no API call, so the install script meets no rate limit. `amd64` matches the image's `linux/amd64`. A downloaded file does not show its version; `testate --version` does. |
| Q2 | Which targets? | Five: `linux_amd64` (Bun's `bun-linux-x64-baseline`), `linux_arm64`, `darwin_arm64`, `darwin_amd64`, `windows_amd64`. Each boots on its own runner before publishing. No musl and no `windows_arm64` for now. | Bun's default x64 build needs AVX2 and dies with "Illegal instruction" on CPUs, VMs and QEMU guests without it. Baseline runs everywhere; Testate waits on databases, not on the CPU. One Linux x64 build means the install script never inspects the CPU. Alpine users have the image; Windows on ARM emulates amd64. |
| Q3 | Install directory? | `~/.local/bin`, no sudo; `TESTATE_INSTALL_DIR` overrides it. The script says when that directory is not on `PATH` and prints the line to add. The systemd guide copies the binary with `sudo install -m 755 ~/.local/bin/testate /usr/local/bin/testate`, and the unit runs `/usr/local/bin/testate`. | Piping a downloaded script into sudo is the habit to avoid. A service user cannot read a home directory, so the unit cannot run the copy in `~/.local/bin`. |
| Q4 | Which user runs the systemd service? | `DynamicUser=yes` with `StateDirectory=testate`, plus `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome=yes`, `PrivateTmp`. `EnvironmentFile=/etc/testate/testate.env`, root-owned, mode 600. | No `useradd` step to get wrong, and #57's `testate service` writes the same unit with no user step either. systemd reads the env file as root before it drops privileges. The data sits at `/var/lib/private/testate` behind the `/var/lib/testate` link, so a backup tool running as another user needs root. |
| Q5 | How are the install script, systemd and pm2 proven? | In CI, before publishing. The binaries job builds the archives and `checksums.txt`, so the smoke jobs test the files that ship. The install script takes `TESTATE_DOWNLOAD_URL` (undocumented) to read them from a local server. Linux smoke: the script under dash and busybox `sh`, a corrupted archive refused, then systemd (start, restart, `kill -9`) and pm2 (start, restart), each answering `/health/live`. macOS smoke: the script under `/bin/sh`. `ci.yml` runs shellcheck on it. After publishing, one job runs the real one-liner from the Pages URL on Linux and macOS. | "A clean Linux and macOS" and "survives a restart" are what a fresh runner gives; a check by hand would have to be repeated every release. |

Stated from the code and the issue, not asked:

- `testate --version` and `-v` print `testate <version>` from `apps/api/src/version.ts` and exit. Any other argument still starts the server; subcommands belong to #57.
- The script is `docs/install.sh`, served by GitHub Pages at `https://pt-perkasa-pilar-utama.github.io/testate/install.sh`.
- Releases before v2.0.0 use the old names (`testate-1.2.0-linux-x64.tar.gz`) and have no `checksums.txt`; the script refuses them with a message.
- CI pins Bun `1.4.0` while development runs `1.4.2`; the binaries embed the CI version. Raise the pins together.
- Publishing to an existing release already works (`311a288`); v1.1.1 and v1.2.0 have their assets.

## Deferred

| Branch | Reason | Who decides |
|--------|--------|-------------|
| musl and `windows_arm64` builds | Nobody has asked; the image and emulation cover them | When a user asks |
| Homebrew tap, `install.ps1`, Scoop or winget | The issue's "After that" | After v2.0.0 |
