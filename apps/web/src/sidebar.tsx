import type { JSX } from "@solidjs/web";
import { For, Show, createEffect, createSignal } from "solid-js";
import type { Role } from "@testate/shared";

import Button from "@/components/button.tsx";
import Icon from "@/components/icon.tsx";
import type { IconName } from "@/components/icon.tsx";
import Logo from "@/components/logo.tsx";
import { signOut } from "@/features/auth/auth.presenter.ts";
import { href, navigate } from "@/lib/router.ts";
import { actor, hasRole } from "@/lib/session.ts";
import { nextTheme, setTheme, theme } from "@/lib/theme.ts";
import type { Theme } from "@/lib/theme.ts";

/**
 * `sections` are headings on the screen itself, shown under the entry while you are on it. The
 * browser does the scrolling and the router never sees them, because the path does not change.
 * They carry the whole path rather than a bare `#id`: the API injects `<base href>` for base-path
 * deploys (ops.basepath.ts), and a fragment on its own resolves against that base, not against the
 * page you are on, so `#limits` from /settings landed on the home screen. Settings is the only long
 * screen today; another one is a line of data here, not new code. A cold `/settings#limits` does
 * not scroll, because the sections do not exist until the screen loads.
 */
const NAV: readonly {
  label: string;
  path: string;
  role: Role;
  icon: IconName;
  sections?: readonly { label: string; id: string }[];
}[] = [
  { label: "Projects", path: "/projects", role: "viewer", icon: "folder" },
  { label: "Jobs", path: "/jobs", role: "viewer", icon: "activity" },
  { label: "Tools", path: "/tools", role: "viewer", icon: "wrench" },
  { label: "Audit", path: "/audit", role: "admin", icon: "scroll-text" },
  { label: "Users", path: "/users", role: "admin", icon: "users" },
  { label: "Tokens", path: "/tokens", role: "admin", icon: "key-round" },
  {
    label: "Settings",
    path: "/settings",
    role: "admin",
    icon: "settings",
    sections: [
      { label: "Health", id: "health" },
      { label: "Storage", id: "storage" },
      { label: "Retention", id: "retention" },
      { label: "Limits", id: "limits" },
      { label: "Quota", id: "quota" },
      { label: "Blocked hosts", id: "blocked-hosts" },
    ],
  },
];

const SIDEBAR_KEY = "testate.sidebar.collapsed";

/** Remembered per browser: a grid wide enough to need the room is wide enough on the next visit. */
function storedCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    // Private windows and blocked site data throw on access rather than return null.
    return false;
  }
}

const THEME_FACE = {
  system: { icon: "monitor", label: "Theme: system" },
  light: { icon: "sun", label: "Theme: light" },
  dark: { icon: "moon", label: "Theme: dark" },
} as const;

/** System, light, dark, and back. Three states because "follow the system" is a real answer. */
function ThemeButton(): JSX.Element {
  const face = (): (typeof THEME_FACE)[Theme] => THEME_FACE[theme()];
  return (
    <Button
      size="sm"
      variant="ghost"
      class="justify-start"
      title={`${face().label}. Switch to ${THEME_FACE[nextTheme(theme())].label.toLowerCase()}`}
      onClick={() => setTheme(nextTheme(theme()))}
    >
      <Icon name={face().icon} class="h-3.5 w-3.5" />
      {face().label}
    </Button>
  );
}

export default function Sidebar(props: { current: string | undefined }): JSX.Element {
  const [collapsed, setCollapsed] = createSignal(storedCollapsed());
  createEffect(
    () => collapsed(),
    (on) => {
      try {
        window.localStorage.setItem(SIDEBAR_KEY, on ? "1" : "0");
      } catch {
        // Nothing to do: the sidebar still works, it just forgets between visits.
      }
    }
  );
  const onNav = (event: MouseEvent, path: string): void => {
    event.preventDefault();
    navigate(path);
  };
  return (
    <aside
      class={[
        "sticky top-0 flex h-screen flex-col overflow-y-auto border-r border-line py-4",
        collapsed() ? "w-12 items-center px-2" : "w-60 px-3",
      ]}
    >
      <div class={["mb-6 flex items-center", collapsed() ? "justify-center" : "gap-2 px-2"]}>
        <button
          type="button"
          class="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted hover:bg-hover hover:text-body"
          aria-expanded={collapsed() ? "false" : "true"}
          aria-label={collapsed() ? "Expand the sidebar" : "Collapse the sidebar"}
          title={collapsed() ? "Expand the sidebar" : "Collapse the sidebar"}
          onClick={() => setCollapsed((on) => !on)}
        >
          <Icon name="panel-left" />
        </button>
        <Show when={!collapsed()}>
          <Logo class="h-5 w-5 text-accent" />
          <span class="text-base font-semibold text-heading">Testate</span>
        </Show>
      </div>
      {/*
        The nav stays visible when the rail is collapsed. It used to be `hidden`, so folding the
        sidebar away left a person with no way to go anywhere except Back.
      */}
      <nav class="grid gap-0.5">
        <For each={NAV.filter((item) => hasRole(item.role))}>
          {(item) => (
            <>
              <a
                class={[
                  "flex items-center rounded-md text-base hover:bg-hover hover:text-body",
                  collapsed() ? "h-9 w-8 justify-center" : "gap-2.5 px-2 py-1.5",
                  props.current === item.path ? "bg-fill font-medium text-body" : "text-muted",
                ]}
                href={href(item.path)}
                onClick={(event) => onNav(event, item.path)}
                title={collapsed() ? item.label : undefined}
                aria-current={props.current === item.path ? "page" : undefined}
              >
                <Icon name={item.icon} label={collapsed() ? item.label : undefined} />
                <Show when={!collapsed()}>{item.label}</Show>
              </a>
              <Show
                when={item.sections !== undefined && !collapsed() && props.current === item.path}
              >
                <div class="mt-0.5 mb-1 ml-4 grid gap-0.5 border-l border-line pl-3">
                  <For each={item.sections ?? []}>
                    {(section) => (
                      <a
                        class="rounded-md px-2 py-1 text-sm text-muted hover:bg-hover hover:text-body"
                        href={`${href(item.path)}#${section.id}`}
                      >
                        {section.label}
                      </a>
                    )}
                  </For>
                </div>
              </Show>
            </>
          )}
        </For>
      </nav>
      <div class={["mt-auto grid gap-2 text-sm", collapsed() ? "hidden" : ""]}>
        <Show when={actor()}>
          {(current) => (
            <>
              <a
                class={[
                  "rounded-md px-2 py-1.5 text-base text-muted hover:bg-hover",
                  { "bg-fill font-semibold": props.current === "/account" },
                ]}
                href={href("/account")}
                onClick={(event) => onNav(event, "/account")}
              >
                {current().label} · {current().role}
              </a>
              <ThemeButton />
              {/* A button centres its label; the account link above it reads from the left edge,
                  and the two sitting in one grid column have to line up on that edge. */}
              <Button
                size="sm"
                variant="ghost"
                class="justify-start"
                onClick={() => void signOut()}
              >
                Sign out
              </Button>
            </>
          )}
        </Show>
      </div>
    </aside>
  );
}
