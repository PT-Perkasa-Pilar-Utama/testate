import { describe, expect, test } from "bun:test";
import * as v from "valibot";

import type { TokenDraft } from "@testate/shared";
import { PICK_AT_LEAST_ONE, projectIdsOf, scopeFieldsOf, tokenDraftSchema } from "@testate/shared";

import { toCreateBody } from "./tokens.presenter.ts";

// #55: a form asks "every project, or these?"; the wire says `null` or a list.
const SHOP = "01991f00-0000-7000-8000-000000000021";

describe("a scope between the form and the wire", () => {
  test("every project is null on the wire, whatever was ticked before", () => {
    expect(projectIdsOf("all", [SHOP])).toBeNull();
  });

  test("a pick is the list, even an empty one", () => {
    expect(projectIdsOf("chosen", [SHOP])).toEqual([SHOP]);
    expect(projectIdsOf("chosen", [])).toEqual([]);
  });

  test("a stored scope prefills the form it came from", () => {
    expect(scopeFieldsOf(null)).toEqual({ scope: "all", project_ids: [] });
    expect(scopeFieldsOf([SHOP])).toEqual({ scope: "chosen", project_ids: [SHOP] });
    expect(scopeFieldsOf([])).toEqual({ scope: "chosen", project_ids: [] });
  });
});

describe("the token dialog's scope", () => {
  const draft = {
    name: "ci",
    kind: "standard",
    role: "qa",
    expiry: "default",
    expires_on: "",
    project_ids: [],
  };
  const messages = (input: v.InferInput<v.GenericSchema>) =>
    v
      .safeParse(tokenDraftSchema, input)
      .issues?.map((issue) => [v.getDotPath(issue), issue.message]);

  test("refuses until someone chooses, and says so under the choice", () => {
    expect(messages({ ...draft, scope: undefined })).toEqual([
      ["scope", "Choose every project, or pick the projects."],
    ]);
  });

  test("a token that reaches no project is refused under the list", () => {
    expect(messages({ ...draft, scope: "chosen" })).toEqual([["project_ids", PICK_AT_LEAST_ONE]]);
  });

  test("every project, or at least one, passes", () => {
    expect(messages({ ...draft, scope: "all" })).toBeUndefined();
    expect(messages({ ...draft, scope: "chosen", project_ids: [SHOP] })).toBeUndefined();
  });
});

describe("the dialog's draft as the create body", () => {
  const draft: Omit<TokenDraft, "scope" | "project_ids"> = {
    name: " ci ",
    kind: "standard",
    role: "qa",
    expiry: "default",
    expires_on: "",
  };

  test("always states the scope: null for every project, or the list", () => {
    expect(toCreateBody({ ...draft, scope: "all", project_ids: [SHOP] })).toEqual({
      name: "ci",
      kind: "standard",
      role: "qa",
      project_ids: null,
    });
    expect(toCreateBody({ ...draft, scope: "chosen", project_ids: [SHOP] })).toMatchObject({
      project_ids: [SHOP],
    });
  });
});
