/**
 * The refund that went wrong: the one story the seeded diffs tell. Runs against the compose
 * engines directly, between two snapshots, so `checkout-flow-baseline` and
 * `after-the-failed-refund` differ in every tier: a changed order, a moved balance, a new note in
 * each SQL database; a changed and a new document in MongoDB.
 */
import { SQL } from "bun";
import { MongoClient } from "mongodb";

const SQL_URLS = [
  ["shop-postgres", "postgres://testate:testate@127.0.0.1:15432/shop", "contract."],
  ["shop-mysql", "mysql://testate:testate@127.0.0.1:13306/shop", ""],
  ["shop-mariadb", "mysql://testate:testate@127.0.0.1:13307/shop", ""],
] as const;

/** The shape the seed touches; `_id` is the integer the contract fixture gives an order. */
type Order = { _id: number; total: number; status?: string; note?: string };

const MONGO_URL = "mongodb://testate:testate@127.0.0.1:27017/shop?authSource=admin";

/** Applies the story. Returns the engines it reached; a refused one is named, never fatal. */
export async function applyRefundStory(say: (line: string) => void): Promise<string[]> {
  const reached: string[] = [];
  for (const [name, url, prefix] of SQL_URLS) {
    // SAFETY: `allowPublicKeyRetrieval` is a documented Bun MySQL option missing from the bundled types.
    const sql = new SQL({ url, allowPublicKeyRetrieval: true } as ConstructorParameters<
      typeof SQL
    >[0]);
    try {
      await sql.unsafe(`UPDATE ${prefix}orders SET total = total - 5 WHERE id = 2`);
      await sql.unsafe(`UPDATE ${prefix}customers SET balance = balance + 5 WHERE id = 1`);
      await sql.unsafe(
        `INSERT INTO ${prefix}notes (body) VALUES ('refund of order 2 failed: gateway timeout')`
      );
      reached.push(name);
    } catch (cause: unknown) {
      say(
        `${name}: refund story skipped (${cause instanceof Error ? cause.message : String(cause)})`
      );
    } finally {
      await sql.close();
    }
  }
  const mongo = new MongoClient(MONGO_URL);
  try {
    const db = mongo.db("shop");
    await db
      .collection<Order>("orders")
      .updateOne({ _id: 2 }, { $set: { total: 15.5, status: "refund-failed" } });
    await db
      .collection<Order>("orders")
      .insertOne({ _id: 4, total: 9.99, note: "retry after the failed refund" });
    reached.push("shop-mongo");
  } catch (cause: unknown) {
    say(
      `shop-mongo: refund story skipped (${cause instanceof Error ? cause.message : String(cause)})`
    );
  } finally {
    await mongo.close();
  }
  return reached;
}
