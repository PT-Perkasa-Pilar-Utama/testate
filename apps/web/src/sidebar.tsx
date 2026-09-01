import type { JSX } from "@solidjs/web";
import { For, Show, createSignal } from "solid-js";
import type { Actor, Role } from "@testate/shared";

import Icon from "@/components/icon.tsx";
import type { IconName } from "@/components/icon.tsx";
import Logo from "@/components/logo.tsx";
import { MenuItem } from "@/components/menu.tsx";
import { ROLE_LABEL } from "@/lib/labels.ts";
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

/**
 * One sidebar per app, and its button now lives outside it, so the state lives beside them both
 * rather than inside the rail it hides. Written through here rather than from an effect: a
 * module-level effect has no owner to clean it up.
 */
const [collapsed, setCollapsed] = createSignal(storedCollapsed());

function toggleSidebar(): void {
  const next = !collapsed();
  setCollapsed(next);
  try {
    window.localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
  } catch {
    // Nothing to do: the sidebar still works, it just forgets between visits.
  }
}

/** The rail's own handle, rendered by the shell beside it rather than inside it. */
export function SidebarToggle(): JSX.Element {
  return (
    <button
      type="button"
      class="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted hover:bg-hover hover:text-body"
      aria-expanded={collapsed() ? "false" : "true"}
      aria-label={collapsed() ? "Expand the sidebar" : "Collapse the sidebar"}
      title={collapsed() ? "Expand the sidebar" : "Collapse the sidebar"}
      onClick={() => toggleSidebar()}
    >
      <Icon name="panel-left" />
    </button>
  );
}

const THEME_FACE = {
  system: { icon: "monitor", label: "Theme: system" },
  light: { icon: "sun", label: "Theme: light" },
  dark: { icon: "moon", label: "Theme: dark" },
} as const;

/** `admin` -> `AD`, `Dina Putri` -> `DP`. No avatars here, so the initials are the picture. */
function initials(label: string): string {
  const words = label.split(/[\s._-]+/).filter((word) => word !== "");
  const letters =
    words.length > 1 ? words.slice(0, 2).map((word) => word[0] ?? "") : [label.slice(0, 2)];
  return letters.join("").toUpperCase();
}

/**
 * Who you are, and the three things you do about it.
 *
 * The rail used to end in three stacked controls: a link that read `admin · admin`, a theme button
 * and a sign-out button, all competing for the same corner. This is one row that says who you are,
 * and a menu holding the rest, which is where a person already looks for it.
 *
 * A plain `<details>` rather than the `Menu` component: that one is an ellipsis button anchored to
 * the right of a table row and opening downwards, and this is a full-width row at the bottom of a
 * column. `MenuItem` only needs a `<details>` ancestor, so the items still come from there.
 */
function Identity(props: {
  actor: Actor;
  collapsed: boolean;
  current: string | undefined;
  onNav: (event: MouseEvent, path: string) => void;
}): JSX.Element {
  const face = (): (typeof THEME_FACE)[Theme] => THEME_FACE[theme()];
  return (
    <details class="relative">
      <summary
        class={[
          "flex cursor-pointer list-none items-center gap-2 rounded-md hover:bg-hover",
          props.collapsed ? "justify-center p-1" : "p-2",
        ]}
        aria-label={`${props.actor.label}, account and sign out`}
      >
        <span class="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-fill text-xs font-semibold text-body">
          {initials(props.actor.label)}
        </span>
        <Show when={!props.collapsed}>
          <span class="grid min-w-0 flex-1 text-left">
            <span class="truncate text-base font-medium text-body">{props.actor.label}</span>
            <span class="truncate text-xs text-muted">{ROLE_LABEL[props.actor.role]}</span>
          </span>
          <Icon name="chevrons-up-down" class="h-4 w-4 shrink-0 text-muted" />
        </Show>
      </summary>
      <div class="absolute bottom-full left-0 z-20 mb-1 grid w-56 gap-0.5 rounded-lg bg-surface p-1 shadow-lg ring ring-line">
        <div class="grid gap-1.5 px-2 py-1.5">
          <span class="truncate text-sm font-medium text-body">{props.actor.label}</span>
          <span class="truncate text-xs text-muted">{ROLE_LABEL[props.actor.role]}</span>
        </div>
        <div class="my-0.5 border-t border-hairline" />
        {/* Not `MenuLink`: that one lets the browser follow the href, which is right for a download
            and a full page load for a route the router already owns. */}
        <a
          class={[
            "rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover",
            { "bg-fill font-medium": props.current === "/account" },
          ]}
          href={href("/account")}
          onClick={(event) => {
            event.currentTarget.closest("details")?.removeAttribute("open");
            props.onNav(event, "/account");
          }}
        >
          Account
        </a>
        <MenuItem onClick={() => setTheme(nextTheme(theme()))}>
          <span class="flex items-center gap-2">
            <Icon name={face().icon} class="h-3.5 w-3.5" />
            {face().label}
          </span>
        </MenuItem>
        <div class="my-0.5 border-t border-hairline" />
        <MenuItem onClick={() => void signOut()}>Sign out</MenuItem>
      </div>
    </details>
  );
}

export default function Sidebar(props: { current: string | undefined }): JSX.Element {
  const onNav = (event: MouseEvent, path: string): void => {
    event.preventDefault();
    navigate(path);
  };
  return (
    <aside
      class={[
        "sticky top-0 flex h-screen flex-col border-r border-line py-4",
        collapsed() ? "w-12 items-center px-2" : "w-60 px-3",
      ]}
    >
      <div class={["mb-6 flex h-8 items-center", collapsed() ? "justify-center" : "gap-2 px-2"]}>
        <Logo class="h-5 w-5 text-accent" />
        <Show when={!collapsed()}>
          <span class="text-base font-semibold text-heading">Testate</span>
        </Show>
      </div>
      {/*
        The nav stays visible when the rail is collapsed. It used to be `hidden`, so folding the
        sidebar away left a person with no way to go anywhere except Back.
      */}
      <nav class="grid gap-0.5 overflow-y-auto">
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
      <div class="mt-auto">
        <Show when={actor()}>
          {(current) => (
            <Identity
              actor={current()}
              onNav={onNav}
              collapsed={collapsed()}
              current={props.current}
            />
          )}
        </Show>
      </div>
    </aside>
  );
}
