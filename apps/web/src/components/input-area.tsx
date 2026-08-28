import type { ComponentProps, JSX } from "@solidjs/web";
import { merge, omit } from "solid-js";

import { FIELD_BASE, FIELD_VARIANTS } from "./input.tsx";

export type InputAreaProps = ComponentProps<"textarea"> & {
  variant?: keyof typeof FIELD_VARIANTS;
};

export default function InputArea(props: InputAreaProps): JSX.Element {
  const local = merge({ variant: "default", rows: 6 } as const, props);
  const rest = omit(local, "variant", "class");
  return (
    <textarea
      {...rest}
      class={[
        FIELD_BASE,
        "rounded-lg px-3 py-2 text-base",
        FIELD_VARIANTS[local.variant],
        local.class,
      ]}
    />
  );
}
