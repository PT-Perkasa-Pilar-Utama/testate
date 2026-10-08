import type { TableSchema } from "@testate/shared";
import type { ELK, ElkExtendedEdge, ElkNode, ElkPort } from "elkjs/lib/elk-api.js";

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
  /** The type as drawn: cut with an ellipsis when the widest box still cannot hold it. */
  shownType: string;
  key: boolean;
  ref: boolean;
  nullable: boolean;
};

export type Point = { x: number; y: number };

/** One foreign key, from its column in `from` to the column it references in `to`. */
export type Edge = { from: string; to: string; label: string; points: Point[] };

export type Diagram = { boxes: Box[]; edges: Edge[]; width: number; height: number };

/** How wide a piece of text renders: the canvas in the browser, a character count in a test. */
export type Measure = (text: string, font: "label" | "name" | "type") => number;

export const HEADER = 30;
export const ROW = 19;
const PAD = 8;
/** The text's inset from the box edge, and the gap between a column's name and its type. */
const INSET = 10;
const GAP = 16;
/** "● " in front of a key column. */
const MARKER = 14;
export const MIN_BOX = 200;
export const MAX_BOX = 420;
/** Beyond this a box is taller than the screen and says nothing a person can read at a glance. */
export const COLUMN_CAP = 14;

export function keyOf(table: Pick<TableSchema, "schema" | "name">): string {
  return table.schema === null || table.schema === ""
    ? table.name
    : `${table.schema}.${table.name}`;
}

/** Where a column's line meets the box edge, on the side its edges use. */
function portId(table: string, column: string, side: "in" | "out"): string {
  return `${table}::${column}::${side}`;
}

/** The middle of a column's row, measured from the top of its box. */
function rowMiddle(index: number): number {
  return HEADER + 9 + index * ROW;
}

type Body = { columns: Omit<BoxColumn, "shownType">[]; hidden: number };

function bodyOf(table: TableSchema): Body {
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

function typeText(column: Pick<BoxColumn, "type" | "nullable">): string {
  return column.nullable ? column.type : `${column.type} *`;
}

/**
 * Cuts a type to the room left beside its column name.
 * ponytail: shortens by the ratio of room to width, not glyph by glyph; a run of wide glyphs can
 * overshoot by a character. Measure each shortening if a type ever clips the box edge.
 */
function fitType(column: Pick<BoxColumn, "type" | "nullable">, room: number, measure: Measure) {
  const full = typeText(column);
  const width = measure(full, "type");
  if (width <= room) return column.type;
  const keep = Math.max(1, Math.floor((column.type.length * room) / width) - 2);
  return `${column.type.slice(0, keep)}…`;
}

type Sized = Omit<Box, "x" | "y">;

/** A box as wide as its widest line, between MIN_BOX and MAX_BOX, with types cut to fit. */
export function sizeOf(table: TableSchema, measure: Measure): Sized {
  const { columns, hidden } = bodyOf(table);
  const label = keyOf(table);
  const lines = columns.map(
    (column) => MARKER + measure(column.name, "name") + GAP + measure(typeText(column), "type")
  );
  const widest = Math.max(measure(label, "label"), ...lines) + INSET * 2;
  const width = Math.ceil(Math.min(MAX_BOX, Math.max(MIN_BOX, widest)));
  const shown = columns.map((column) => ({
    ...column,
    shownType: fitType(
      column,
      width - INSET * 2 - MARKER - measure(column.name, "name") - GAP,
      measure
    ),
  }));
  const height = HEADER + (columns.length + (hidden > 0 ? 1 : 0)) * ROW + PAD;
  return { key: label, label, width, height, columns: shown, hidden };
}

const LAYOUT = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.spacing.nodeNode": "28",
  "elk.spacing.edgeNode": "16",
  "elk.spacing.edgeEdge": "8",
  "elk.layered.spacing.nodeNodeBetweenLayers": "96",
  "elk.layered.spacing.edgeNodeBetweenLayers": "20",
  // Same schema, same picture: order ties by the input, which is sorted by name below.
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
};

