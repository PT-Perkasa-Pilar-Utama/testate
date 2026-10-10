import type { AdapterKind } from "@testate/shared";

/** The tier menu an adapter is listed under (a tier is a menu, #63). */
export type TierMenu = { to: string; label: string; eyebrow: string };

/** Where an adapter page's back-link and a finished deletion lead, and the page's eyebrow. */
export function menuOf(kind: AdapterKind, slug: string): TierMenu {
  const project = encodeURIComponent(slug);
  const menus = {
    database: {
      to: `/databases?project=${project}`,
      label: "Back to Databases",
      eyebrow: "Database",
    },
    storage: { to: "/storage", label: "Back to Storage", eyebrow: "Storage" },
    logs: { to: `/logs?project=${project}`, label: "Back to Logs", eyebrow: "Logs" },
  } as const satisfies Record<AdapterKind, TierMenu>;
  return menus[kind];
}
