export type Token = { text: string; kind: "key" | "string" | "number" | "literal" | "plain" };

const TOKEN =
  /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g;

/** Pretty JSON cut into tokens: a key, a string, a number, a literal, and the rest between. */
export function tokensOf(text: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const [whole, string, colon, number] = match;
    if (match.index > last) tokens.push({ text: text.slice(last, match.index), kind: "plain" });
    if (string !== undefined && colon !== undefined) {
      tokens.push({ text: string, kind: "key" }, { text: colon, kind: "plain" });
    } else if (string !== undefined) {
      tokens.push({ text: string, kind: "string" });
    } else if (number !== undefined) {
      tokens.push({ text: number, kind: "number" });
    } else {
      tokens.push({ text: whole, kind: "literal" });
    }
    last = match.index + whole.length;
  }
  if (last < text.length) tokens.push({ text: text.slice(last), kind: "plain" });
  return tokens;
}
