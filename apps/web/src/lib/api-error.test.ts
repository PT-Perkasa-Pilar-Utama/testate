import { describe, expect, test } from "bun:test";

import { ApiError } from "./api-client.ts";
import { humanMessage, statusReason } from "./api-error.ts";

describe("what a person reads when a request fails", () => {
  test("the codes whose own wording says nothing are replaced outright", () => {
    // The one that started this: a wrong password showed the API's "authentication required".
    expect(humanMessage(new ApiError("UNAUTHORIZED", 401, "authentication required"), "x")).toBe(
      "Your session has ended. Sign in again."
    );
    expect(humanMessage(new ApiError("FORBIDDEN", 403, "forbidden"), "x")).toContain("role");
    expect(humanMessage(new ApiError("INTERNAL", 500, "internal error"), "x")).toContain("our end");
    expect(humanMessage(new ApiError("NOT_FOUND", 404, "adapter not found"), "x")).toContain(
      "no longer here"
    );
  });

  test("a message written for a person survives, as a sentence", () => {
    // The API says "adapter name is taken", which is already the right thing to tell someone.
    expect(humanMessage(new ApiError("CONFLICT", 409, "adapter name is taken"), "x")).toBe(
      "Adapter name is taken."
    );
    // One full stop, not two.
    expect(humanMessage(new ApiError("CONFLICT", 409, "Already gone."), "x")).toBe("Already gone.");
  });

  test("a wait is a number when the server sent one, and a moment when it did not", () => {
    expect(
      humanMessage(new ApiError("RATE_LIMITED", 429, "too many", { retry_after: 42 }), "x")
    ).toBe("Too many attempts. Try again in 42 seconds.");
    expect(
      humanMessage(new ApiError("RATE_LIMITED", 429, "too many", { retry_after: 1 }), "x")
    ).toBe("Too many attempts. Try again in 1 second.");
    expect(humanMessage(new ApiError("RATE_LIMITED", 429, "too many"), "x")).toContain("a moment");
  });

  test("anything that is not an API answer never reaches the screen as itself", () => {
    // A failed fetch carries a browser's own wording, which is worse than useless to a person.
    expect(humanMessage(new TypeError("Load failed"), "Could not save.")).toBe(
      "Could not reach Testate. Check your connection and try again."
    );
    expect(humanMessage("something threw a string", "Could not save.")).toContain(
      "Could not reach"
    );
  });

  test("the caller's own sentence stands in when the server said nothing", () => {
    expect(humanMessage(new ApiError("CONFLICT", 409, ""), "could not create the project")).toBe(
      "Could not create the project."
    );
  });

  test("a stored reason code is translated; an engine's own answer is not", () => {
    expect(statusReason("credential_unreadable")).toContain("Re-enter them");
    // The probe's answer is what an operator came to read.
    expect(statusReason("connection refused")).toBe("connection refused");
    expect(statusReason(null)).toBeNull();
  });
});
