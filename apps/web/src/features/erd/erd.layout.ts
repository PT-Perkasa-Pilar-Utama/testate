import type { TableSchema } from "@testate/shared";

/** One box on the canvas: where it sits, how big it is, and what it shows. */
export type Box = {
  key: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  columns: BoxColumn[];
  /** Columns beyond the cap, counted rather than drawn. */
  hidden: number;
};

export type BoxColumn = {
  name: string;
  type: string;
  key: boolean;
  ref: boolean;
  nullable: boolean;
};

/** One relationship, drawn from the right edge of `from` to the left edge of `to`. */
export type Edge = { from: string; to: string; label: string };

export type Diagram = { boxes: Box[]; edges: Edge[]; width: number; height: number };

export const BOX_WIDTH = 232;
const HEADER = 30;
const ROW = 19;
const PAD = 8;
const GAP_X = 96;
const GAP_Y = 28;
/** Beyond this a box is taller than the screen and says nothing a person can read at a glance. */
export const COLUMN_CAP = 14;

export function keyOf(table: Pick<TableSchema, "schema" | "name">): string {
  return table.schema === null || table.schema === ""
    ? table.name
    : `${table.schema}.${table.name}`;
}

/**
 * How far a table sits from the tables nobody points at.
 *
 * A table with no outgoing foreign key is layer 0; anything else is one past the deepest table it
 * references. Cycles are real (a self-reference, or two tables that point at each other), so the
 * passes are bounded: whatever has not settled by then keeps the depth it reached, which draws a
 * readable diagram instead of hanging.
 */
export function layersOf(tables: readonly TableSchema[]): Map<string, number> {
  const refs = new Map<string, string[]>();
  const known = new Set(tables.map(keyOf));
  for (const table of tables) {
    refs.set(
      keyOf(table),
      table.foreign_keys_out.map((fk) => keyOf(fk.ref)).filter((ref) => known.has(ref))
    );
  }
  const layer = new Map<string, number>(tables.map((table) => [keyOf(table), 0]));
  for (let pass = 0; pass < tables.length; pass += 1) {
    let moved = false;
    for (const [key, targets] of refs) {
      const deepest = targets.reduce(
        (far, target) => (target === key ? far : Math.max(far, (layer.get(target) ?? 0) + 1)),
        0
      );
      if (deepest > (layer.get(key) ?? 0)) {
        layer.set(key, deepest);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return layer;
}

/** What a box shows of a table, and how many columns it had to leave out. */
type BoxBody = { columns: BoxColumn[]; hidden: number };

function boxColumns(table: TableSchema): BoxBody {
  const keys = new Set(table.primary_key ?? []);
  const refs = new Set(table.foreign_keys_out.flatMap((fk) => fk.columns));
  const all = table.columns.map((column) => ({
    name: column.name,
    type: column.type,
    key: keys.has(column.name),
    ref: refs.has(column.name),
    nullable: column.nullable,
  }));
  // Keys and foreign keys first when there are more than fit: they are what a relationship diagram
  // is for, and an alphabetical truncation would hide exactly those.
  if (all.length <= COLUMN_CAP) return { columns: all, hidden: 0 };
  const important = all.filter((column) => column.key || column.ref);
  const rest = all.filter((column) => !column.key && !column.ref);
  const shown = [...important, ...rest].slice(0, COLUMN_CAP);
  return { columns: shown, hidden: all.length - shown.length };
}

/**
 * Boxes and edges, laid out left to right by foreign-key depth.
 *
 * Recomputed every time from the schema, so nothing is stored and nothing goes stale when a column
 * is added (docs/PROJECT_REWORK.md).
 */
export function layout(tables: readonly TableSchema[]): Diagram {
  const layer = layersOf(tables);
  const byLayer = new Map<number, TableSchema[]>();
  for (const table of [...tables].sort((a, b) => keyOf(a).localeCompare(keyOf(b)))) {
    const at = layer.get(keyOf(table)) ?? 0;
    byLayer.set(at, [...(byLayer.get(at) ?? []), table]);
  }
  const boxes: Box[] = [];
  let width = 0;
  let height = 0;
  for (const [at, group] of [...byLayer].sort((a, b) => a[0] - b[0])) {
    let y = 0;
    for (const table of group) {
      const { columns, hidden } = boxColumns(table);
      const boxHeight = HEADER + (columns.length + (hidden > 0 ? 1 : 0)) * ROW + PAD;
      boxes.push({
        key: keyOf(table),
        label: keyOf(table),
        x: at * (BOX_WIDTH + GAP_X),
        y,
        width: BOX_WIDTH,
        height: boxHeight,
        columns,
        hidden,
      });
      y += boxHeight + GAP_Y;
      height = Math.max(height, y);
    }
    width = Math.max(width, at * (BOX_WIDTH + GAP_X) + BOX_WIDTH);
  }
  const placed = new Set(boxes.map((box) => box.key));
  const edges: Edge[] = [];
  for (const table of tables) {
    for (const fk of table.foreign_keys_out) {
      const to = keyOf(fk.ref);
      if (!placed.has(to)) continue;
      edges.push({ from: keyOf(table), to, label: fk.columns.join(", ") });
    }
  }
  return { boxes, edges, width, height };
}

/**
 * One table and everything one hop from it.
 *
 * An automatic diagram of two hundred tables is a hairball in every tool, so a large schema starts
 * at one table and grows from there.
 */
export function neighbours(tables: readonly TableSchema[], focus: string): TableSchema[] {
  const wanted = new Set<string>([focus]);
  for (const table of tables) {
    const key = keyOf(table);
    if (key === focus) {
      for (const fk of table.foreign_keys_out) wanted.add(keyOf(fk.ref));
      for (const fk of table.foreign_keys_in) wanted.add(keyOf(fk.from));
    }
  }
  return tables.filter((table) => wanted.has(keyOf(table)));
}
