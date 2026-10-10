import { describe, expect, it } from "bun:test";

import { journalEntryOf } from "./parse.ts";

// #86, J6: a journal line keeps its time, level, message and four origin fields; every other field,
// `_CMDLINE` among them, is dropped.
const LINE = JSON.stringify({
  __CURSOR: "s=a;i=1;b=b;m=1;t=1;x=1",
  __REALTIME_TIMESTAMP: "1791619200123456",
  PRIORITY: "3",
  MESSAGE: "refund failed",
  _SYSTEMD_UNIT: "api.service",
  SYSLOG_IDENTIFIER: "api",
  _PID: "4242",
  _HOSTNAME: "sit-1",
  _CMDLINE: "node server.js --db-password=hunter2",
});

describe("a journal line", () => {
  it("keeps its time, level, message and origin, and drops every other field", () => {
    expect(journalEntryOf(LINE)).toEqual({
      cursor: "s=a;i=1;b=b;m=1;t=1;x=1",
      time: 1791619200123,
      level: "error",
      message: "refund failed",
      fields: { unit: "api.service", identifier: "api", pid: "4242", host: "sit-1" },
    });
  });

  it("decodes a message journald stored as bytes, and names one that is not text", () => {
    const bytes = (message: number[]) =>
      journalEntryOf(
        JSON.stringify({ __CURSOR: "c", __REALTIME_TIMESTAMP: "1000", MESSAGE: message })
      );
    expect([bytes([104, 105])?.message, bytes([255, 254])?.message]).toEqual(["hi", "<binary>"]);
  });

  it("is null for a line that is not an entry", () => {
    expect([journalEntryOf("-- No entries --"), journalEntryOf('{"MESSAGE":"no cursor"}')]).toEqual(
      [null, null]
    );
  });
});
