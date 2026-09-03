import type { JSX } from "@solidjs/web";
import { For, Show, createEffect, createSignal } from "solid-js";
import type { StateTreeNode } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Icon from "@/components/icon.tsx";
import { formatWhen } from "@/lib/format.ts";
import { STATE_KIND_LABEL } from "@/lib/labels.ts";
import { formatBytes } from "./states.format.ts";

/**
 * One branch point: a commit dot, the name, what kind it is, and the same quiet metadata line the
 * timeline uses. Children hang off a rail the way a git graph draws them, so a person can tell a
 * child from a sibling without counting indentation. The row's own actions sit at its right.
 */
function Node(props: {
  node: StateTreeNode;
  onOpen: (node: StateTreeNode) => void;
  actions: (node: StateTreeNode) => JSX.Element;
  onHead: (element: HTMLLIElement) => void;
}): JSX.Element {
  const stash = (): boolean => props.node.kind === "stash";
  return (
    <li
      class="grid gap-1.5"
      ref={(element) => {
        if (props.node.is_head) props.onHead(element);
      }}
    >
      <div class="flex items-start gap-2">
        {/* A button, not a paragraph. The tree drew a name and a badge and did nothing when you
            pressed it, which is why it read as decoration. */}
        <button
          type="button"
          class="flex min-w-0 flex-1 cursor-pointer items-start gap-2 rounded-md p-1 text-left hover:bg-hover"
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
              <span class={["font-medium", stash() ? "text-muted italic" : "text-heading"]}>
                {props.node.name}
              </span>
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
              <span class="whitespace-nowrap tabular-nums">
                {formatWhen(props.node.created_at)}
              </span>
            </div>
          </div>
        </button>
        <div class="flex shrink-0 items-center gap-1 pt-1">{props.actions(props.node)}</div>
      </div>
      <Show when={props.node.children.length > 0}>
        <ul class="grid gap-3 border-l border-line pl-5">
          <For each={props.node.children}>
            {(child) => (
              <Node
                node={child}
                onOpen={props.onOpen}
                actions={props.actions}
                onHead={props.onHead}
              />
            )}
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
  /** The row's own controls, so this file never learns what a checkout is. */
  actions: (node: StateTreeNode) => JSX.Element;
};

/**
 * The branch history: dots and rails, in a box that scrolls rather than grows, opened with HEAD
 * in view because that is the node a person came to find, not the init state at the top.
 */
export default function Tree(props: TreeProps): JSX.Element {
  const [head, setHead] = createSignal<HTMLLIElement | null>(null);
  // Once per tree, after it renders: the callback runs with the element and returns nothing.
  createEffect(
    () => ({ element: head(), count: props.nodes.length }),
    ({ element }) => {
      if (element !== null) element.scrollIntoView({ block: "center" });
    }
  );
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
        class="grid max-h-[36rem] min-h-[20rem] gap-3 overflow-y-auto rounded-lg bg-surface px-5 py-4 ring ring-line"
        aria-label="State history"
      >
        <For each={props.nodes}>
          {(node) => (
            <Node node={node} onOpen={props.onOpen} actions={props.actions} onHead={setHead} />
          )}
        </For>
      </ul>
    </Show>
  );
}
