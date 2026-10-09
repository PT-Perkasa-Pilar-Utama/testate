import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import Breadcrumbs from "@/components/breadcrumbs.tsx";
import { buttonClass } from "@/components/button.tsx";
import Icon from "@/components/icon.tsx";
import InspectBadge from "@/components/inspect-badge.tsx";
import { href } from "@/lib/router.ts";
import { hasRole } from "@/lib/session.ts";
import AdaptersView from "../adapters/adapters.view.tsx";
import type { ProjectPresenter } from "./project.presenter.ts";

/**
 * The built-in Inspect project (#56, Q7): its adapters and nothing else. No HEAD, no Snapshot, no
 * settings and no tabs, because states, checkouts and imports never happen here, and a control that
 * would only be refused is not shown.
 */
export default function InspectProject(props: {
  presenter: ProjectPresenter;
  slug: string;
}): JSX.Element {
  const project = () => props.presenter.overview.value().project;
  return (
    <section class="grid gap-5">
      <div class="grid gap-3 border-b border-line pb-4">
        <Breadcrumbs
          items={[{ label: "Projects", href: "/projects" }, { label: project().name }]}
        />
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="grid gap-1.5">
            <div class="flex flex-wrap items-center gap-2">
              <Icon name="eye" class="h-5 w-5 text-info-fg" />
              <h2 class="text-2xl font-semibold tracking-tight text-heading">{project().name}</h2>
              <InspectBadge />
            </div>
            <p class="max-w-prose text-muted">{project().description}</p>
          </div>
          {/* Tokens are an admin's screen, so only an admin is offered the way there. */}
          <Show when={hasRole("admin")}>
            <a class={buttonClass("secondary")} href={href("/tokens?new=inspect")}>
              <Icon name="key-round" class="h-4 w-4" />
              Make an agent token
            </a>
          </Show>
        </div>
      </div>
      <AdaptersView
        slug={props.slug}
        inspect
        onChanged={() => props.presenter.overview.refresh()}
      />
    </section>
  );
}
