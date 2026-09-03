import type { JSX } from "@solidjs/web";
import { For, Show, createMemo, createSignal } from "solid-js";
import type { TableSchema } from "@testate/shared";

import Button from "@/components/button.tsx";
import Select from "@/components/select.tsx";
import { keyOf, layout, neighbours } from "./erd.layout.ts";
import type { Box, BoxColumn, Diagram, Edge } from "./erd.layout.ts";

/** Past this many tables an automatic diagram is a hairball, so it starts at one table instead. */
const WHOLE_SCHEMA_CAP = 40;
const PADDING = 24;
const HEADER = 30;
const ROW = 19;

/** Filled for part of the primary key, hollow for a foreign key, blank otherwise. */
function marker(column: BoxColumn): string {
  if (column.key) return "● ";
  return column.ref ? "○ " : "  ";
}

function edgePath(diagram: Diagram, edge: Edge): string | null {
  const from = diagram.boxes.find((box) => box.key === edge.from);
  const to = diagram.boxes.find((box) => box.key === edge.to);
  if (from === undefined || to === undefined) return null;
  const x1 = from.x + from.width;
  const y1 = from.y + HEADER / 2 + 8;
  const x2 = to.x;
  const y2 = to.y + HEADER / 2 + 8;
  // An S through the gap: two horizontal stubs and a curve, which reads as a link without needing
  // a routing algorithm nobody asked for.
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

function TableBox(props: {
  box: Box;
  focused: boolean;
  onFocus: (key: string) => void;
}): JSX.Element {
  return (
    <g
      class="cursor-pointer"
      role="button"
      tabindex="0"
      aria-label={`Focus ${props.box.label}`}
      onClick={() => props.onFocus(props.box.key)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") props.onFocus(props.box.key);
      }}
    >
      <rect
        x={props.box.x}
        y={props.box.y}
        width={props.box.width}
        height={props.box.height}
        rx="6"
        class={props.focused ? "fill-surface stroke-accent" : "fill-surface stroke-line"}
        stroke-width={props.focused ? 2 : 1}
      />
      <rect
        x={props.box.x}
        y={props.box.y}
        width={props.box.width}
        height={HEADER}
        rx="6"
        class="fill-fill"
      />
      <text
        x={props.box.x + 10}
        y={props.box.y + 19}
        class="fill-heading text-[12px] font-semibold"
      >
        {props.box.label}
      </text>
      <For each={props.box.columns}>
        {(column, index) => (
          <>
            <text
              x={props.box.x + 10}
              y={props.box.y + HEADER + 13 + index() * ROW}
              class={column.key ? "fill-heading text-[11px]" : "fill-body text-[11px]"}
            >
              {marker(column)}
              {column.name}
            </text>
            <text
              x={props.box.x + props.box.width - 10}
              y={props.box.y + HEADER + 13 + index() * ROW}
              text-anchor="end"
              class="fill-muted font-mono text-[10px]"
            >
              {column.type}
              {column.nullable ? "" : " *"}
            </text>
          </>
        )}
      </For>
      <Show when={props.box.hidden > 0}>
        <text
          x={props.box.x + 10}
          y={props.box.y + HEADER + 13 + props.box.columns.length * ROW}
          class="fill-muted text-[11px] italic"
        >
          +{props.box.hidden} more
        </text>
      </Show>
    </g>
  );
}

/**
 * The schema as boxes and lines, laid out from the foreign keys every time.
 *
 * No dragging and nothing stored: a saved position goes stale the moment a column is added, and
 * the layout is cheap enough to recompute. Pan with a drag, zoom with the wheel, pick a table to
 * see it with every table one foreign key away, in either direction.
 */
export default function Erd(props: { tables: readonly TableSchema[] }): JSX.Element {
  const [focus, setFocus] = createSignal<string | null>(null);
  const [zoom, setZoom] = createSignal(1);
  const [pan, setPan] = createSignal({ x: PADDING, y: PADDING });
  const [dragging, setDragging] = createSignal<{ x: number; y: number } | null>(null);
  const big = (): boolean => props.tables.length > WHOLE_SCHEMA_CAP;
  const shown = createMemo(() => {
    const at = focus();
    if (at === null) return big() ? props.tables.slice(0, 1) : props.tables;
    return neighbours(props.tables, at);
  });
  const diagram = createMemo(() => layout(shown()));
  const fit = (): void => {
    setPan({ x: PADDING, y: PADDING });
    setZoom(1);
  };
  return (
    <div class="grid gap-2">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <Select
            options={[
              { value: "", label: big() ? "pick a table to start from" : "everything" },
              ...props.tables.map((table) => ({ value: keyOf(table), label: keyOf(table) })),
            ]}
            value={focus() ?? ""}
            onChange={(next) => setFocus(next === "" ? null : next)}
          />
          <Show when={focus()}>
            <span class="text-sm text-muted">and every table one foreign key away from it</span>
          </Show>
        </div>
        <div class="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            aria-label="Zoom out"
            onClick={() => setZoom(Math.max(0.3, zoom() - 0.15))}
          >
            <span aria-hidden="true">-</span>
          </Button>
          <span class="w-12 text-center text-sm tabular-nums text-muted">
            {Math.round(zoom() * 100)}%
          </span>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Zoom in"
            onClick={() => setZoom(Math.min(2, zoom() + 0.15))}
          >
            <span aria-hidden="true">+</span>
          </Button>
          <Button size="sm" variant="secondary" onClick={() => fit()}>
            Reset
          </Button>
        </div>
      </div>
      <div
        class="relative h-[32rem] overflow-hidden rounded-lg bg-sunken ring ring-line"
        onPointerDown={(event) => {
          // A press that lands on a table is a choice of table, not the start of a pan. Without
          // this the pointer capture below swallowed the click and nothing ever focused.
          if (event.target instanceof Element && event.target.closest("[role='button']") !== null) {
            return;
          }
          setDragging({ x: event.clientX - pan().x, y: event.clientY - pan().y });
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const from = dragging();
          if (from !== null) setPan({ x: event.clientX - from.x, y: event.clientY - from.y });
        }}
        onPointerUp={() => setDragging(null)}
        onWheel={(event) => {
          event.preventDefault();
          setZoom(Math.min(2, Math.max(0.3, zoom() - event.deltaY / 500)));
        }}
      >
        <svg class="h-full w-full" role="img" aria-label="Table relationships">
          <g transform={`translate(${pan().x} ${pan().y}) scale(${zoom()})`}>
            <For each={diagram().edges}>
              {(edge) => (
                <Show when={edgePath(diagram(), edge)}>
                  {(path) => <path d={path()} class="fill-none stroke-line" stroke-width="1.5" />}
                </Show>
              )}
            </For>
            <For each={diagram().boxes}>
              {(box) => (
                <TableBox
                  box={box}
                  focused={box.key === focus()}
                  onFocus={(key) => setFocus(key)}
                />
              )}
            </For>
          </g>
        </svg>
        <Show when={diagram().boxes.length === 0}>
          <p class="absolute inset-0 grid place-items-center text-muted">No tables to draw yet.</p>
        </Show>
      </div>
      <p class="text-sm text-muted">
        Drag to move, scroll to zoom, click a table to see it and everything one foreign key away. A
        filled dot is part of the primary key, a hollow one points at another table, and a
        <span class="font-mono"> *</span> means the column cannot be null.
        <Show when={big() && focus() === null}>
          {" "}
          This schema has {props.tables.length} tables, which is too many to draw at once; pick one
          to start from.
        </Show>
      </p>
    </div>
  );
}
