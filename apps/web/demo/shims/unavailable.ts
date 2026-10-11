/** What a stubbed driver throws when the demo reaches it: the feature needs a real server. */
export function unavailable(what: string): never {
  throw new Error(`${what} needs a real Testate server; the demo runs in your browser`);
}
