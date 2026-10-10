import { describe, expect, it } from "bun:test";
import { logsQuerySchema } from "@testate/shared";
import * as v from "valibot";

import { fallbackLevel, levelOf, timeOf } from "./fields.ts";
import { LINE_CAP, jsonLines, parserFor, plain, pm2, regexParser, testate } from "./parse.ts";
import { syslog, yearless } from "./parse.syslog.ts";

// docs/decisions/2026-10-10-logs-tier.md, parser rules: every format, and the fallbacks.
const T = Date.parse("2026-10-10T08:15:30.000Z");

describe("times and levels", () => {
  it("reads ISO with and without a zone (UTC), epoch seconds and milliseconds", () => {
    expect([
      timeOf("2026-10-10T08:15:30Z"),
      timeOf("2026-10-10 08:15:30"),
      timeOf("2026-10-10T10:15:30+02:00"),
      timeOf(T / 1000),
      timeOf(T),
      timeOf("yesterday"),
    ]).toEqual([T, T, T, T, T, null]);
  });

  it("maps words and pino numbers to levels, and an error log's file to error", () => {
    expect([
      levelOf("WARNING"),
      levelOf("err"),
      levelOf(30),
      levelOf(50),
      levelOf(60),
      levelOf("x"),
    ]).toEqual(["warn", "error", "info", "error", "fatal", null]);
    expect([fallbackLevel("api-error.log"), fallbackLevel("api-out.log")]).toEqual([
      "error",
      "info",
    ]);
  });
});

describe("the formats", () => {
  it("pm2: the --time prefix, the json log type, and plain lines with no time", () => {
    expect(pm2("2026-10-10T08:15:30: GET /orders 200")).toMatchObject({
      time: T,
      message: "GET /orders 200",
    });
    const json =
      '{"message":"boom\\n","timestamp":"2026-10-10T08:15:30.000Z","type":"err","app_name":"api"}';
    expect(pm2(json)).toEqual({ time: T, level: "error", message: "boom", fields: null });
    expect(pm2("listening on 3000")).toEqual({
      time: null,
      level: null,
      message: "listening on 3000",
      fields: null,
    });
  });

  it("json lines: pino's keys, the rest kept as fields, a broken line read as plain", () => {
    expect(jsonLines(`{"level":40,"time":${T},"msg":"slow query","ms":812}`)).toEqual({
      time: T,
      level: "warn",
      message: "slow query",
      fields: { ms: 812 },
    });
    expect(
      jsonLines('{"log":{"level":"error"},"@timestamp":"2026-10-10T08:15:30Z","message":"x"}')
    ).toMatchObject({
      level: "error",
      time: T,
    });
    expect(jsonLines('{"msg": "cut off')).toMatchObject({
      time: null,
      message: '{"msg": "cut off',
    });
  });

  it("testate: a request and a job each read as one sentence, with the error appended", () => {
    const request = `{"ts":"2026-10-10T08:15:30Z","kind":"request","level":"info","request":{"method":"GET","path":"/api/v1/health/live","status":204}}`;
    const job = `{"ts":"2026-10-10T08:15:30Z","kind":"job","level":"error","job":{"kind":"snapshot","status":"failed"},"error":{"message":"refused"}}`;
    expect([testate(request).message, testate(job).message, testate(job).level]).toEqual([
      "GET /api/v1/health/live 204",
      "job snapshot failed: refused",
      "error",
    ]);
  });

  it("testate: an app's own message comes first, and leaves the fields", () => {
    const pushed = `{"ts":"2026-10-10T08:15:30Z","level":"warn","message":"refund retried","service":{"name":"billing"},"request":{"method":"POST","path":"/refunds"}}`;
    const parsed = testate(pushed);
    expect([parsed.message, parsed.level, parsed.fields]).toEqual([
      "refund retried",
      "warn",
      { service: { name: "billing" }, request: { method: "POST", path: "/refunds" } },
    ]);
  });

  it("syslog: RFC 5424, and RFC 3164 with no year read as this year or the last", () => {
    expect(syslog("<11>1 2026-10-10T08:15:30Z web-1 nginx 77 - - upstream timed out")).toEqual({
      time: T,
      level: "error",
      message: "upstream timed out",
      fields: { host: "web-1", app: "nginx" },
    });
    expect(syslog("<14>Oct 10 08:15:30 web-1 sshd[77]: accepted", T)).toMatchObject({
      time: T,
      level: "info",
    });
    expect(yearless("Dec", "31", "23:00:00", T)).toBe(Date.parse("2025-12-31T23:00:00Z"));
  });

  it("regex: named groups become the time, level and message; others become fields", () => {
    const parse = regexParser(
      "^(?<time>\\S+ \\S+) (?<level>\\w+) \\[(?<thread>[^\\]]+)\\] (?<message>.*)$"
    );
    expect(parse("2026-10-10 08:15:30 ERROR [main] it broke")).toEqual({
      time: T,
      level: "error",
      message: "it broke",
      fields: { thread: "main" },
    });
    expect(parse("no match here")).toMatchObject({ message: "no match here", time: null });
  });

  it("plain: a leading timestamp and level word when present, a continuation line when not", () => {
    expect(plain("2026-10-10 08:15:30,000 ERROR it broke")).toEqual({
      time: T,
      level: "error",
      message: "it broke",
      fields: null,
    });
    expect(plain("    at handler (server.ts:42)")).toMatchObject({ time: null, level: null });
  });

  it("cuts a line at 16 KB before any pattern sees it", () => {
    const long = `2026-10-10T08:15:30Z ${"x".repeat(LINE_CAP * 2)}`;
    expect(parserFor({ format: "plain" })(long).message.length).toBeLessThan(LINE_CAP);
  });
});

describe("the read query", () => {
  it("refuses a window longer than 7 days and takes limit as a query-string number", () => {
    const week = {
      source: "api",
      from: "2026-10-01T00:00:00Z",
      to: "2026-10-08T00:00:00Z",
      limit: "50",
    };
    const longer = { source: "api", from: "2026-10-01T00:00:00Z", to: "2026-10-08T00:00:01Z" };
    expect(v.parse(logsQuerySchema, week).limit).toBe(50);
    expect(v.safeParse(logsQuerySchema, longer).success).toBe(false);
  });
});
