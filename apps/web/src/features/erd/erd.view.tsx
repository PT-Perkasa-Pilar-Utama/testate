import type { JSX } from "@solidjs/web";
import { For, Loading, Show, createEffect, createMemo, createSignal } from "solid-js";
import type { TableSchema } from "@testate/shared";

import Button from "@/components/button.tsx";
import Pending from "@/components/pending.tsx";
import Select from "@/components/select.tsx";
import { canvasMeasure, layoutEngine } from "./erd.engine.ts";
import { HEADER, ROW, keyOf, layout, neighbours } from "./erd.layout.ts";
import type { Box, BoxColumn, Diagram, Edge } from "./erd.layout.ts";

/** Past this many tables a whole-schema diagram is a hairball, so it starts at one table instead. */
const WHOLE_SCHEMA_CAP = 200;
const PADDING = 24;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2;

/** Filled for part of the primary key, hollow for a foreign key, blank otherwise. */
function marker(column: BoxColumn): string {
  if (column.key) return "● ";
  return column.ref ? "○ " : "  ";
}

/** ELK's orthogonal route as a polyline. */
function pathOf(edge: Edge): string {
  return edge.points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
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
              <Show when={column.shownType !== column.type}>
                <title>{column.type}</title>
              </Show>
              {column.shownType}
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

/** The laid-out diagram. It reports each new layout so the canvas can fit it to the view. */
function Drawing(props: {
  diagram: Diagram;
  focus: string | null;
  onFocus: (key: string) => void;
  onLaidOut: (diagram: Diagram) => void;
}): JSX.Element {
  // The handler is taken in the compute: a prop read inside an effect callback is the untracked
  // read Solid 2 warns about.
  createEffect(
    () => ({ diagram: props.diagram, onLaidOut: props.onLaidOut }),
    ({ diagram, onLaidOut }) => onLaidOut(diagram)
  );
  return (
    <>
      <For each={props.diagram.edges}>
        {(edge) => (
          <g>
            <title>{`${edge.from} (${edge.label}) → ${edge.to}`}</title>
            <path d={pathOf(edge)} class="fill-none stroke-line" stroke-width="1.5" />
            {/* The dot marks the referenced end: a line alone does not say which way it points. */}
            <Show when={edge.points.at(-1)}>
              {(end) => <circle cx={end().x} cy={end().y} r="3" class="fill-muted" />}
            </Show>
          </g>
        )}
      </For>
      <For each={props.diagram.boxes}>
        {(box) => <TableBox box={box} focused={box.key === props.focus} onFocus={props.onFocus} />}
      </For>
    </>
  );
}

/**
 * The schema as boxes and lines, laid out from the foreign keys every time by ELK.
 *
 * No dragging and nothing stored: a saved position goes stale the moment a column is added, and
 * the layout is cheap enough to recompute. Pan with a drag, zoom with the wheel, pick a table to
 * see it with every table one foreign key away, in either direction.
 */
export default function Erd(props: { tables: readonly TableSchema[] }): JSX.Element {
  const [focus, setFocus] = createSignal<string | null>(null);
  /** Where the last press on empty canvas landed; a release near it is a click, not a pan. */
  const [pressed, setPressed] = createSignal<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = createSignal(1);
  const [pan, setPan] = createSignal({ x: PADDING, y: PADDING });
  const [dragging, setDragging] = createSignal<{ x: number; y: number } | null>(null);
  // A plain variable, not a signal: the frame is measured, never tracked, and `fit` runs from an
  // effect callback where a signal read would be the untracked read Solid warns about.
  let frame: HTMLDivElement | undefined;
  const big = (): boolean => props.tables.length > WHOLE_SCHEMA_CAP;
  const shown = createMemo(() => {
    const at = focus();
    if (at === null) return big() ? props.tables.slice(0, 1) : props.tables;
    return neighbours(props.tables, at);
  });
  const diagram = createMemo(async () => {
    const tables = shown();
    const engine = await layoutEngine();
    await document.fonts.ready;
    return layout(tables, canvasMeasure(), engine);
  });
  let laid: Diagram | null = null;
  /** The whole diagram in view, never zoomed past 100% for a small one. */
  const fit = (): void => {
    const box = frame?.getBoundingClientRect();
    if (laid === null || box === undefined || laid.width === 0) return;
    const scale = Math.min(
      1,
      (box.width - PADDING * 2) / laid.width,
      (box.height - PADDING * 2) / laid.height
    );
    setZoom(Math.max(MIN_ZOOM, scale));
    setPan({ x: PADDING, y: PADDING });
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
            <span class="text-sm whitespace-nowrap text-muted">
              and every table one foreign key away from it
            </span>
          </Show>
        </div>
        <div class="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            aria-label="Zoom out"
            onClick={() => setZoom(Math.max(MIN_ZOOM, zoom() - 0.15))}
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
            onClick={() => setZoom(Math.min(MAX_ZOOM, zoom() + 0.15))}
          >
            <span aria-hidden="true">+</span>
          </Button>
          <Button size="sm" variant="secondary" onClick={() => fit()}>
            Fit
          </Button>
        </div>
      </div>
      <div
        ref={(element) => {
          frame = element;
        }}
        class="relative h-[70vh] min-h-[28rem] overflow-hidden rounded-lg bg-sunken ring ring-line"
        onPointerDown={(event) => {
          // A press that lands on a table is a choice of table, not the start of a pan. Without
          // this the pointer capture below swallowed the click and nothing ever focused.
          if (event.target instanceof Element && event.target.closest("[role='button']") !== null) {
            return;
          }
          setDragging({ x: event.clientX - pan().x, y: event.clientY - pan().y });
          setPressed({ x: event.clientX, y: event.clientY });
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const from = dragging();
          if (from !== null) setPan({ x: event.clientX - from.x, y: event.clientY - from.y });
        }}
        onPointerUp={(event) => {
          // A click on empty canvas ends the focus: back to every table.
          const at = pressed();
          if (at !== null && Math.hypot(event.clientX - at.x, event.clientY - at.y) < 4) {
            setFocus(null);
          }
          setPressed(null);
          setDragging(null);
        }}
        onWheel={(event) => {
          event.preventDefault();
          setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom() - event.deltaY / 500)));
        }}
      >
        <Loading
          fallback={
            <div class="absolute inset-0 grid place-items-center">
              <Pending>Laying out {shown().length} tables...</Pending>
            </div>
          }
        >
          <svg class="h-full w-full" role="img" aria-label="Table relationships">
            <g transform={`translate(${pan().x} ${pan().y}) scale(${zoom()})`}>
              <Drawing
                diagram={diagram()}
                focus={focus()}
                onFocus={(key) => setFocus(key)}
                onLaidOut={(next) => {
                  laid = next;
                  fit();
                }}
              />
            </g>
          </svg>
          <Show when={diagram().boxes.length === 0}>
            <p class="absolute inset-0 grid place-items-center text-muted">
              No tables to draw yet.
            </p>
          </Show>
        </Loading>
      </div>
      <p class="text-sm text-muted">
        Drag to move, scroll to zoom, click a table to see it and everything one foreign key away. A
        filled dot is part of the primary key. A hollow one points at another table. A
        <span class="font-mono"> *</span> means the column cannot be null. Each line runs from a
        foreign key column to the column it references, which the dot marks.
        <Show when={big() && focus() === null}>
          {" "}
          This schema has {props.tables.length} tables, more than the {WHOLE_SCHEMA_CAP} a diagram
          can show at once. Pick one to start from.
        </Show>
      </p>
    </div>
  );
}
