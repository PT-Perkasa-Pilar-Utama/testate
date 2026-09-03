import { Field, Form, createForm, reset } from "@formisch/solid";
import type { JSX } from "@solidjs/web";
import SubScreen from "@/features/adapter/adapter.subscreen.view.tsx";
import { For, Loading, Show, createEffect, createSignal } from "solid-js";
import type { ColumnPolicy, TableSchema } from "@testate/shared";
import { policyFormSchema } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Pending from "@/components/pending.tsx";
import { DialogActions } from "@/components/dialog.tsx";
import { onceSettled } from "@/lib/form.ts";
import Button from "@/components/button.tsx";
import FormDialog from "@/components/form-dialog.tsx";
import EmptyState from "@/components/empty-state.tsx";
import Select from "@/components/select.tsx";
import Switch from "@/components/switch.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import Banner from "@/components/banner.tsx";
import { hasRole } from "@/lib/session.ts";
import {
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
    <FormDialog
      open={props.presenter.draft() !== null}
      onClose={props.presenter.close}
      title={`Mask for ${props.presenter.draft()?.table ?? ""}.${props.presenter.draft()?.column ?? ""}`}
      size="lg"
      description="Guests and agents see *** in place of this column. Testers and Administrators see the value."
    >
      <Form of={form} class="grid gap-4" onSubmit={(input) => props.presenter.save(input)}>
        <Field of={form} path={["mask"]}>
          {(field) => (
            <label class="grid content-start gap-1.5 text-base">
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
        <DialogActions>
          <Button type="button" variant="ghost" onClick={() => props.presenter.close()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Save
          </Button>
        </DialogActions>
      </Form>
    </FormDialog>
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

/**
 * Column masks per table (06 §6.12, 24 §24.4).
 *
 * The screen used to do two unrelated things. A mask decides who sees a real value and applies
 * everywhere one could leave the database. A required function decides what a value passes through
 * on the way in, and it covers forms, grid edits and import normalizers but not raw SQL, which spec
 * 24 admits out loud. One screen doing both taught neither. The enforcement of required functions
 * stays in the API; only the screen stopped offering them.
 */
export default function PoliciesView(props: { slug: string; id: string }): JSX.Element {
  const presenter = createPoliciesPresenter(
    () => props.slug,
    () => props.id
  );
  const policyOf = (table: string, column: string): ColumnPolicy | undefined =>
    presenter.policies.value().find((policy) => policy.table === table && policy.column === column);
  const policyCount = (table: string): number =>
    presenter.policies.value().filter((policy) => policy.table === table).length;
  // One table at a time: a hundred tables of columns is a page nobody scrolls. The pick starts on
  // the first table with a mask, since that is what an admin came back to look at.
  const [picked, setPicked] = createSignal<string | null>(null);
  const tables = (): TableSchema[] => presenter.schema.value().tables;
  const current = (): TableSchema | undefined =>
    tables().find((table) => qualifiedName(table) === picked()) ??
    tables().find((table) => policyCount(qualifiedName(table)) > 0) ??
    tables()[0];
  const options = (): { value: string; label: string }[] =>
    tables().map((table) => {
      const name = qualifiedName(table);
      const count = policyCount(name);
      return { value: name, label: count === 0 ? name : `${name} (${count} masked)` };
    });
  return (
    <section class="grid gap-4">
      <SubScreen
        slug={props.slug}
        id={props.id}
        leaf="column masks"
        icon="shield"
        title="Column masks"
        description="A mask hides a column from Guests and agents. They see ***. Testers and Administrators see the value. The mask applies to the grid, diffs, exports, fixtures, and the AI agent."
      />
      <Loading fallback={<Pending>Loading schema...</Pending>}>
        <Show
          when={current()}
          fallback={
            <EmptyState icon="table" title="No tables to mask yet">
              Connect a database with tables on it. Come back to hide a column from Guests and
              agents.
            </EmptyState>
          }
        >
          {(table) => (
            <div class="grid gap-3">
              <label class="flex flex-wrap items-center gap-2 text-sm">
                <span class="text-muted">Table</span>
                <Select
                  aria-label="Table"
                  options={options()}
                  value={qualifiedName(table())}
                  onChange={(name) => setPicked(name)}
                />
                <Show when={policyCount(qualifiedName(table())) > 0}>
                  <Badge variant="info">{policyCount(qualifiedName(table()))} masked</Badge>
                </Show>
              </label>
              <Table>
                <thead>
                  <tr>
                    <Head>Column</Head>
                    <Head>Type</Head>
                    <Head>Mask</Head>
                  </tr>
                </thead>
                <tbody>
                  <For each={table().columns}>
                    {(column) => (
                      <Row>
                        <Cell>
                          <code>{column.name}</code>
                        </Cell>
                        <Cell>{column.type}</Cell>
                        <PolicyCell
                          presenter={presenter}
                          policy={policyOf(qualifiedName(table()), column.name)}
                          table={qualifiedName(table())}
                          column={column.name}
                        />
                      </Row>
                    )}
                  </For>
                </tbody>
              </Table>
            </div>
          )}
        </Show>
        <PolicyDialog presenter={presenter} />
      </Loading>
    </section>
  );
}
