import type { JSX } from "@solidjs/web";
import { Errored, For, Match, Show, Switch } from "solid-js";
import type { Role } from "@testate/shared";

import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import Toaster from "@/components/toast.tsx";
import AdapterView from "@/features/adapter/adapter.view.tsx";
import GridView from "@/features/data/grid.view.tsx";
import PoliciesView from "@/features/data/policies.view.tsx";
import QueryView from "@/features/data/query.view.tsx";
import RestView from "@/features/rest/rest.view.tsx";
import StorageView from "@/features/storage/storage.view.tsx";
import AccountView from "@/features/account/account.view.tsx";
import AuditView from "@/features/audit/audit.view.tsx";
import { signOut } from "@/features/auth/auth.presenter.ts";
import ChangePasswordView from "@/features/auth/change-password.view.tsx";
import LoginView from "@/features/auth/login.view.tsx";
import HealthView from "@/features/health/health.view.tsx";
import JobsView from "@/features/jobs/jobs.view.tsx";
import ProjectView from "@/features/project/project.view.tsx";
import ProjectsView from "@/features/projects/projects.view.tsx";
import SettingsView from "@/features/settings/settings.view.tsx";
import TokensView from "@/features/tokens/tokens.view.tsx";
import ToolsView from "@/features/tools/tools.view.tsx";
import UsersView from "@/features/users/users.view.tsx";
import { createMatcher, href, location, navigate } from "@/lib/router.ts";
import type { Match as RouteMatch } from "@/lib/router.ts";
import { actor, hasRole, session, sessionReady } from "@/lib/session.ts";
import { ROUTES } from "./routes.ts";

const NAV: readonly { label: string; path: string; role: Role }[] = [
  { label: "Projects", path: "/projects", role: "viewer" },
  { label: "Jobs", path: "/jobs", role: "viewer" },
  { label: "Tools", path: "/tools", role: "viewer" },
  { label: "Audit", path: "/audit", role: "admin" },
  { label: "Users", path: "/users", role: "admin" },
  { label: "Tokens", path: "/tokens", role: "admin" },
  { label: "Settings", path: "/settings", role: "admin" },
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
      <p class="text-kumo-subtle">
        Git for your test database. Reset the database, not the developer.
      </p>
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
      <Match when={name() === "table"}>
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
      <Match when={name() === "requests"}>
        <RestView slug={param("slug")} id={param("id")} />
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
      <Match when={name() === "health"}>
        <HealthView />
      </Match>
    </Switch>
  );
}

function Sidebar(props: { current: string | undefined }): JSX.Element {
  const onNav = (event: MouseEvent, path: string): void => {
    event.preventDefault();
    navigate(path);
  };
  return (
    <aside class="sticky top-0 flex h-screen w-60 flex-col overflow-y-auto border-r border-kumo-line px-3 py-4">
      <div class="mb-6 px-2 text-base font-semibold text-kumo-strong">Testate</div>
      <nav class="grid gap-1">
        <For each={NAV.filter((item) => hasRole(item.role))}>
          {(item) => (
            <a
              class={[
                "rounded-md px-2 py-1.5 text-base text-kumo-default hover:bg-kumo-tint",
                { "bg-kumo-fill font-semibold": props.current === item.path },
              ]}
              href={href(item.path)}
              onClick={(event) => onNav(event, item.path)}
            >
              {item.label}
            </a>
          )}
        </For>
      </nav>
      <div class="mt-auto grid gap-2 text-sm">
        <Show when={actor()}>
          {(current) => (
            <>
              <a
                class={[
                  "rounded-md px-2 py-1.5 text-base text-kumo-subtle hover:bg-kumo-tint",
                  { "bg-kumo-fill font-semibold": props.current === "/account" },
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
          <Show when={sessionReady()} fallback={<p class="text-kumo-subtle">Loading...</p>}>
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
