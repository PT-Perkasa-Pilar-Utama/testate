import { describe, expect, it } from "bun:test";

import { digestOf } from "./serverlog.ts";

// #84, D7: a masked reader sees MySQL's digest, and a failed statement's error after it with its
// values taken out, never the value that failed.
describe("a MySQL statement for a masked reader", () => {
  it("keeps the digest, and the error's sentence with its values taken out", () => {
    expect([
      digestOf(
        "INSERT INTO `users` (`email`) VALUES (?)",
        "Duplicate entry 'ana@shop.test' for key 'email'"
      ),
      digestOf("SELECT ?", ""),
      digestOf(null, "anything"),
    ]).toEqual([
      "INSERT INTO `users` (`email`) VALUES (?)\nDuplicate entry ? for key ?",
      "SELECT ?",
      null,
    ]);
  });
});
