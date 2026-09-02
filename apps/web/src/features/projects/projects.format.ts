import type { BadgeProps } from "@/components/badge.tsx";
import type { MeterProps } from "@/components/meter.tsx";
import type { Head, Quota } from "@testate/shared";

type HeadTone = NonNullable<BadgeProps["variant"]>;

const HEAD_TONE = {
  at_state: "success",
  unknown: "warning",
  none: "secondary",
} as const satisfies Record<Head["status"], HeadTone>;

export type HeadBadge = { tone: HeadTone; label: string };

/** The badge for a project's HEAD: the enum word `head.status` stores is not what a person calls it. */
export function headBadge(head: Head): HeadBadge {
  const tone = HEAD_TONE[head.status];
  if (head.status === "at_state") {
    const name = head.state_name ?? "at a state";
    // Known to have moved on: Testate wrote to the databases, or a diff against live found rows
    // that changed. The state is still the reference point, so it keeps its name in the pill.
    return head.dirty ? { tone: "warning", label: `${name} · modified` } : { tone, label: name };
  }
  if (head.status === "unknown") return { tone, label: "unknown" };
  return { tone, label: "no state yet" };
}

/**
 * Quiet until it matters: `default` below the 80% warn line the API already computes, `warning`
 * from there to full, `danger` at or past the quota itself. A project with no quota (0 bytes) has
 * nothing to be near, so it never shouts.
 */
export function quotaTone(quota: Quota): NonNullable<MeterProps["tone"]> {
  if (quota.quota_bytes <= 0) return "default";
  if (quota.used_bytes >= quota.quota_bytes) return "danger";
  if (quota.used_bytes >= quota.warn_at_bytes) return "warning";
  return "default";
}
