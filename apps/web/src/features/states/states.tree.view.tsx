import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { StateTreeNode } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Icon from "@/components/icon.tsx";
import { formatWhen } from "@/lib/format.ts";
import { STATE_KIND_LABEL } from "@/lib/labels.ts";
import { formatBytes } from "./states.format.ts";

/**
 * One branch point: a commit dot, the name, what kind it is, and the same quiet metadata line the
 * timeline uses. Children hang off a rail the way a git graph draws them, so a person can tell a
 * child from a sibling without counting indentation.
 */
function Node(props: { node: StateTreeNode; onOpen: (node: StateTreeNode) => void }): JSX.Element {
  return (
    <li class="grid gap-1.5">
      {/* A button, not a paragraph. The tree drew a name and a badge and did nothing when you
          pressed it, which is why it read as decoration. */}
      <button
        type="button"
        class="flex w-full cursor-pointer items-start gap-2 rounded-md p-1 text-left hover:bg-hover"
        onClick={() => props.onOpen(props.node)}
      >
        <Icon
          name="git-commit-horizontal"
          class={
            props.node.is_head
              ? "mt-0.5 h-3.5 w-3.5 shrink-0 text-accent"
              : "mt-0.5 h-3.5 w-3.5 shrink-0 text-muted"
          }
        />
        <div class="grid min-w-0 gap-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-medium text-heading">{props.node.name}</span>
            <Badge variant={props.node.kind === "init" ? "primary" : "outline"}>
              {STATE_KIND_LABEL[props.node.kind]}
            </Badge>
            <Show when={props.node.is_head}>
              <Badge variant="success">HEAD</Badge>
            </Show>
          </div>
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span class="tabular-nums">{formatBytes(props.node.size_bytes)}</span>
            <span aria-hidden="true">·</span>
            <span class="whitespace-nowrap tabular-nums">{formatWhen(props.node.created_at)}</span>
          </div>
        </div>
      </button>
      <Show when={props.node.children.length > 0}>
        <ul class="grid gap-3 border-l border-line pl-5">
          <For each={props.node.children}>
            {(child) => <Node node={child} onOpen={props.onOpen} />}
          </For>
        </ul>
      </Show>
    </li>
  );
}

export type TreeProps = {
  nodes: readonly StateTreeNode[];
  empty: JSX.Element;
  onOpen: (node: StateTreeNode) => void;
};

/**
 * The branch history, in place of the bare nested list this used to be: no dot, no kind, name and
 * metadata run together on one line at `text-sm`. An engineer reading it could not tell a child
 * state from a sibling without counting indentation by eye.
 */
export default function Tree(props: TreeProps): JSX.Element {
  return (
    <Show
      when={props.nodes.length > 0}
      fallback={
        <div class="rounded-lg bg-surface px-5 py-8 text-center text-muted ring ring-line">
          {props.empty}
        </div>
      }
    >
      <ul
        class="grid gap-3 rounded-lg bg-surface px-5 py-4 ring ring-line"
        aria-label="State history"
      >
        <For each={props.nodes}>{(node) => <Node node={node} onOpen={props.onOpen} />}</For>
      </ul>
    </Show>
  );
}
