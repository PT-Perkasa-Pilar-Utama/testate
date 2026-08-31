import type { JSX } from "@solidjs/web";
import { Errored, For, Match, Show, Switch, createEffect, createSignal } from "solid-js";
import type { Role } from "@testate/shared";

import Banner from "@/components/banner.tsx";
import Icon from "@/components/icon.tsx";
import type { IconName } from "@/components/icon.tsx";
import Button from "@/components/button.tsx";
import Toaster from "@/components/toast.tsx";
import AdapterView from "@/features/adapter/adapter.view.tsx";
import GridView from "@/features/data/grid.view.tsx";
import PoliciesView from "@/features/data/policies.view.tsx";
import QueryView from "@/features/data/query.view.tsx";
import StorageView from "@/features/storage/storage.view.tsx";
import AccountView from "@/features/account/account.view.tsx";
import AuditView from "@/features/audit/audit.view.tsx";
import { signOut } from "@/features/auth/auth.presenter.ts";
import ChangePasswordView from "@/features/auth/change-password.view.tsx";
import LoginView from "@/features/auth/login.view.tsx";
import JobsView from "@/features/jobs/jobs.view.tsx";
import ProjectView from "@/features/project/project.view.tsx";
import ProjectsView from "@/features/projects/projects.view.tsx";
import SettingsView from "@/features/settings/settings.view.tsx";
import TokensView from "@/features/tokens/tokens.view.tsx";
import ToolsView from "@/features/tools/tools.view.tsx";
import UsersView from "@/features/users/users.view.tsx";
import { createMatcher, href, location, navigate, search } from "@/lib/router.ts";
import type { Match as RouteMatch } from "@/lib/router.ts";
import { actor, hasRole, session, sessionReady } from "@/lib/session.ts";
import { ROUTES } from "./routes.ts";

const NAV: readonly { label: string; path: string; role: Role; icon: IconName }[] = [
  { label: "Projects", path: "/projects", role: "viewer", icon: "folder" },
  { label: "Jobs", path: "/jobs", role: "viewer", icon: "activity" },
  { label: "Tools", path: "/tools", role: "viewer", icon: "wrench" },
  { label: "Audit", path: "/audit", role: "admin", icon: "scroll-text" },
  { label: "Users", path: "/users", role: "admin", icon: "users" },
  { label: "Tokens", path: "/tokens", role: "admin", icon: "key-round" },
  { label: "Settings", path: "/settings", role: "admin", icon: "settings" },
];

type Access = "ok" | "login" | "forbidden" | "not-found";

/** Route-level guard: public routes pass, the rest need a session with at least the route's role. */
function accessFor(match: RouteMatch | null): Access {
  const route = ROUTES.find((candidate) => candidate.name === match?.name);
  if (route === undefined) return "not-found";
  if (route.role === null) return "ok";
  if (actor() === null) return "login";
  return hasRole(route.role) ? "ok" : "forbidden";
}

function HomeView(): JSX.Element {
  return (
    <section class="grid gap-1.5">
      <h2 class="text-lg font-semibold">Testate</h2>
      <p class="text-muted">Git for your test database. Reset the database, not the developer.</p>
    </section>
  );
}

function Page(props: { match: RouteMatch | null }): JSX.Element {
  const param = (key: string): string => props.match?.params[key] ?? "";
  const name = (): string => props.match?.name ?? "";
  return (
    <Switch fallback={<HomeView />}>
      <Match when={name() === "login"}>
        <Show when={actor() === null} fallback={<HomeView />}>
          <LoginView next="/projects" />
        </Show>
      </Match>
      <Match when={name() === "projects"}>
        <ProjectsView />
      </Match>
      <Match when={name() === "project"}>
        <ProjectView slug={param("slug")} />
      </Match>
      <Match when={name() === "adapter"}>
        <AdapterView slug={param("slug")} id={param("id")} />
      </Match>
      {/*
        Keyed, unlike every other route: the grid holds the filters, sort and cursors of one table
        in signals, and a plain Match would hand the next table the previous table's ones. A key
        that covers the query as well means a foreign-key link into the same table also lands on a
        fresh grid, which a table-name comparison could never catch.
      */}
      <Match
        when={name() === "table" ? `${param("id")}/${param("table")}${search()}` : false}
        keyed
      >
        <GridView slug={param("slug")} id={param("id")} table={param("table")} />
      </Match>
      <Match when={name() === "query"}>
        <QueryView slug={param("slug")} id={param("id")} />
      </Match>
      <Match when={name() === "policies"}>
        <PoliciesView slug={param("slug")} id={param("id")} />
      </Match>
      <Match when={name() === "files"}>
        <StorageView slug={param("slug")} id={param("id")} />
      </Match>
      <Match when={name() === "jobs"}>
        <JobsView />
      </Match>
      <Match when={name() === "audit"}>
        <AuditView />
      </Match>
      <Match when={name() === "settings"}>
        <SettingsView />
      </Match>
      <Match when={name() === "users"}>
        <UsersView />
      </Match>
      <Match when={name() === "tokens"}>
        <TokensView />
      </Match>
      <Match when={name() === "tools"}>
        <ToolsView />
      </Match>
      <Match when={name() === "account"}>
        <AccountView />
      </Match>
    </Switch>
  );
}

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

function Sidebar(props: { current: string | undefined }): JSX.Element {
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
              <Button size="sm" variant="ghost" onClick={() => void signOut()}>
                Sign out
              </Button>
            </>
          )}
        </Show>
      </div>
    </aside>
  );
}

export default function App(): JSX.Element {
  const match = createMatcher(ROUTES);
  const access = (): Access => accessFor(match());
  return (
    <div class="flex min-h-full">
      <Sidebar current={match()?.path} />
      <main class="flex-1 px-8 py-6">
        <Errored
          fallback={(error, reset) => (
            <div class="grid gap-3">
              <Banner variant="error">{String(error())}</Banner>
              <div>
                <Button onClick={reset}>Retry</Button>
              </div>
            </div>
          )}
        >
          <Show when={sessionReady()} fallback={<p class="text-muted">Loading...</p>}>
            <Switch fallback={<Page match={match()} />}>
              <Match when={session()?.must_change_password === true}>
                <ChangePasswordView />
              </Match>
              <Match when={access() === "login"}>
                <LoginView next={location()} />
              </Match>
              <Match when={access() === "forbidden"}>
                <Banner variant="error">Your role cannot open this page.</Banner>
              </Match>
              <Match when={access() === "not-found"}>
                <Banner variant="alert">No page at {location()}.</Banner>
              </Match>
            </Switch>
          </Show>
        </Errored>
      </main>
      <Toaster />
    </div>
  );
}
