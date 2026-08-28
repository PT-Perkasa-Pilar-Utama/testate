# How Testate uses Solid 2.0

Prescriptive: this file states the shapes the code must follow. `docs/technical-specs/03-repository-structure.md` and `docs/CODING_STANDARD.md` carry the rules; when the code and this file disagree, fix the code or update both.

## Layout

```
apps/web/src/
  main.tsx                   render(<App />); top-level <Errored>
  app.tsx                    shell: sidebar, topbar, toast host, router outlet
  routes.ts                  route table: path pattern -> lazy view -> required role
  features/<feature>/
    <feature>.model.ts       API calls through lib/api-client; parses responses with schemas from @testate/shared
    <feature>.presenter.ts   create<Feature>Presenter(): signals, async memos, actions; no JSX
    <feature>.view.tsx       JSX only; calls the presenter factory once
  components/                one hand-rolled Kumo component per file
  lib/
    api-client.ts            fetch wrapper: base path, cookies, x-request-id, envelope, ApiError
    router.ts                history-API router: navigate(), useRoute(), <Link>
    sse.ts                   EventSource wrapper for job events, returns a cleanup
    session.ts               current user and role, module-level signals
```

Dependency direction, top to bottom only:

```
components  <-  features/*.view.tsx  ->  features/*.presenter.ts  ->  features/*.model.ts  ->  lib/api-client
```

- Views hold JSX and view-local UI state (an open dialog, a hovered row). They never call `fetch`, parse with valibot, open an `EventSource`, or read `localStorage`.
- Presenters own feature state and every action. They call models and `lib/`, nothing above them.
- Models are thin: one function per endpoint, typed by `@testate/shared` schemas, no state.
- `components/` never imports from `features/`.

## Model: one function per endpoint

```ts
// features/states/states.model.ts
import { apiClient } from "@/lib/api-client";
import { stateSchema, statePageSchema, type State, type StatePage } from "@testate/shared";

export const statesModel = {
  list: (slug: string, cursor?: string): Promise<StatePage> =>
    apiClient.get(`/projects/${slug}/states`, { query: { cursor }, schema: statePageSchema }),
  create: (slug: string, input: CreateStateInput): Promise<Job> =>
    apiClient.post(`/projects/${slug}/states`, input, { schema: jobSchema }),
};
```

`apiClient` unwraps the `{ data }` envelope, parses `data` with the given schema, and throws `ApiError` with the `code` from the error envelope. Nothing else in the app calls `fetch`.

## Presenter: a factory called from the view

`create<Feature>Presenter()` is called inside the view component so `createMemo`, `createEffect`, and `onCleanup` have an owner. It returns a named type with function-typed members.

```ts
export type StatesPresenter = {
  states: () => State[];
  selected: () => State | undefined;
  select: (id: string) => void;
  snapshot: (input: CreateStateInput) => Promise<void>;
};

export function createStatesPresenter(slug: () => string): StatesPresenter {
  const [version, bump] = createSignal(0);
  const [selectedId, setSelectedId] = createSignal<string>();
  const page = createMemo(async (): Promise<StatePage> => {
    version();                                  // dependency: re-run after any write
    return statesModel.list(slug());
  });
  const states = (): State[] => page().data;
  const selected = (): State | undefined => states().find((s) => s.id === selectedId());
  async function snapshot(input: CreateStateInput): Promise<void> {
    const job = await statesModel.create(slug(), input);
    await jobs.wait(job.id);                    // lib/sse.ts: resolves on a terminal status
    bump((n) => n + 1);                         // invalidates every memo that read version()
  }
  return { states, selected, select: setSelectedId, snapshot };
}
```

Global state (current user, navigation) lives in `lib/session.ts` as module-level signals with no memos, because there is no owner at module scope.

## View: JSX only, async memos inside Loading

```tsx
export default function StatesView(): JSX.Element {
  const route = useRoute();
  const presenter = createStatesPresenter(() => route.params().slug);
  return (
    <Loading fallback={<p class="text-kumo-subtle">Loading states...</p>}>
      <Show when={presenter.selected()} fallback={<Banner>Select a state.</Banner>}>
        {(state) => <StateDetail state={state()} />}
      </Show>
      <Button onClick={() => void attempt(() => presenter.snapshot({ name: name() }))}>Take state</Button>
    </Loading>
  );
}
```

`app.tsx` wraps the outlet in `<Errored fallback={(error, reset) => ...}>`, so a rejected memo shows a banner with a retry button. An `ApiError` with code `UNAUTHORIZED` is handled once, in `api-client`, by clearing the session and navigating to login.

## Event handlers and async work

```tsx
<Button onClick={() => void attempt(presenter.checkout)}>Checkout</Button>
```

`attempt` (in `components/toast.tsx`) is `async`: it awaits the task and reports failures with a toast, so handlers never chain `.catch`. Prefix the call with `void` in a handler that does not await it. An inner arrow passed to `attempt` must not read `props`; capture `const presenter = props.presenter` in the handler first, or `solid/reactivity` flags it.

## Job progress over server-sent events

`lib/sse.ts` opens one `EventSource` per job and returns a cleanup. Presenters subscribe inside a two-function effect and store progress in a signal; the effect's cleanup closes the source.

```ts
createEffect(
  () => activeJobId(),
  (jobId) => {
    if (jobId === undefined) return;
    return subscribeJob(jobId, setProgress);   // returns () => source.close()
  }
);
```

## Router

`lib/router.ts` matches `location.pathname` (minus the base path) against `routes.ts`, exposes `navigate(path)`, `useRoute()` (an accessor of `{ name, params }`), and a `<Link>` component that calls `navigate` on click. Every route names the minimum role; `app.tsx` redirects to login or shows a forbidden banner before rendering the view. Deep links are stable and shareable; a state or diff URL opens the same view for every user with access.

## Components

One component per file in `components/`, default export, props type `<Name>Props`. Defaults via `merge`, forwarding via `omit` captured in a variable, Kumo class strings in `as const` maps, structured `class` arrays.

```tsx
export default function Button(props: ButtonProps): JSX.Element {
  const local = merge({ variant: "secondary", size: "base", type: "button" } as const, props);
  const rest = omit(local, "variant", "size", "class", "children");
  return (
    <button {...rest} class={[BASE, VARIANTS[local.variant], SIZES[local.size], local.class]}>
      {local.children}
    </button>
  );
}
```

Native elements first: `<dialog>` with `showModal()` driven by a two-function effect, `<select>`, `<button role="switch">`, `<details>` for collapsible sections. The starting set is ported from Audionesia: badge, banner, button, dialog, input, input-area, kbd, layer-card, meter, select, switch, table, tabs, toast. Testate adds data-grid, tree, code-editor (CodeMirror 6 wrapped in one component), json-viewer, file-tree, and command-palette.

## Forms

No form library. A presenter keeps form values in a store, validates with the `@testate/shared` valibot schema on submit, and maps issues to field errors by path. Sealed inputs (passwords, keys) are `type="password"`, never pre-filled, and submit only when the user typed a new value.
