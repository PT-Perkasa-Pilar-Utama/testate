import { describe, expect, test } from "bun:test";

import { ORG, reportBody, reportUrl } from "./report.ts";

describe("what a bug report carries", () => {
  test("the three things that make it reproducible, and a place to say what you did", () => {
    const body = reportBody("/projects/demo", "TypeError: x is not a function");
    expect(body).toContain("Testate:");
    expect(body).toContain("Screen: /projects/demo");
    expect(body).toContain("Browser:");
    expect(body).toContain("TypeError: x is not a function");
    expect(body).toContain("What I was doing");
  });

  test("a long error is cut, so the link stays a link", () => {
    // Browsers stop honouring a URL somewhere past 2000 characters, and a stack can be longer
    // than that on its own.
    const body = reportBody("/x", "e".repeat(9000));
    expect(body.length).toBeLessThan(2200);
  });

  test("the link opens GitHub's form on this repository and sends nothing itself", () => {
    const url = new URL(reportUrl("/login", "boom"));
    expect(url.origin).toBe("https://github.com");
    expect(url.pathname).toBe("/PT-Perkasa-Pilar-Utama/testate/issues/new");
    expect(url.searchParams.get("labels")).toBe("bug");
    expect(url.searchParams.get("body")).toContain("boom");
  });

  test("the company details are the ones its GitHub organisation publishes", () => {
    expect(ORG.name).toBe("PT. Perkasa Pilar Utama");
    expect(ORG.email).toBe("sales@ppu.co.id");
    expect(ORG.x).toBe("https://x.com/perkasaid");
    expect(ORG.github).toBe("https://github.com/PT-Perkasa-Pilar-Utama");
  });
});
