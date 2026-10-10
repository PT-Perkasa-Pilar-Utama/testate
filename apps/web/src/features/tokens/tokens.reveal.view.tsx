import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import SecretReveal from "@/components/secret-reveal.tsx";
import type { TokensPresenter } from "./tokens.presenter.ts";

/** The one moment on this screen a mistake can't be undone: the token, shown once. */
export default function RevealDialog(props: { presenter: TokensPresenter }): JSX.Element {
  const created = (): ReturnType<TokensPresenter["created"]> => props.presenter.created();
  return (
    <SecretReveal
      secret={created()?.token ?? null}
      title={created() === null ? "Token created" : `${created()?.record.name} created`}
      lost="Revoke it and create another to get a new one."
      onCopy={() => void props.presenter.copyCreated()}
      onClose={() => props.presenter.dismissCreated()}
    >
      <Show when={created()}>
        {(result) => (
          <p class="text-sm text-muted">
            {result().record.kind} token · role {result().record.role}
          </p>
        )}
      </Show>
    </SecretReveal>
  );
}
