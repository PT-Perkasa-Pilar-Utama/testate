/**
 * What the demo's sample servers hold (#demo): a shop database on the fake engine, a file store
 * with an import source, and an app host whose pm2 logs and `/proc` files the Logs tier and the
 * resource readings read. Log lines are stamped relative to now, so the viewer's window finds them.
 */
import type { JsonObject } from "@testate/shared";

import type { FakeDatabase } from "../../../api/src/lib/engines/fake/engine.ts";
import type { MemoryTree } from "../../../api/src/lib/files/index.ts";
import type { MemoryFile } from "../../../api/src/lib/files/memory.ts";
import type { DemoWorld } from "./wiring.ts";

export const DB_HOST = "db.demo.internal";
export const FILES_HOST = "files.demo.internal";
export const APP_HOST = "app.demo.internal";

const FIRST_NAMES = [
  "Ayu",
  "Budi",
  "Citra",
  "Dewi",
  "Eka",
  "Fajar",
  "Gita",
  "Hadi",
  "Intan",
  "Joko",
  "Kirana",
  "Lukas",
];
const PRODUCTS = [
  ["Espresso beans 1 kg", "189000.00"],
  ["Pour-over kettle", "425000.00"],
  ["Ceramic dripper", "155000.00"],
  ["Paper filters (100)", "45000.00"],
  ["Burr grinder", "1250000.00"],
  ["Milk pitcher", "98000.00"],
] as const;
const STATUSES = ["paid", "paid", "shipped", "delivered", "refunded", "paid"] as const;

function shop(): FakeDatabase {
  const customers = FIRST_NAMES.map((name, index) => ({
    id: index + 1,
    name,
    email: `${name.toLowerCase()}@example.com`,
    city: ["Jakarta", "Bandung", "Surabaya", "Medan"][index % 4] ?? "Jakarta",
  }));
  const products = PRODUCTS.map(([name, price], index) => ({
    id: index + 1,
    name,
    price,
    stock: 40 - index * 5,
  }));
  const orders = Array.from({ length: 18 }, (_, index) => ({
    id: index + 1,
    customer_id: (index % customers.length) + 1,
    product_id: (index % products.length) + 1,
    quantity: (index % 3) + 1,
    status: STATUSES[index % STATUSES.length] ?? "paid",
  }));
  return new Map<string, JsonObject[]>([
    ["public.customers", customers],
    ["public.products", products],
    ["public.orders", orders],
  ]);
}

const encoder = new TextEncoder();
const file = (text: string, at: Date): MemoryFile => ({
  bytes: encoder.encode(text),
  modified_at: at.toISOString(),
});

/** pm2's `--time` prefix, minutes before now. */
function pm2Lines(now: Date, lines: [number, string][]): string {
  return lines
    .map(
      ([minutesAgo, text]) =>
        `${new Date(now.getTime() - minutesAgo * 60_000).toISOString().slice(0, 19)}: ${text}`
    )
    .join("\n")
    .concat("\n");
}

function appHost(now: Date): MemoryTree {
  const out = pm2Lines(now, [
    [52, "GET /api/orders 200 41ms"],
    [47, "POST /api/orders 201 88ms"],
    [31, "GET /api/orders/7 200 12ms"],
    [22, "login user=ayu@example.com Authorization: Bearer 4f9c2d7e1a8b6053"],
    [9, "POST /api/orders/12/refund 200 140ms"],
    [3, "GET /api/health 200 2ms"],
  ]);
  const error = pm2Lines(now, [
    [
      18,
      "TypeError: Cannot read properties of undefined (reading 'total')\n    at refundOrder (orders.ts:118)",
    ],
    [6, "payment gateway timeout after 30000ms (order 12)"],
  ]);
  const tree: MemoryTree = new Map([
    [".pm2/logs/shop-api-out.log", file(out, now)],
    [".pm2/logs/shop-api-error.log", file(error, now)],
  ]);
  return tree;
}

const CUSTOMERS_CSV =
  "name,email,city\nMaya,maya@example.com,Yogyakarta\nNadia,nadia@example.com,Semarang\nOscar,oscar@example.com,Denpasar\n";

function filesHost(now: Date): MemoryTree {
  const tree: MemoryTree = new Map([
    ["imports/customers.csv", file(CUSTOMERS_CSV, now)],
    ["exports/orders-2026-10.csv", file("id,status\n1,paid\n2,shipped\n", now)],
  ]);
  return tree;
}

export function demoWorld(now: Date = new Date()): DemoWorld {
  return {
    databases: new Map([["shop", shop()]]),
    trees: new Map([
      [FILES_HOST, filesHost(now)],
      [APP_HOST, appHost(now)],
    ]),
  };
}
