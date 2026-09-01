import { Field, Form, createForm, reset } from "@formisch/solid";
import type { JSX } from "@solidjs/web";
import AdapterCrumb from "@/features/adapter/adapter.crumb.view.tsx";
import { For, Loading, Show, createEffect } from "solid-js";
import type { ColumnPolicy } from "@testate/shared";
import { policyFormSchema } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import { onceSettled } from "@/lib/form.ts";
import Button from "@/components/button.tsx";
import Dialog from "@/components/dialog.tsx";
import EmptyState from "@/components/empty-state.tsx";
import Icon from "@/components/icon.tsx";
import Select from "@/components/select.tsx";
import Switch from "@/components/switch.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import Banner from "@/components/banner.tsx";
import { hasRole } from "@/lib/session.ts";
import {
  FUNCTION_CHOICES,
  MASK_CHOICES,
  NONE,
  createPoliciesPresenter,
  qualifiedName,
} from "./policies.presenter.ts";
import type { PoliciesPresenter } from "./policies.presenter.ts";

function PolicyDialog(props: { presenter: PoliciesPresenter }): JSX.Element {
  // Seeded, not merely reset on open. A field with no initial input starts `undefined`, and
  // `display` is a boolean the schema requires: the form then fails validation on submit with no
  // message anywhere, because a Switch has nowhere to show one.
  const form = createForm({
    schema: policyFormSchema,
    initialInput: { fn: NONE, mask: NONE, display: false },
  });
  createEffect(
    () => props.presenter.draft(),
    (draft) => {
      if (draft !== null) {
        onceSettled(() =>
          reset(form, { initialInput: { fn: draft.fn, mask: draft.mask, display: draft.display } })
        );
      }
    }
  );
  return (
    <Dialog
      open={props.presenter.draft() !== null}
      onClose={() => props.presenter.close()}
      title={`Policy for ${props.presenter.draft()?.table ?? ""}.${props.presenter.draft()?.column ?? ""}`}
      description="A required function is applied to every form, grid, and import write; a mask hides the column from viewers and agents."
    >
      <Form of={form} class="grid gap-4" onSubmit={(input) => props.presenter.save(input)}>
        <Field of={form} path={["fn"]}>
          {(field) => (
            <label class="grid gap-1.5 text-base">
              <span>Required function</span>
              <Select
                options={FUNCTION_CHOICES}
                value={field.input ?? NONE}
                onChange={(fn) => field.onInput(fn)}
              />
            </label>
          )}
        </Field>
        <Field of={form} path={["mask"]}>
          {(field) => (
            <label class="grid gap-1.5 text-base">
              <span>Mask</span>
              <Select
                options={MASK_CHOICES}
                value={field.input ?? NONE}
                onChange={(mask) => field.onInput(mask)}
              />
            </label>
          )}
        </Field>
        <Field of={form} path={["display"]}>
          {(field) => (
            <Switch
              label="Use as the table's display column for lookups"
              checked={field.input ?? false}
              onChange={(display) => field.onInput(display)}
            />
          )}
        </Field>
        <Show when={props.presenter.error()}>
          {(message) => <Banner variant="error">{message()}</Banner>}
        </Show>
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => props.presenter.close()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Save
          </Button>
        </div>
      </Form>
    </Dialog>
  );
}

function PolicyCell(props: {
  presenter: PoliciesPresenter;
  policy: ColumnPolicy | undefined;
  table: string;
  column: string;
}): JSX.Element {
  const editable = (): boolean =>
    hasRole("qa") && (props.policy === undefined || !props.policy.locked || hasRole("admin"));
  return (
    <Cell>
      <div class="flex flex-wrap items-center gap-1">
        <Show when={props.policy} fallback={<span class="text-muted">none</span>}>
          {(policy) => (
            <>
              <Show when={policy().required_function}>
                {(fn) => <Badge variant="info">fn {fn().name}</Badge>}
              </Show>
              <Show when={policy().mask}>
                {(mask) => <Badge variant="warning">mask {mask()}</Badge>}
              </Show>
              <Show when={policy().display}>
                <Badge variant="secondary">display</Badge>
              </Show>
              <Show when={policy().locked}>
                <Badge variant="error">locked</Badge>
              </Show>
            </>
          )}
        </Show>
        <Show when={editable()}>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => props.presenter.open(props.table, props.column)}
          >
            {props.policy === undefined ? "Add" : "Edit"}
          </Button>
        </Show>
        <Show when={props.policy !== undefined && editable()}>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const policy = props.policy;
              if (policy !== undefined) void props.presenter.remove(policy);
            }}
          >
            Remove
          </Button>
        </Show>
        <Show when={props.policy !== undefined && hasRole("admin")}>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const policy = props.policy;
              if (policy !== undefined) void props.presenter.setLock(policy, !policy.locked);
            }}
          >
            {props.policy?.locked === true ? "Unlock" : "Lock"}
          </Button>
        </Show>
      </div>
    </Cell>
  );
}

/** Column policies per table (06 §6.12): required function, mask, display column, admin lock. */
export default function PoliciesView(props: { slug: string; id: string }): JSX.Element {
  const presenter = createPoliciesPresenter(
    () => props.slug,
    () => props.id
  );
  const policyOf = (table: string, column: string): ColumnPolicy | undefined =>
    presenter.policies.value().find((policy) => policy.table === table && policy.column === column);
  const policyCount = (table: string): number =>
    presenter.policies.value().filter((policy) => policy.table === table).length;
  return (
    <section class="grid gap-4">
      <div class="grid gap-1.5">
        <h2 class="flex items-center gap-2 text-lg font-semibold">
          <Icon name="shield" class="h-4 w-4 text-muted" />
          <AdapterCrumb slug={props.slug} id={props.id} /> / column policies
        </h2>
        <p class="max-w-prose text-sm text-muted">
          Admin work. A required function or a mask set here applies everywhere a value could leave
          this database: the grid, imports, diffs, fixtures, and the AI agent. There is no unmask.
        </p>
      </div>
      <Loading fallback={<p class="text-muted">Loading schema...</p>}>
        <For
          each={presenter.schema.value().tables}
          fallback={
            <EmptyState icon="table" title="No tables to police yet">
              Connect a database with tables on it, then come back to set required functions and
              masks per column.
            </EmptyState>
          }
        >
          {(table) => (
            <div class="grid gap-2">
              <h3 class="flex items-center gap-2 font-medium">
                <code>{qualifiedName(table)}</code>
                <Show when={policyCount(qualifiedName(table)) > 0}>
                  <Badge variant="info">{policyCount(qualifiedName(table))} policed</Badge>
                </Show>
              </h3>
              <Table>
                <thead>
                  <tr>
                    <Head>Column</Head>
                    <Head>Type</Head>
                    <Head>Policy</Head>
                  </tr>
                </thead>
                <tbody>
                  <For each={table.columns}>
                    {(column) => (
                      <Row>
                        <Cell>
                          <code>{column.name}</code>
                        </Cell>
                        <Cell>{column.type}</Cell>
                        <PolicyCell
                          presenter={presenter}
                          policy={policyOf(qualifiedName(table), column.name)}
                          table={qualifiedName(table)}
                          column={column.name}
                        />
                      </Row>
                    )}
                  </For>
                </tbody>
              </Table>
            </div>
          )}
        </For>
        <PolicyDialog presenter={presenter} />
      </Loading>
    </section>
  );
}
