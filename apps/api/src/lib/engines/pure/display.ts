/**
 * Quotes JSON number literals that a JavaScript `number` cannot hold exactly, so `JSON.parse`
 * keeps them as text (12 §12.4: big integers and decimals display as precise text).
 */
export function preciseNumbersAsText(json: string): string {
  let out = "";
  let inString = false;
  let index = 0;
  while (index < json.length) {
    const char = json[index] ?? "";
    if (inString) {
      const step = char === "\\" ? 2 : 1;
      out += json.slice(index, index + step);
      if (char === '"') inString = false;
      index += step;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      index += 1;
      continue;
    }
    const match = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(json.slice(index));
    if (match === null || !/^[-\d]/.test(char)) {
      out += char;
      index += 1;
      continue;
    }
    const literal = match[0];
    out += needsText(literal) ? `"${literal}"` : literal;
    index += literal.length;
  }
  return out;
}

/** More than 15 significant digits, or an integer past 2^53, loses precision as a double. */
export function needsText(literal: string): boolean {
  const digits = literal
    .replace(/^-/, "")
    .replace(/[eE].*$/, "")
    .replace(".", "")
    .replace(/^0+/, "");
  if (digits.length > 15) return true;
  return !literal.includes(".") && !/[eE]/.test(literal) && !Number.isSafeInteger(Number(literal));
}
