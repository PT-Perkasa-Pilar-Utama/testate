---
name: formisch-forms
description: How every form in Testate is built - Formisch driven by a shared valibot schema, per-field errors under their own control, server errors as a banner. Covers the Solid 2 patch Formisch needs, the migration recipe from the old createFormGuard, and the traps. Use whenever you add, change, or review a form in apps/web.
---

# Forms

Every form in `apps/web` is a [Formisch](https://formisch.dev) form driven by a valibot schema
from `@testate/shared`. One schema states the shape, the rules and the messages; the API validates
against it and the browser validates against it, so nothing is written twice.

`apps/web/src/features/auth/login.view.tsx` is the reference. Read it before writing a new form.

## Formisch needs a patch to run here, and it is not optional

Formisch declares `"solid-js": ">=1.6 <2"`. That upper bound is real: its Solid adapter imports
`batch` and `splitProps`, which Solid 2 removed. `patches/@formisch%2Fsolid@1.0.0.patch` restores
both in the two raw-JSX builds, and `patches/README.md` explains why those builds and not the
compiled ones. Two things follow:

- `apps/web/vite.config.ts` keeps `@formisch/solid` out of `optimizeDeps`. Remove that and esbuild
  resolves the compiled build, which imports `solid-js/web` - a subpath Solid 2 does not have. The
  symptom is a blank page and `does not provide an export named 'batch'` in the console.
- After any Formisch or Solid upgrade, check the built bundle:
  `bun run --cwd apps/web build && grep -c "solid-js/web" apps/web/dist/assets/*.js` must print 0.
  `bun install` failing to apply the patch is the signal to re-check, not to force it through.

## The shape of a form

```tsx
import { Field, Form, createForm } from "@formisch/solid";
import { loginSchema } from "@testate/shared";

const form = createForm({ schema: loginSchema });

<Form of={form} class="grid gap-4" onSubmit={(input) => presenter.submit(input)}>
  <Field of={form} path={["username"]}>
    {(field) => (
      <label class="grid gap-1.5 text-base">
        <span>Username</span>
        <Input
          {...field.props}
          type="text"
          value={field.input}
          variant={field.errors ? "error" : "default"}
          aria-invalid={field.errors ? "true" : undefined}
        />
        <FieldError message={field.errors?.[0]} />
      </label>
    )}
  </Field>
  <Show when={presenter.error()}>{(m) => <Banner variant="error">{m()}</Banner>}</Show>
  <Button type="submit" variant="primary" disabled={presenter.busy()}>Sign in</Button>
</Form>
```

`onSubmit` runs only when the schema passes, and its argument is the parsed output, already typed.
There is nothing to check first.

## Rules

- **The schema lives in `@testate/shared`.** If the API takes this body, its schema already exists;
  import it. A form-only shape still goes in `packages/shared` - the contract package is where a
  shape is stated, and `v.InferOutput` gives you the type.
- **Write the messages into the schema**, not the markup: `v.minLength(1, "Enter your username.")`.
  A person reads the same sentence whether the browser caught it or the API did.
- **A field's message goes under the field**, through `FieldError`, and the control turns red with
  it (`Input`'s `error` variant). Never collect messages into a banner at the top of the form; that
  makes a person read a list and then hunt for the box it names.
- **A server refusal is not a field error.** A wrong password, a name already taken, an adapter that
  will not connect: those come back from the API and belong in a `Banner`, held by the presenter.
  Keep `presenter.error()` and `presenter.busy()`; drop the value signals, the form owns those.
- **Keep the `<label><span>Label</span><Input/></label>` markup.** The browser suite finds controls
  with `getByLabel("Username")`, and Formisch is headless, so the markup is entirely yours to keep.
- **Spread `field.props` first**, then your own attributes. `value={field.input}` comes after the
  spread on purpose.

## Migrating a form off `createFormGuard`

`grep -rl createFormGuard apps/web/src` is the work list. Per form:

1. Find or add the valibot schema in `packages/shared`, with messages.
2. `const form = createForm({ schema })` replaces `createFormGuard()`.
3. `<form ref={guard.ref} novalidate onSubmit={...}>` becomes `<Form of={form} onSubmit={...}>`;
   `<Form>` sets `novalidate` itself.
4. Delete `<FormErrors errors={guard.errors()} />` and the `guard.accepts(event)` branch.
5. Wrap each control in `<Field of={form} path={["name"]}>` and take `value`/`onInput` off the
   presenter: the form holds them now.
6. The presenter keeps `error`, `busy` and a `submit(input)` that takes the parsed output.

`lib/form.ts` and `components/form-errors.tsx` go when the last form leaves them. Until then they
still serve the forms that have not moved.

## Traps

- **`<Field>` takes a function child**, so its `field` is only valid inside that callback. Do not
  lift it into a variable read elsewhere, and do not nest a `<Show>` whose `when` reads it - that is
  the stale-narrowed-value error that took whole screens into the error boundary before
  (`imports.wizard.view.tsx` carries the scar and the explanation).
- **`field.errors` is an array or undefined**, not a string. `field.errors?.[0]` is the first
  message; `FieldError` handles the undefined case.
- **A `path` is an array**, `["adapter", "host"]` for nested shapes, and it is type-checked against
  the schema. A typo is a compile error, not a silent no-op.
- **The schema is the only validator, but keep `required` on the input.** No hand-written checks in
  the submit handler, and no second rule anywhere. `required` stays for two reasons that are not
  validation: it is the correct semantics for a screen reader, and `e2e/lib/crawl.ts` fills
  `input[required]` to get a dialog submitted. Strip it and the crawler submits every dialog empty,
  Formisch refuses, and the successful-submit path quietly stops being covered. `<Form>` sets
  `novalidate`, so the browser never shows a bubble for it.
- **Always give `createForm` an `initialInput`.** A field with none starts `undefined`, and the
  schema then refuses it on submit. For a string that is visible and fine: the message lands under
  the input. For anything else it is invisible and the form simply does nothing when you press the
  button, because a select, a switch and an array have nowhere to put a message. An array is worse
  still: its item stores are built from the initial input, so an array that starts empty has no
  fields at all and no later `reset` gives it any.

  ```tsx
  const form = createForm({
    schema: policyFormSchema,
    initialInput: { fn: NONE, mask: NONE, display: false },
  });
  ```

  When the values depend on a prop, read it with `untrack` and make sure the component is rebuilt
  when that prop changes (`grid.view.tsx` keys the row form on its table with `<For>`, because
  `<Show>` keeps the mounted component when one table replaces another).
- **Everything reactive belongs in an effect's compute, never its callback.** Solid 2's
  `createEffect(compute, effect)` only tracks the first function, so
  `(open) => { if (open) reset(form, { initialInput: fromProps() }) }` reads `fromProps` outside any
  tracking scope. Compute the value, then write it:

  ```tsx
  createEffect(
    () => (props.presenter.editing() ? draftFrom(props.record) : null),
    (draft) => {
      if (draft !== null) reset(form, { initialInput: draft });
    }
  );
  ```

  The callback must also return a cleanup function or nothing at all: a concise body like
  `() => props.presenter.invalidate()` returns whatever that call returns, and Solid 2 refuses it
  as an invalid cleanup value, which takes the whole screen into the error boundary.
- **Dialogs stay mounted, so a form does not reset itself.** The design system forbids conditionally
  rendering a dialog (it kills the open and close animation), so `<Dialog open={...}>` and the
  `createForm` inside it live for as long as the screen does. A reopened dialog therefore shows the
  last values and the last errors unless you say otherwise. Call `reset(form)` when it opens, and
  for an edit dialog `reset(form, { initialInput: record })` to prefill from the row being edited:

  ```tsx
  import { reset } from "@formisch/solid";
  createEffect(() => props.presenter.editing(), (record) => {
    if (record !== null) reset(form, { initialInput: toDraft(record) });
  });
  ```

## Before you finish

- `bun run complete-check`.
- Drive the form in a browser: submit it empty, watch each message appear under its own control,
  type and watch it clear, then submit a value the server refuses and check that lands in the
  banner instead. Type-checking proves none of that.
