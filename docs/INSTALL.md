# Install Testate

Testate ships as one binary per platform and as a container image. This page covers the
binary, the other ways to run it, and how to check a download. The container is in the
[Deployment plan](DEPLOYMENT_PLAN.md).

## One binary

Every release has a binary for Linux (x86-64 and ARM64), macOS (Apple silicon and Intel) and Windows (x86-64). The dashboard and the migrations are inside it, and so is the tool that sets it up:

```sh
curl -fsSL https://pt-perkasa-pilar-utama.github.io/testate/install.sh | sh
testate setup                  # data directory, port, sealing key, first admin
testate service install        # keeps it running and starts it at boot (Linux, macOS)
testate update                 # later: the next release, verified, swapped in
```

The install script puts `testate` in `~/.local/bin` and checks the archive against the release's `checksums.txt`; `wget -qO- <same URL> | sh` works too. `TESTATE_VERSION=2.0.0` installs one release, and `TESTATE_INSTALL_DIR` picks another directory. On Windows, download `testate_windows_amd64.zip` from the [releases page](https://github.com/PT-Perkasa-Pilar-Utama/testate/releases); `testate service` is not available there yet. On Alpine (musl), run the image.

`testate setup` writes `~/.config/testate/testate.env` (mode 600) with a new sealing key, and the data goes to `~/.local/share/testate`. Back up the env file: without the key, the stored credentials cannot be read. Running `setup` again keeps the key. For a script, `TESTATE_ADMIN_PASSWORD=... testate setup --yes` asks nothing.

`testate service install` makes a per-user service: a systemd user unit on Linux, a LaunchAgent on macOS. It restarts Testate after a crash and starts it at boot. `testate service status`, `logs -f`, `stop`, `start` and `uninstall` manage it. On Linux, starting before anyone logs in needs `sudo loginctl enable-linger $USER` once; `install` says so when it cannot do it itself.

`testate update --check` says whether a newer release is out; `testate update` installs it and restarts the service. These two are the only commands that contact the network. Testate never checks on its own.

`testate whereis` lists every file it uses and whether it is there; `testate whereis env` prints just the env file's path. `testate help` lists the commands.

**Where settings come from.** `testate` reads `--env-file <path>`, else `~/.config/testate/testate.env` when it exists, and then the process environment, which wins over the file. A `.env` next to the binary is not read; pass it with `--env-file`. Every variable in [`deploy/.env.example`](../deploy/.env.example) works the same way. Testate listens on 7378 unless `setup` chose another port.

## Other ways to run it

All of them read the same env file.

In the foreground, or in the background:

```sh
testate                                          # Ctrl-C stops it; running jobs get 30 s
nohup testate > testate.log 2>&1 & echo $! > testate.pid
kill "$(cat testate.pid)"
```

As a system-wide systemd service, with its own user and the data in `/var/lib/testate`:

```sh
sudo install -m 755 ~/.local/bin/testate /usr/local/bin/testate
sudo install -d -m 700 /etc/testate
sudo install -m 600 "$(testate whereis env)" /etc/testate/testate.env
curl -fsSL https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/testate/main/deploy/systemd/testate.service \
  | sudo tee /etc/systemd/system/testate.service > /dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now testate
```

Under pm2:

```sh
curl -fsSLO https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/testate/main/deploy/pm2/ecosystem.config.cjs
TESTATE_ENV_FILE="$(testate whereis env)" pm2 start ecosystem.config.cjs
pm2 save                       # and `pm2 startup` once, to start it at boot
```

## Verify a download

Every release is built by this repository's own workflow and leaves a trail you can check without trusting us: SLSA build provenance and a keyless Sigstore signature on the image and on every binary, plus a CycloneDX SBOM.

```sh
gh attestation verify oci://ghcr.io/pt-perkasa-pilar-utama/testate:1.2.0 \
  --repo PT-Perkasa-Pilar-Utama/testate
cosign verify ghcr.io/pt-perkasa-pilar-utama/testate:1.2.0 \
  --certificate-identity-regexp 'https://github.com/PT-Perkasa-Pilar-Utama/testate/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Both commands hold for `docker.io/snowfluke/testate:1.2.0` too: it is the same manifest, copied by digest and signed again where it lives.

For a binary, run the same two commands on the archive, with `--bundle <archive>.sigstore.json` for cosign; the release also carries `testate.intoto.jsonl`, the provenance statement for every archive, for a check without network access (`gh attestation verify <archive> --bundle <that file>`). A download that fails either check is not ours; [SECURITY.md](../SECURITY.md) says how to report it.
