export const ORG = {
  name: "PT. Perkasa Pilar Utama",
  tagline: "Innovation Towards Intelligence",
  site: "https://ppu.co.id",
  email: "sales@ppu.co.id",
  x: "https://x.com/perkasaid",
  github: "https://github.com/PT-Perkasa-Pilar-Utama",
} as const;

const REPO = "https://github.com/PT-Perkasa-Pilar-Utama/testate";

/**
 * The version this bundle was built from. `apps/web/vite.config.ts` substitutes it, the same way
 * `BASE_URL` arrives; under `bun test` there is no env at all, hence the fallback.
 */
function version(): string {
  return import.meta.env?.VITE_TESTATE_VERSION ?? "unknown";
}

/**
 * The body of a bug report, which is only ever what this app already knows about itself.
 *
 * What it deliberately leaves out is the point. No cookie, no token, no field the person typed,
 * no row from any database. Testate's promise is that your data stays on your network, and a
 * report that quietly carried some of it to GitHub would break exactly that promise. The version,
 * the route and the error are the three things that make a report reproducible, and none of them
 * is yours.
 *
 * Nothing is sent from here either. The link opens GitHub's own new-issue form with these fields
 * filled in, and it is not a report until the person reads it and presses submit.
 */
export function reportBody(where: string, detail: string): string {
  return [
    "<!-- Please add what you were doing, and check the details below before submitting. -->",
    "",
    "## What I was doing",
    "",
    "",
    "## What happened",
    "",
    "```",
    detail.slice(0, 1500),
    "```",
    "",
    "## Details",
    "",
    `- Testate: ${version()}`,
    `- Screen: ${where}`,
    `- Browser: ${navigator.userAgent}`,
    `- When: ${new Date().toISOString()}`,
  ].join("\n");
}

/** GitHub's new-issue form, prefilled. Opening it sends nothing; submitting is the person's call. */
export function reportUrl(where: string, detail: string): string {
  const query = new URLSearchParams({
    title: `Error on ${where}`,
    body: reportBody(where, detail),
    labels: "bug",
  });
  return `${REPO}/issues/new?${query.toString()}`;
}
