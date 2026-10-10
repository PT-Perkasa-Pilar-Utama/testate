import { describe, expect, it } from "bun:test";

import { dockerLines, nanosOf, secondsOf } from "./frames.ts";

// #88, K5 (docs/decisions/2026-10-10-docker.md): a multiplexed body is split per stream, in the
// order lines finish, and a cut read never yields half a line.
function frame(stream: 1 | 2, payload: string | Buffer): Buffer {
  const body = Buffer.from(payload);
  const header = Buffer.alloc(8);
  header[0] = stream;
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

const T1 = "2026-10-10T13:47:19.084777026Z";
const T2 = "2026-10-10T13:47:19.286945380Z";
const T3 = "2026-10-10T13:47:19.487720730Z";

const short = (bytes: Buffer, tty = false, capped = false) =>
  dockerLines(bytes, tty, capped).map((line) => [line.stream, line.stamp, line.text]);

describe("a container's log body", () => {
  it("keeps each stream's lines in the order they finish, a split line and character whole", () => {
    const euro = Buffer.from("€");
    const body = Buffer.concat([
      frame(1, `${T1} GET /orders `),
      frame(2, `${T2} warn: slow\n`),
      frame(1, Buffer.concat([Buffer.from("200 "), euro.subarray(0, 1)])),
      frame(1, Buffer.concat([euro.subarray(1), Buffer.from(`\n${T3} done\n`)])),
    ]);
    expect(short(body)).toEqual([
      ["stderr", T2, "warn: slow"],
      ["stdout", T1, "GET /orders 200 €"],
      ["stdout", T3, "done"],
    ]);
  });

  it("drops the unfinished line and the cut frame of a read stopped at its ceiling", () => {
    const body = Buffer.concat([frame(1, `${T1} one\n${T2} tw`), frame(2, `${T3} three\n`)]);
    expect(short(body.subarray(0, body.length - 3), false, true)).toEqual([["stdout", T1, "one"]]);
  });

  it("keeps a whole read's last line without its newline", () => {
    expect(short(frame(1, `${T1} last`))).toEqual([["stdout", T1, "last"]]);
  });

  it("reads a TTY container as one stream with its carriage returns removed", () => {
    expect(short(Buffer.from(`${T1} one\r\n${T2} two\r\n`), true)).toEqual([
      [null, T1, "one"],
      [null, T2, "two"],
    ]);
  });

  it("gives a line with no stamp the time of the line before it", () => {
    const lines = dockerLines(frame(1, `${T1} one\n    at handler\n`), false, false);
    expect(lines.map((line) => [line.nanos, line.text])).toEqual([
      [1_791_640_039_084_777_026n, "one"],
      [1_791_640_039_084_777_026n, "    at handler"],
    ]);
  });
});

describe("a stamp", () => {
  it("is nanoseconds whatever its precision or zone, and goes back as seconds", () => {
    expect([
      nanosOf(T1),
      nanosOf("2026-10-10T13:47:19.5Z"),
      nanosOf("2026-10-10T20:47:19.084777026+07:00"),
      nanosOf("not a stamp"),
      secondsOf(1_791_637_217_000_000_042n),
    ]).toEqual([
      1_791_640_039_084_777_026n,
      1_791_640_039_500_000_000n,
      1_791_640_039_084_777_026n,
      null,
      "1791637217.000000042",
    ]);
  });
});
