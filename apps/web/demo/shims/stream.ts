/** `node:stream` and `node:zlib` names the remote engines import; never reached in the demo. */
import { unavailable } from "./unavailable.ts";

export class Readable {
  static toWeb(): never {
    return unavailable("A Node stream");
  }
}
export class PassThrough extends Readable {}
export const deflateSync = (): never => unavailable("Compression");
