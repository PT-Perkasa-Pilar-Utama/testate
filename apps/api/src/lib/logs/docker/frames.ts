/**
 * A container's log as Docker sends it (#88; K5 of docs/decisions/2026-10-10-docker.md). Without a
 * TTY the body is frames of `[stream, 0, 0, 0, length (4 bytes, big-endian)]` and a payload; a line
 * can span frames and the two streams interleave, so each stream keeps its own unfinished line.
 * With a TTY the body is one raw stream. `timestamps=1` puts an RFC 3339 stamp before every line.
 */
import { nanosOf } from "../time.ts";

export type DockerStream = "stdout" | "stderr";

export type DockerLine = {
  /** The stamp as Docker wrote it, the line's identity with its stream and text. */
  stamp: string;
  nanos: bigint;
  /** Null for a TTY container, whose two streams are one. */
  stream: DockerStream | null;
  text: string;
};

/** Nanoseconds as the Engine API's `since` and `until` take them: seconds with nine decimals. */
export function secondsOf(nanos: bigint): string {
  return `${nanos / 1_000_000_000n}.${(nanos % 1_000_000_000n).toString().padStart(9, "0")}`;
}

const STREAMS = new Map<number, DockerStream>([
  [1, "stdout"],
  [2, "stderr"],
]);

/** Splits each raw line at its stamp; a line with none keeps the previous line's time. */
function stampedLines(raw: { stream: DockerStream | null; text: string }[]): DockerLine[] {
  let last = 0n;
  return raw.map(({ stream, text }) => {
    const space = text.indexOf(" ");
    const stamp = space === -1 ? text : text.slice(0, space);
    const nanos = nanosOf(stamp);
    if (nanos === null) return { stamp: "", nanos: last, stream, text };
    last = nanos;
    return { stamp, nanos, stream, text: space === -1 ? "" : text.slice(space + 1) };
  });
}

/** The lines of one stream's bytes; a TTY ends its lines with `\r\n`. */
function splitText(bytes: Buffer): string[] {
  return bytes
    .toString()
    .split("\n")
    .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

function ttyLines(bytes: Uint8Array, capped: boolean): DockerLine[] {
  const lines = splitText(Buffer.from(bytes));
  // The last piece is unfinished when the read was cut, or empty after a final newline.
  const whole = capped || lines.at(-1) === "" ? lines.slice(0, -1) : lines;
  return stampedLines(whole.map((text) => ({ stream: null, text })));
}

type RawLine = { stream: DockerStream; text: string };

type Pending = {
  add: (stream: DockerStream, payload: Buffer) => RawLine[];
  rest: () => RawLine[];
};

/** Each stream's unfinished line, kept as bytes so a character split across frames survives. */
function createPending(): Pending {
  const pending = new Map<DockerStream, Buffer>();
  return {
    add(stream, payload) {
      const joined = Buffer.concat([pending.get(stream) ?? Buffer.alloc(0), payload]);
      const end = joined.lastIndexOf(0x0a);
      pending.set(stream, joined.subarray(end + 1));
      if (end === -1) return [];
      return splitText(joined.subarray(0, end)).map((text) => ({ stream, text }));
    },
    rest: () =>
      [...pending].flatMap(([stream, rest]) =>
        rest.length > 0 ? [{ stream, text: rest.toString() }] : []
      ),
  };
}

/** Frames in arrival order; a frame cut by the byte ceiling ends the read. */
function frameLines(bytes: Uint8Array, capped: boolean): DockerLine[] {
  const body = Buffer.from(bytes);
  const pending = createPending();
  const raw: RawLine[] = [];
  for (let at = 0; at + 8 <= body.length;) {
    const stream = STREAMS.get(body[at] ?? 0);
    const end = at + 8 + body.readUInt32BE(at + 4);
    if (end > body.length) break;
    if (stream !== undefined) raw.push(...pending.add(stream, body.subarray(at + 8, end)));
    at = end;
  }
  // A cut read's unfinished lines are not lines yet; a whole read's last line may lack its newline.
  if (!capped) raw.push(...pending.rest());
  return stampedLines(raw);
}

export function dockerLines(bytes: Uint8Array, tty: boolean, capped: boolean): DockerLine[] {
  return tty ? ttyLines(bytes, capped) : frameLines(bytes, capped);
}
