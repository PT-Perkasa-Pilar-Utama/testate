import type { JSX } from "@solidjs/web";

import Badge from "./badge.tsx";
import Icon from "./icon.tsx";

/** Marks the built-in Inspect project wherever it appears: its card, its page, pickers, Storage. */
export default function InspectBadge(): JSX.Element {
  return (
    <Badge variant="info">
      <Icon name="eye" class="h-3 w-3" />
      Built in · read-only
    </Badge>
  );
}
