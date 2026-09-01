import { describe, expect, test } from "bun:test";

import * as v from "valibot";
import {
  RESERVED_SLUGS,
  SLUG_FALLBACK,
  createProjectSchema,
  freeSlug,
  projectSlug,
} from "@testate/shared";

describe("the slug a name turns into", () => {
  test("reads the name back, accents and all", () => {
    expect(projectSlug("Café München")).toBe("cafe-munchen");
    expect(projectSlug("PT. Perkasa Pilar Utama")).toBe("pt-perkasa-pilar-utama");
    expect(projectSlug("  Billing   API  ")).toBe("billing-api");
  });

  test("a name that transliterates to nothing still gets a slug", () => {
    expect(projectSlug("テスト")).toBe(SLUG_FALLBACK);
    expect(projectSlug("!")).toBe(SLUG_FALLBACK);
    // One character is a legal name and an illegal slug, so it takes the fallback too.
    expect(projectSlug("a")).toBe(SLUG_FALLBACK);
  });

  test("whatever it produces passes the schema every other caller validates against", () => {
    const names = [
      "Café München",
      "テスト",
      "a",
      "A very long project name that runs past the cap",
    ];
    for (const name of names) {
      const parsed = v.safeParse(createProjectSchema, { name, slug: projectSlug(name) });
      expect(parsed.success).toBe(true);
    }
  });
});

describe("what happens when the slug is taken", () => {
  test("counts up from 2 until one is free", () => {
    const used = new Set(["demo", "demo-2", "demo-3"]);
    expect(freeSlug("demo", (slug) => used.has(slug))).toBe("demo-4");
    expect(freeSlug("other", (slug) => used.has(slug))).toBe("other");
  });

  test("a word a route already answers to counts as taken", () => {
    // `defaults` is a route under /projects; a project called "Defaults" must not shadow it.
    expect(RESERVED_SLUGS).toContain("defaults");
    expect(freeSlug("defaults", () => false)).toBe("defaults-2");
  });
});
