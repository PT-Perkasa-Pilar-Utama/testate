// Prints one base64 32-byte key for TESTATE_SECRETS_ACTIVE_KEY.
// Usage: bun scripts/generate-key.ts
const bytes = crypto.getRandomValues(new Uint8Array(32));
console.log(bytes.toBase64());
