import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/** What a connection wants to reach; `purpose` only labels the wide event. */
export type Check = {
  host: string;
  port: number;
  purpose: "database" | "files" | "store";
};

export type Verdict =
  | { allowed: true; addresses: string[] }
  | { allowed: false; reason: "fixed" | "policy" | "self" | "unresolvable"; matched: string };

/** The parsed `netguard.deny` setting: hostname globs, CIDRs, and exact host:port pairs. */
export type DenyList = {
  hosts: RegExp[];
  cidrs: BlockList;
  hostPorts: { host: string; port: number }[];
  raw: string[];
};

export type SelfAddress = { addresses: string[]; port: number };

/** Denies that no setting can remove (18 §18.1): link-local, cloud metadata, unspecified, multicast. */
const FIXED_CIDRS: readonly [string, number, 4 | 6][] = [
  ["169.254.0.0", 16, 4],
  ["fe80::", 10, 6],
  ["100.100.100.200", 32, 4],
  ["fd00:ec2::254", 128, 6],
  ["0.0.0.0", 32, 4],
  ["::", 128, 6],
  ["224.0.0.0", 4, 4],
  ["ff00::", 8, 6],
];
const FIXED_HOSTS = new Set(["metadata.google.internal"]);

const fixed = new BlockList();
for (const [address, prefix, family] of FIXED_CIDRS) {
  fixed.addSubnet(address, prefix, family === 4 ? "ipv4" : "ipv6");
}

function familyOf(address: string): "ipv4" | "ipv6" {
  return isIP(address) === 6 ? "ipv6" : "ipv4";
}

/** A hostname glob (`*.prod.internal`) becomes an anchored, case-insensitive regex. */
function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`, "i");
}

/** Parses the deny entries: `host:port`, `a.b.c.d/n`, `addr`, or a hostname glob. */
export function parseDenyList(entries: readonly string[]): DenyList {
  const list: DenyList = { hosts: [], cidrs: new BlockList(), hostPorts: [], raw: [...entries] };
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (trimmed === "") continue;
    const cidr = /^(.+)\/(\d{1,3})$/.exec(trimmed);
    if (cidr !== null && cidr[1] !== undefined && isIP(cidr[1]) !== 0) {
      list.cidrs.addSubnet(cidr[1], Number(cidr[2]), familyOf(cidr[1]));
      continue;
    }
    if (isIP(trimmed) !== 0) {
      list.cidrs.addAddress(trimmed, familyOf(trimmed));
      continue;
    }
    const hostPort = /^([^:*]+):(\d{1,5})$/.exec(trimmed);
    if (hostPort !== null && hostPort[1] !== undefined) {
      list.hostPorts.push({ host: hostPort[1].toLowerCase(), port: Number(hostPort[2]) });
      continue;
    }
    list.hosts.push(globToRegex(trimmed));
  }
  return list;
}

/** Pure: the deny entry a host, its addresses, and a port match, or null. */
export function matchesDenyList(
  host: string,
  addresses: readonly string[],
  port: number,
  policy: DenyList
): string | null {
  const lower = host.toLowerCase();
  const glob = policy.hosts.find((pattern) => pattern.test(lower));
  if (glob !== undefined) return glob.source;
  const pair = policy.hostPorts.find((item) => item.host === lower && item.port === port);
  if (pair !== undefined) return `${pair.host}:${pair.port}`;
  const address = addresses.find((item) => policy.cidrs.check(item, familyOf(item)));
  return address === undefined ? null : address;
}

async function resolve(host: string): Promise<string[] | null> {
  if (isIP(host) !== 0) return [host];
  try {
    const records = await lookup(host, { all: true, verbatim: true });
    return records.map((record) => record.address);
  } catch {
    return null;
  }
}

/**
 * Resolves the host, then refuses fixed targets, Testate itself, and the admin deny list, in that
 * order. The engine connects to one of the returned addresses, never to the name (18 §18.3).
 */
export async function check(input: Check, policy: DenyList, self: SelfAddress): Promise<Verdict> {
  const host = input.host.toLowerCase();
  if (FIXED_HOSTS.has(host)) return { allowed: false, reason: "fixed", matched: host };
  const addresses = await resolve(host);
  if (addresses === null || addresses.length === 0) {
    return { allowed: false, reason: "unresolvable", matched: host };
  }
  const fixedHit = addresses.find((address) => fixed.check(address, familyOf(address)));
  if (fixedHit !== undefined) return { allowed: false, reason: "fixed", matched: fixedHit };
  if (input.port === self.port) {
    const selfHit = addresses.find((address) => self.addresses.includes(address));
    if (selfHit !== undefined) return { allowed: false, reason: "self", matched: selfHit };
  }
  const matched = matchesDenyList(host, addresses, input.port, policy);
  if (matched !== null) return { allowed: false, reason: "policy", matched };
  return { allowed: true, addresses };
}
