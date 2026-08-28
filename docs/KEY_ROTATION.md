# Key Rotation

How to rotate the key that seals credentials without losing one. Design: [technical-specs/17-sealed-values.md](technical-specs/17-sealed-values.md).

## What the key protects

Every secret an admin enters is sealed with AES-256-GCM before it reaches SQLite: adapter passwords and connection strings, S3 keys, SFTP private keys, secret REST headers, the S3 store credentials in settings. A sealed value looks like `v1.<kid>.<nonce>.<ciphertext>`. `kid` is the fingerprint of the key that sealed it.

`TESTATE_SECRETS_ACTIVE_KEY` holds one to five base64 keys, comma separated. **The first key seals. Every listed key opens.**

## Rotate

1. Generate a key: `bun scripts/generate-key.ts` (or `openssl rand -base64 32`).
2. Set `TESTATE_SECRETS_ACTIVE_KEY=<new>,<old>`. New first.
3. Restart the instance.
4. Boot re-seals every stored value under the new key and prints one banner:

   | Banner | Meaning | Next step |
   | --- | --- | --- |
   | `SECRET KEY ROTATION COMPLETE` | Every value now carries the new `kid` | Go to step 5 |
   | `SECRET KEY ROTATION NOT YET COMPLETE` | A row changed during the sweep | Restart once more |
   | `EXTRA VALUE STILL CONFIGURED` | Nothing re-sealed; the old key is first | Swap the order, restart |

5. Confirm on `GET /api/v1/health` as admin: `checks.sealed_keys.active_fingerprint` shows the new `kid`.
6. Set `TESTATE_SECRETS_ACTIVE_KEY=<new>` and restart. `extra_values` returns to `0`.

Total: two restarts. No downtime beyond them. Nothing is written until step 3 succeeds.

## Roll back

A rollback is a rotation in reverse: `<key to revert to>,<key that sealed the data>`, restart, wait for `COMPLETE`, drop the second value.

## Refusals

Boot stops before any write and names the fix:

| Message | Cause | Fix |
| --- | --- | --- |
| `TESTATE_SECRETS_ACTIVE_KEY is not set` | Missing | Generate, set, restart |
| `value N ... not valid base64 / N bytes (need 32)` | Malformed entry | Fix position N |
| `values N and M ... are the same key` | Duplicate | Remove one |
| `holds N values; at most 5` | Too many | Keep new and old only |
| `no stored sealed value opens with the configured key(s)` | Old key dropped too early | Set `<new>,<old>`, restart |
| `N of M stored sealed values open with no configured key` | Some rows sealed by an unlisted key | Append that key, or declare loss |

## Declared loss

When the old key is gone for good, set `TESTATE_SECRETS_ACCEPT_UNREADABLE=true`. Boot proceeds, names every unreadable value in the error log, and disables the adapters and REST requests that own them (`credential_unreadable`). Re-enter each credential in the UI; each save seals under the active key. When a boot reports zero unreadable values, remove the flag. The flag never deletes a value.

## Backups

Backups keep values sealed and list the `kid`s present in their manifest. A restore needs those keys in `TESTATE_SECRETS_ACTIVE_KEY`. Store the key list with the same care as the backup.

## Checklist

- [ ] New key generated with 32 random bytes
- [ ] `<new>,<old>` set; restart; `COMPLETE` banner seen
- [ ] Health shows the new fingerprint
- [ ] `<new>` alone set; restart; `extra_values` is `0`
- [ ] Old key removed from the secret store after the backup retention window
