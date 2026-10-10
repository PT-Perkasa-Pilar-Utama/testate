/**
 * The Logs cursor: for each file, where "older" resumes (`before`) and where "after" resumes. It
 * is opaque to callers and parsed when it comes back, since it crosses the trust boundary.
 */
import * as v from "valibot";

import { AppError } from "../http/index.ts";

export type FileMark = { before: number; after: number };
export type FileMarks = Map<string, FileMark>;

const offset = v.pipe(v.number(), v.integer(), v.minValue(0));
const marksSchema = v.array(v.tuple([v.string(), v.object({ before: offset, after: offset })]));

export function encodeCursor(marks: FileMarks): string {
  return Buffer.from(JSON.stringify([...marks])).toString("base64url");
}

export function decodeCursor(text: string): FileMarks {
  try {
    return new Map(v.parse(marksSchema, JSON.parse(Buffer.from(text, "base64url").toString())));
  } catch {
    throw new AppError("VALIDATION_ERROR", "That cursor is not one this server gave out.", {
      field: "cursor",
    });
  }
}
