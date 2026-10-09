import { describe, expect, test } from "bun:test";
import * as v from "valibot";
import type { User } from "@testate/shared";
import { CHOOSE_SCOPE, editUserFormSchema, userDraftSchema } from "@testate/shared";

import { editDraftOf, scopeBody } from "./users.presenter.ts";

// #55: which projects a viewer or a tester reaches, as the user dialogs ask it.
const SHOP = "01991f00-0000-7000-8000-000000000021";

const USER: User = {
  id: "01991f00-0000-7000-8000-000000000031",
  username: "vera.viewer",
  display_name: "Vera",
  role: "viewer",
  must_change_password: false,
  disabled_at: null,
  locked_until: null,
  last_login_at: null,
  created_at: "2026-10-09T00:00:00.000Z",
  updated_at: "2026-10-09T00:00:00.000Z",
  project_ids: [SHOP],
};

describe("a user form's scope on the wire", () => {
  test("a viewer or a tester sends null for every project, or the pick", () => {
    expect(scopeBody({ role: "viewer", scope: "all", project_ids: [SHOP] })).toStrictEqual({
      project_ids: null,
    });
    expect(scopeBody({ role: "qa", scope: "chosen", project_ids: [] })).toStrictEqual({
      project_ids: [],
    });
  });

  test("an admin sends no scope: an admin has every project", () => {
    expect(scopeBody({ role: "admin", scope: "chosen", project_ids: [SHOP] })).toStrictEqual({});
  });
});

describe("the edit dialog's starting values", () => {
  test("a viewer's stored scope is prefilled", () => {
    expect(editDraftOf(USER)).toStrictEqual({
      display_name: "Vera",
      role: "viewer",
      scope: "chosen",
      project_ids: [SHOP],
    });
  });

  test("an admin starts with no answer, so a demotion must give one (Q9)", () => {
    const admin = editDraftOf({ ...USER, role: "admin", project_ids: null });
    expect(admin.scope).toBeUndefined();
    const demoted = v.safeParse(editUserFormSchema, { ...admin, role: "qa" });
    expect(demoted.issues?.map((issue) => [v.getDotPath(issue), issue.message])).toStrictEqual([
      ["scope", CHOOSE_SCOPE],
    ]);
  });
});

describe("the new-user form", () => {
  const draft = {
    username: "vera.viewer",
    display_name: "Vera",
    temporary_password: "temporary-password-1",
    project_ids: [],
  };

  test("a viewer must be given every project or a pick, possibly empty (Q3, Q7)", () => {
    const unanswered = v.safeParse(userDraftSchema, { ...draft, role: "viewer", scope: undefined });
    expect(unanswered.issues?.map((issue) => v.getDotPath(issue))).toStrictEqual(["scope"]);
    expect(
      v.safeParse(userDraftSchema, { ...draft, role: "viewer", scope: "chosen" }).success
    ).toBe(true);
  });

  test("an admin is not asked", () => {
    expect(
      v.safeParse(userDraftSchema, { ...draft, role: "admin", scope: undefined }).success
    ).toBe(true);
  });
});
