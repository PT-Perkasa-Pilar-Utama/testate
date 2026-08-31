# 18. Outbound Address Policy

Testate opens connections to whatever address a user types: databases, buckets, SFTP and FTP hosts. That is a server-side request forgery surface by design. This document is the single source for the checks that run on every physical connection, the fixed denies, the admin deny list, and re-checks. Cite it; do not restate it.

## 18.1 Decision matrix

| Concern | Decision | Rationale |
| --- | --- | --- |
| When | At every physical connect, inside the engine pool, the file drivers, and the S3 store driver; never only at save time | A hostname allowed at save time can point elsewhere later |
| How | Resolve the hostname (A and AAAA), check every resolved address and the port, then connect to a checked address | DNS rebinding and TOCTOU are closed by connecting to what was checked |
| Fixed denies | Loopback is not fixed (see below); fixed: link-local `169.254.0.0/16`, `fe80::/10`; cloud metadata `169.254.169.254`, `fd00:ec2::254`, `metadata.google.internal`, `100.100.100.200`; unspecified `0.0.0.0`, `::`; multicast; Testate's own listening address and port | The classic SSRF targets and self-targeting |
| Default deny list | `127.0.0.0/8`, `::1/128`, editable and removable by an admin | A native dev setup with a local database needs loopback |
| Admin deny list | Hostname globs (`*.prod.internal`), CIDRs, and exact host:port pairs | Story 29 |
| Allow overrides | None; a deny is a deny | Simplicity and story 23's intent |
| Re-check | Changing the list re-resolves and re-checks every adapter; matches become `disabled` with reason `policy`; a later retest that passes re-enables | Story 30 |
| SRV and driver-side resolution | MongoDB `mongodb+srv://` is resolved by Testate first; the checked addresses are passed to the driver as a seed list | The driver must not resolve on its own |
| Proxies | No outbound proxy support; connections are direct | Intranet deployment |

## 18.2 Interface

```ts
// lib/netguard/index.ts
type Check = { host: string; port: number; purpose: "database" | "files" | "store" };
type Verdict = { allowed: true; addresses: string[] } | { allowed: false; reason: "fixed" | "policy" | "self" | "unresolvable"; matched: string };
check(input: Check, policy: DenyList, self: { addresses: string[]; port: number }): Promise<Verdict>;
matchesDenyList(host: string, addresses: string[], port: number, policy: DenyList): string | null;   // pure
```

`DenyList` is the parsed `netguard.deny` setting: `{ hosts: Glob[]; cidrs: Cidr[]; hostPorts: { host; port }[] }`.

## 18.3 Check order

```text
1. host is an IP literal? use it; else resolve A and AAAA (timeout 3 s) -> unresolvable = deny
2. for each address:
     in a fixed range           -> deny "fixed"
     equals a self address and port = PORT -> deny "self"
     matches deny list (host glob on the name, CIDR on the address, host:port on both) -> deny "policy"
3. allow with the checked address list; the caller connects to one of them (first success)
```

Hostname globs match case-insensitively against the typed host and against reverse names when present; a glob never matches an IP literal.

## 18.4 Where it runs

| Caller | Point | On deny |
| --- | --- | --- |
| `adapters.testDraft`, `create`, `update`, `retest` | Before probe | `HOST_BLOCKED` 422 with `reason` and `matched` |
| `lib/engines` pool | Every new physical connection | `EngineError{ kind: "unreachable", details: { reason: "blocked_address" } }` → `HOST_BLOCKED` |
| `lib/files` drivers | Every connect (SFTP, FTP) and every S3 request host | `HOST_BLOCKED` |
| `lib/blobstore` S3 driver | Every request host | Job fails; health reports the store |
| `settings.update` (deny list) | After save | `adapters.recheckDenyList` disables matches; audit `settings.deny_list_changed` with the disabled ids |

## 18.5 Performance targets

| Path | Target | Source |
| --- | --- | --- |
| Check with a cached resolution | under 1 ms | Resolution cache 60 s |
| Check with resolution | under 50 ms on the intranet | DNS |
| Re-check after list change | under 5 s for 100 adapters | Parallel resolution |

## 18.6 Security constraints

The check is the same code for every caller; no caller may bypass it. The resolution cache is keyed by hostname and expires in 60 s; a cached entry is still checked against the list on every call, so a list change takes effect at once. Denials write an audit row with the actor, the host, and the matched rule; they never write the credential.

## 18.7 Component and contract

`lib/netguard/{index.ts, resolve.ts, ranges.ts, denylist.ts}`. Locked: the fixed ranges, the verdict shape, and the rule that the caller connects only to a returned address.

## 18.8 What this does not do

- No allow list; the model is "everything except denies".
- No egress firewall; the deployment plan recommends network policy on the host.
- No outbound proxy or tunnel.
- No inspection of what the connection carries.

## 18.9 Cross-references

| Concern | Source |
| --- | --- |
| Threat model | 07 §7.1, §7.4 |
| Pool | [12-engine-port.md](12-engine-port.md) §12.1 |
| Setting key | 06 §6.8 `netguard.deny` |

## 18.10 Open follow-ups

| Item | Revisit when |
| --- | --- |
| Per-project allow lists | An organization wants one Testate to reach several segmented networks with different rules |
| IPv6 zone identifiers | A user needs link-local IPv6 with a zone, which is denied today |
