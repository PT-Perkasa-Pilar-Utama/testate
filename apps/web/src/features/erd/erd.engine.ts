import type { ELK } from "elkjs/lib/elk-api.js";

import type { Measure } from "./erd.layout.ts";

let engine: Promise<ELK> | undefined;

async function start(): Promise<ELK> {
  const [api, worker] = await Promise.all([
    import("elkjs/lib/elk-api.js"),
    import("elkjs/lib/elk-worker.min.js?url"),
  ]);
  return new api.default({ workerFactory: () => new Worker(worker.default) });
}

/**
 * ELK, started on first use. The API is a dynamic import and the layout runs in a worker, so the
 * 1.6 MB of compiled Java behind it costs nothing until someone opens a diagram, and a large schema
 * lays out without freezing the page. The worker is a file of this build, served by this instance:
 * the CSP's `script-src 'self'` covers it.
 */
export function layoutEngine(): Promise<ELK> {
  engine ??= start();
  return engine;
}

const FONTS = {
  label: ["600 12px", "--font-sans"],
  name: ["11px", "--font-sans"],
  type: ["10px", "--font-mono"],
} as const;

/**
 * Text widths from the canvas, in the faces the boxes draw with. Called after `document.fonts.ready`
 * so Mona Sans is measured, not its fallback.
 */
export function canvasMeasure(): Measure {
  const context = document.createElement("canvas").getContext("2d");
  const style = getComputedStyle(document.documentElement);
  return (text, font) => {
    if (context === null) return text.length * 7;
    const [size, family] = FONTS[font];
    context.font = `${size} ${style.getPropertyValue(family)}`;
    return context.measureText(text).width;
  };
}
