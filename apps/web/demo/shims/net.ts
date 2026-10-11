/** `node:net`, `node:dns`, `node:os`, `node:http`, `node:tls`: the parts netguard names, inert. */
import { unavailable } from "./unavailable.ts";

export function isIP(address: string): number {
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(address)) return 4;
  return address.includes(":") ? 6 : 0;
}
export class BlockList {
  addAddress(): void {}
  addRange(): void {}
  addSubnet(): void {}
  check(): boolean {
    return false;
  }
}
export const lookup = async (host: string): Promise<never> => unavailable(`Resolving ${host}`);
export const networkInterfaces = (): Record<string, never[]> => ({});

const connect = (): never => unavailable("A network connection");
const request = (): never => unavailable("An HTTP request");
export default { connect, request };