function portsOf(box: Sized): ElkPort[] {
  return box.columns.flatMap((column, index) => [
    {
      id: portId(box.key, column.name, "in"),
      x: 0,
      y: rowMiddle(index),
      width: 0,
      height: 0,
      layoutOptions: { "elk.port.side": "WEST" },
    },
    {
      id: portId(box.key, column.name, "out"),
      x: box.width,
      y: rowMiddle(index),
      width: 0,
      height: 0,
      layoutOptions: { "elk.port.side": "EAST" },
    },
  ]);
}

/** The port for a drawn column, or the box itself when the column is past the cap. */
function endOf(box: Sized, column: string | undefined, side: "in" | "out"): string {
  const drawn = column !== undefined && box.columns.some((one) => one.name === column);
  return drawn ? portId(box.key, column, side) : box.key;
}

/** Every foreign key between two drawn tables, as an edge between their column ports. */
function edgesOf(tables: readonly TableSchema[], boxes: Map<string, Sized>): ElkExtendedEdge[] {
  const edges: ElkExtendedEdge[] = [];
  for (const table of tables) {
    const from = boxes.get(keyOf(table));
    if (from === undefined) continue;
    table.foreign_keys_out.forEach((fk, index) => {
      const to = boxes.get(keyOf(fk.ref));
      if (to === undefined) return;
      edges.push({
        id: `${from.key}#${index}`,
        sources: [endOf(from, fk.columns[0], "out")],
        targets: [endOf(to, fk.ref_columns[0], "in")],
      });
    });
  }
  return edges;
}

export function graphOf(tables: readonly TableSchema[], measure: Measure): ElkNode {
  const sorted = [...tables].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
  const boxes = new Map(sorted.map((table) => [keyOf(table), sizeOf(table, measure)]));
  return {
    id: "schema",
    layoutOptions: LAYOUT,
    children: [...boxes.values()].map((box) => ({
      id: box.key,
      width: box.width,
      height: box.height,
      layoutOptions: { "elk.portConstraints": "FIXED_POS" },
      ports: portsOf(box),
    })),
    edges: edgesOf(sorted, boxes),
  };
}

/** The laid-out graph back into what the canvas draws. */
export function diagramOf(
  tables: readonly TableSchema[],
  laid: ElkNode,
  measure: Measure
): Diagram {
  const sized = new Map(tables.map((table) => [keyOf(table), sizeOf(table, measure)]));
  const boxes = (laid.children ?? []).flatMap((node) => {
    const box = sized.get(node.id);
    return box === undefined ? [] : [{ ...box, x: node.x ?? 0, y: node.y ?? 0 }];
  });
  const labels = new Map<string, TableSchema["foreign_keys_out"][number]>();
  for (const table of tables) {
    table.foreign_keys_out.forEach((fk, index) => labels.set(`${keyOf(table)}#${index}`, fk));
  }
  const edges = (laid.edges ?? []).flatMap((edge) => {
    const fk = labels.get(edge.id);
    if (fk === undefined) return [];
    const points = (edge.sections ?? []).flatMap((section) => [
      section.startPoint,
      ...(section.bendPoints ?? []),
      section.endPoint,
    ]);
    const from = edge.id.slice(0, edge.id.lastIndexOf("#"));
    return [{ from, to: keyOf(fk.ref), label: fk.columns.join(", "), points }];
  });
  return { boxes, edges, width: laid.width ?? 0, height: laid.height ?? 0 };
}

/**
 * Boxes and edges for a set of tables, laid out by ELK's layered algorithm: tables in layers by
 * foreign key, each edge from its column to the column it references, routed around the boxes.
 *
 * Recomputed every time from the schema, so nothing is stored and nothing goes stale when a column
 * is added.
 */
export async function layout(
  tables: readonly TableSchema[],
  measure: Measure,
  engine: Pick<ELK, "layout">
): Promise<Diagram> {
  return diagramOf(tables, await engine.layout(graphOf(tables, measure)), measure);
}

/**
 * One table and everything one hop from it.
 *
 * Past WHOLE_SCHEMA_CAP tables an automatic diagram is a hairball in every tool, so a schema that
 * large starts at one table and grows from there.
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
