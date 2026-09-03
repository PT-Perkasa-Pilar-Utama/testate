import { describe, expect, it } from "bun:test";
import * as v from "valibot";

import { changePasswordSchema, passwordWeakness, resetPasswordSchema } from "@testate/shared";

describe("password rules", () => {
  it("refuses the common list, on the form and on the server", () => {
    const weak = { current: "x", next: "Welcome123456" };
    const fine = { current: "x", next: "a-fine-password-2026" };
    expect(v.safeParse(changePasswordSchema, weak).success).toBe(false);
    expect(v.safeParse(changePasswordSchema, fine).success).toBe(true);
    expect(passwordWeakness("welcome123456")).toMatch(/guess list/);
    // The rule reaches the two passwords an admin sets for someone else as well.
    expect(v.safeParse(resetPasswordSchema, { temporary_password: "Welcome123456" }).success).toBe(
      false
    );
    // The account's name is not a rule: the bootstrap account is called admin.
    expect(passwordWeakness("admin-final-password-1")).toBeNull();
  });
});
