/** `node:path` for the demo: POSIX join, dirname and extname over plain strings. */
export function join(...parts: (string | undefined)[]): string {
  const joined = parts.filter((part) => part !== undefined && part !== "").join("/");
  const segments: string[] = [];
  for (const part of joined.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  return `${joined.startsWith("/") ? "/" : ""}${segments.join("/")}`;
}

export function dirname(path: string): string {
  const index = path.replace(/\/+$/, "").lastIndexOf("/");
  if (index > 0) return path.slice(0, index);
  return path.startsWith("/") ? "/" : ".";
}

export function extname(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot);
}

export default { join, dirname, extname };
