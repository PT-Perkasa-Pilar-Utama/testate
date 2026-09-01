import type { JSX } from "@solidjs/web";
import { Errored, Match, Show, Switch } from "solid-js";

import Banner from "@/components/banner.tsx";
import Crashed from "@/components/crashed.tsx";
import Toaster from "@/components/toast.tsx";
import AdapterView from "@/features/adapter/adapter.view.tsx";
import GridView from "@/features/data/grid.view.tsx";
import PoliciesView from "@/features/data/policies.view.tsx";
import QueryView from "@/features/data/query.view.tsx";
import AdapterImportsView from "@/features/imports/imports.adapter.view.tsx";
import DiffView from "@/features/diff/diff.view.tsx";
import StorageView from "@/features/storage/storage.view.tsx";
import HomeView from "@/features/home/home.view.tsx";
import StoresView from "@/features/storage/stores.view.tsx";
import AccountView from "@/features/account/account.view.tsx";
import AuditView from "@/features/audit/audit.view.tsx";
import ChangePasswordView from "@/features/auth/change-password.view.tsx";
import LoginView from "@/features/auth/login.view.tsx";
import JobsView from "@/features/jobs/jobs.view.tsx";
import ProjectView from "@/features/project/project.view.tsx";
import ProjectsView from "@/features/projects/projects.view.tsx";
import SettingsView from "@/features/settings/settings.view.tsx";
import TokensView from "@/features/tokens/tokens.view.tsx";
import ToolsView from "@/features/tools/tools.view.tsx";
import UsersView from "@/features/users/users.view.tsx";
import { createMatcher, location, search } from "@/lib/router.ts";
import type { Match as RouteMatch } from "@/lib/router.ts";
import { actor, hasRole, session, sessionReady } from "@/lib/session.ts";
import { ROUTES } from "./routes.ts";
import Sidebar from "./sidebar.tsx";

type Access = "ok" | "login" | "forbidden" | "not-found";

/** Route-level guard: public routes pass, the rest need a session with at least the route's role. */
function accessFor(match: RouteMatch | null): Access {
  const route = ROUTES.find((candidate) => candidate.name === match?.name);
  if (route === undefined) return "not-found";
  if (route.role === null) return "ok";
  if (actor() === null) return "login";
  return hasRole(route.role) ? "ok" : "forbidden";
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
      <Match when={name() === "diff"}>
        <DiffView slug={param("slug")} id={param("id")} />
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
      <Match when={name() === "imports"}>
        <AdapterImportsView slug={param("slug")} id={param("id")} />
      </Match>
      <Match when={name() === "masks" || name() === "policies"}>
        <PoliciesView slug={param("slug")} id={param("id")} />
      </Match>
      <Match when={name() === "files"}>
        <StorageView slug={param("slug")} id={param("id")} />
      </Match>
      <Match when={name() === "storage"}>
        <StoresView />
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

export default function App(): JSX.Element {
  const match = createMatcher(ROUTES);
  const access = (): Access => accessFor(match());
  /**
   * Signing in and the forced password change are the whole page. Neither has a project to
   * navigate, so the sidebar beside them was an empty rail with a collapse button, and `main`'s
   * padding pushed the card off the middle of the screen.
   */
  const signedOut = (): boolean =>
    sessionReady() &&
    (session()?.must_change_password === true ||
      access() === "login" ||
      (match()?.name === "login" && actor() === null));
  return (
    <Show when={!signedOut()} fallback={<AuthScreen next={location()} />}>
      <div class="flex min-h-full">
        <Sidebar current={match()?.path} />
        {/* `min-w-0` so a wide table scrolls inside its own box rather than stretching the shell. */}
        <main class="min-w-0 flex-1 px-8 py-6">
          <Errored
            fallback={(error, reset) => (
              <Crashed detail={String(error())} reset={reset} where={location()} />
            )}
          >
            <Show when={sessionReady()} fallback={<p class="text-muted">Loading...</p>}>
              <Switch fallback={<Page match={match()} />}>
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
    </Show>
  );
}

/** The signed-out page: one card, centred on both axes, and nothing else on screen. */
function AuthScreen(props: { next: string }): JSX.Element {
  return (
    <div class="grid min-h-screen place-items-center px-4 py-10">
      <Show
        when={session()?.must_change_password === true}
        fallback={<LoginView next={props.next} />}
      >
        <ChangePasswordView />
      </Show>
      <Toaster />
    </div>
  );
}
