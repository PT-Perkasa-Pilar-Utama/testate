/** `mongodb`, `ssh2`, `ssh2-sftp-client`, `basic-ftp` and `bun`'s SQL and S3: drivers for real servers. */
import { unavailable } from "./unavailable.ts";

class Driver {
  constructor() {
    unavailable("This engine");
  }
}
export class MongoClient extends Driver {}
export class Client extends Driver {}
export class SQL extends Driver {}
export class S3Client extends Driver {}

const ejson = (): never => unavailable("MongoDB's extended JSON");
export const BSON = { EJSON: { stringify: ejson, parse: ejson } };
export default Client;
