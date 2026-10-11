/** The demo's disk (#demo): uploads, import sources, rejected rows and the migrations, in memory. */
export const files = new Map<string, Uint8Array>();

const encoder = new TextEncoder();

export const normalize = (path: string): string =>
  `/${path
    .split("/")
    .filter((part) => part !== "" && part !== ".")
    .join("/")}`;

/** Text or bytes, as the Node and Bun calls the shims stand in for accept them. */
export const bytesOf = (data: string | Uint8Array): Uint8Array =>
  data instanceof Uint8Array ? data : encoder.encode(data);

export function put(path: string, bytes: Uint8Array): void {
  files.set(normalize(path), bytes);
}

export function read(path: string): Uint8Array {
  const found = files.get(normalize(path));
  if (found === undefined)
    throw Object.assign(new Error(`ENOENT: no such file, ${path}`), { code: "ENOENT" });
  return found;
}

export const exists = (path: string): boolean => {
  const clean = normalize(path);
  return files.has(clean) || [...files.keys()].some((key) => key.startsWith(`${clean}/`));
};

/** Removes a file, or everything under a folder. */
export function remove(path: string): void {
  const clean = normalize(path);
  for (const key of Array.from(files.keys()))
    if (key === clean || key.startsWith(`${clean}/`)) files.delete(key);
}

/** The names directly inside a folder. */
export function list(path: string): string[] {
  const prefix = `${normalize(path)}/`.replace("//", "/");
  const names = new Set<string>();
  for (const key of files.keys())
    if (key.startsWith(prefix)) names.add(key.slice(prefix.length).split("/")[0] ?? "");
  return [...names].filter((name) => name !== "");
}
