import type { JSX } from "@solidjs/web";
import type { JsonValue } from "@testate/shared";
import { For } from "solid-js";

import { tokensOf } from "@/lib/json-tokens.ts";
import type { Token } from "@/lib/json-tokens.ts";

const KIND_CLASS = {
  key: "text-accent",
  string: "text-body",
  number: "text-warning-fg",
  literal: "text-info-fg",
  plain: "text-muted",
} as const;

/** A value as indented JSON, coloured by token, selectable as text. */
export default function JsonView(props: { value: JsonValue }): JSX.Element {
  const tokens = (): Token[] => tokensOf(JSON.stringify(props.value, null, 2));
  return (
    <pre class="font-mono text-sm leading-6 whitespace-pre select-text">
      <For each={tokens()}>
        {(token) => <span class={KIND_CLASS[token.kind]}>{token.text}</span>}
      </For>
    </pre>
  );
}
