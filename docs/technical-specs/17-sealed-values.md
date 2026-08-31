# 17. Sealed Values

A sealed value is a secret Testate must present to another system: a database password, a connection string, an S3 key, an SFTP password or private key, an FTP password, the snapshot-store credentials. Sealed values are encrypted at rest under the active key list, never displayed after entry, and re-sealed when the key rotates. This document is the single source for the envelope, the key list, the boot sweep, the refusals, declared loss, and the registry of sealed columns. The operator procedure lives in `../KEY_ROTATION.md`, which cites this document.

## 17.1 Decision matrix

| Concern | Decision | Rationale |
| --- | --- | --- |
| Cipher | AES-256-GCM through WebCrypto, 96-bit random nonce per record, 128-bit tag | Authenticated encryption, no library |
| Key material | `TESTATE_SECRETS_ACTIVE_KEY`: one to five base64 32-byte keys, comma separated; the first seals, every key opens | Reconflower procedure, single-process form |
| Envelope | `v1.<kid>.<nonce>.<ciphertext+tag>` in base64url, where `kid` is the first eight hex characters of SHA-256 over the key bytes | Self-describing; the sweep knows which key sealed each value |
| Associated data | `table:column:row_id` bound into GCM's additional data | A ciphertext cannot be moved between rows or columns |
| Write-only | The API accepts a new value or the sentinel `"keep"`; responses show `{ set: true, set_at, key_fingerprint }` | PRD story 34 |
| Sweep | At boot, after migrations, before the dispatcher: open every registry value, re-seal any not sealed by the first key, count, print the banner | Rotation is one restart |
| Refusals | Before any write, loud, named cause and fix (17 §17.5) | A bad rotation never destroys credentials |
| Declared loss | `TESTATE_SECRETS_ACCEPT_UNREADABLE=true` boots, names each unreadable value in the error log, disables the adapters that own them, accepts re-entry | Recovery by re-entry |
| Backups | Values stay sealed; the backup manifest lists the `kid`s present | A restore needs those keys listed |
| Logging | Sealed values are a branded type the logger refuses to serialize | Structural redaction |

## 17.2 Interface

```ts
// lib/sealed/index.ts
type Sealed = string & { readonly __sealed: unique symbol };
type KeyRing = { active: CryptoKey; activeKid: string; all: Map<string, CryptoKey> };   // built once at boot
loadKeyRing(env: string): KeyRing;                                   // throws SealedConfigError with the exact refusal
seal(ring: KeyRing, plaintext: string, aad: string): Promise<Sealed>;
open(ring: KeyRing, sealed: Sealed, aad: string): Promise<string>;   // throws UnreadableError { kid }
kidOf(sealed: Sealed): string;
sweep(ring: KeyRing, db, event): Promise<SweepReport>;               // { reSealed, unreadable: [{ table, column, rowId, kid }], skipped }
banner(report: SweepReport, ring: KeyRing): string;                  // framed text for the boot log
```

Registry entry shape:

```ts
export const SEALED_COLUMNS = [
  { table: "adapters",       column: "config_sealed",          owner: "adapter" },
  { table: "adapters",       column: "readonly_config_sealed", owner: "adapter" },
  { table: "settings",       column: "value",  key: "store.s3", owner: "settings" },   // sealed fields inside the JSON
] as const;
```

## 17.3 Boot sequence around keys

```text
1. loadKeyRing(TESTATE_SECRETS_ACTIVE_KEY)        refuse: missing, not base64, wrong length, duplicate, more than five
2. copy metadata.db, run migrations
3. sweep:
     for each registry entry, each row:
       kid = kidOf(value)
       if kid = activeKid: skip
       else if kid in ring: open, seal under active, update row (same transaction per row)
       else: unreadable += row
     if unreadable > 0 and not ACCEPT_UNREADABLE: refuse boot "N of M stored sealed values open with no configured key"
     if every stored value unreadable and ring has one key: refuse "no stored sealed value opens with the configured key(s)"
4. banner:
     SECRET KEY ROTATION COMPLETE        when reSealed > 0 and unreadable = 0
     SECRET KEY ROTATION NOT YET COMPLETE when a row changed during the sweep (retry next boot)
     EXTRA VALUE STILL CONFIGURED        when ring.all.size > 1 and reSealed = 0 and nothing unreadable
     (no banner)                         when ring has one key and nothing changed
5. info event: sealed_keys { active_fingerprint, extra_values, re_sealed, unreadable }
```

The health check exposes `active_fingerprint` and `extra_values` for admins, so an operator can confirm the fingerprint changed after a rotation without reading the log.

## 17.4 Sealed column registry

| Table | Column | Contents | Owner entity | Shown as |
| --- | --- | --- | --- | --- |
| `adapters` | `config_sealed` | JSON: `password`, `connection_string`, `access_key_id`, `secret_access_key`, `private_key`, `passphrase` secrets | adapter | `credential: { set, set_at, key_fingerprint }` |
| `adapters` | `readonly_config_sealed` | JSON: read-only credential | adapter | `readonly_credential: { set, ... }` |
| `settings` | `value` for key `store.s3` | `accessKeyId`, `secretAccessKey` inside the JSON | settings | `{ set, ... }` |

Rule: adding a `*_sealed` column, or a sealed field inside a JSON setting, updates `lib/sealed/registry.ts` and this table in the same pull request. A lint test scans the migrations for `_sealed` column names and fails when the registry lacks one.

## 17.5 Refusals

| Message | Cause | Fix |
| --- | --- | --- |
| `TESTATE_SECRETS_ACTIVE_KEY is not set` | Missing | Generate with `bun scripts/generate-key.ts`, set, restart |
| `value N in TESTATE_SECRETS_ACTIVE_KEY is empty / not valid base64 / N bytes (need 32)` | Malformed list | Fix the named position |
| `values N and M in TESTATE_SECRETS_ACTIVE_KEY are the same key` | Duplicate | Remove the duplicate |
| `TESTATE_SECRETS_ACTIVE_KEY holds N values; at most 5` | Too many | A list is one key, or new,old during a rotation |
| `no stored sealed value opens with the configured key(s)` | Key replaced without appending the old one | Set `<new>,<old>` and restart |
| `N of M stored sealed values open with no configured key` | Some rows sealed by an unlisted key, or damaged | Append the sealing key, or set `TESTATE_SECRETS_ACCEPT_UNREADABLE=true` and re-enter |
| Banner `EXTRA VALUE STILL CONFIGURED`, nothing re-sealed, fingerprint unchanged | Old key listed first | Swap to new-first and restart |

Rolling back a rotation is a rotation in reverse: the key to revert to goes first, the key that sealed the current data second; restart; wait for `COMPLETE`; drop the second value.

## 17.6 Declared loss

With `TESTATE_SECRETS_ACCEPT_UNREADABLE=true`: boot proceeds; each unreadable value is named in the error log (`table`, `column`, owner name); adapters owning one are set to status `disabled` with reason `credential_unreadable`; the dashboard shows them with a re-enter action; each save seals under the active key; when a boot reports zero unreadable values the flag is removed. The flag never deletes a value.

## 17.7 Performance targets

| Path | Target | Source |
| --- | --- | --- |
| Seal or open | under 1 ms per value | WebCrypto |
| Sweep | under 2 s for 10 000 values | Estimate |
| Boot delay from keys | under 100 ms when nothing changed | Design |

## 17.8 Security constraints

Keys come from the environment only, never from the volume or the database. The ring lives in process memory; keys are non-extractable `CryptoKey` objects. Sealed values never appear in API responses, audit rows, wide events, archives, or error messages. `open` is called only inside `adapters.resolve*` and the store driver factory; the plaintext lives in the connection config object that the engine pool and file drivers hold in memory and never return.

## 17.9 Component and contract

`lib/sealed/{index.ts, envelope.ts, keyring.ts, sweep.ts, registry.ts, banner.ts}`, `scripts/generate-key.ts`. Locked: the envelope format `v1.<kid>.<nonce>.<ct>`, the registry, the banner texts, and the refusal messages (operators grep for them).

## 17.10 What this does not do

- No key derivation from a passphrase; keys are raw random bytes (Reconflower parity).
- No hardware or KMS integration; the environment is the key holder.
- No per-project keys; one ring per instance.
- No encryption of blobs, logs, or the metadata database as a whole.

## 17.11 Cross-references

| Concern | Source |
| --- | --- |
| Operator procedure | `../KEY_ROTATION.md` |
| Which fields are secret per adapter | 06 §6.4 `config_public` versus `config_sealed` |
| Health exposure | 05 §5.15 |
| Backups | 05 §5.14, [22-base-path-and-boot.md](22-base-path-and-boot.md) |

## 17.12 Open follow-ups

| Item | Revisit when |
| --- | --- |
| Key from a mounted file instead of the environment | An orchestrator forbids secrets in env |
| Re-seal on demand from the settings page | Operators ask for rotation without a restart |
