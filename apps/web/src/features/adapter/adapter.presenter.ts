import { createSignal } from "solid-js";
import type { Adapter, AdapterEditFormInput, Entry, Introspection } from "@testate/shared";

import { attempt, showToast } from "@/lib/toast.ts";
import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { navigate } from "@/lib/router.ts";
import { createJobFollower } from "@/lib/sse.ts";
import { adaptersModel } from "../adapters/adapters.model.ts";
import type { AdapterDeletionPlan } from "../adapters/adapters.model.ts";
import { describeOutcome } from "../adapters/adapters.presenter.ts";
import type { Values } from "../adapters/adapters.fields.ts";
import { adapterModel } from "./adapter.model.ts";
import { draftFrom, toPatchBody } from "./adapter.edit.ts";

export type AdapterDetail =
  | { view: "tables"; schema: Introspection }
  | { view: "files"; entries: Entry[] };

/**
 * Rename, exclusions, schemas and the restore knobs live in the Formisch form now
 * (`adapterEditFormSchema`); this only holds what the form cannot: the per-engine config/secret/
 * readonly values (their keys are decided at runtime by `ENGINE_FORMS`, so no static schema can own
 * them) and what the server answers.
 */
export type AdapterPresenter = {
  adapter: Refreshable<Adapter>;
  detail: Refreshable<AdapterDetail>;
  tables: () => Introspection | null;
  entries: () => Entry[] | null;
  setMode: (mode: "sandbox" | "read_only") => Promise<void>;
  editing: () => boolean;
  values: () => Values;
  openEdit: () => void;
  closeEdit: () => void;
  setValue: (key: string, value: string) => void;
  save: (input: AdapterEditFormInput) => Promise<void>;
  retest: () => Promise<void>;
  plan: () => AdapterDeletionPlan | null;
  openDelete: () => Promise<void>;
  closeDelete: () => void;
  confirmDelete: () => Promise<void>;
};

/** The Files tier lists entries; every other tier introspects. */
async function loadDetail(slug: string, adapter: Adapter): Promise<AdapterDetail> {
  if (adapter.tier === "files") {
    return { view: "files", entries: await adapterModel.entries(slug, adapter.id) };
  }
  return { view: "tables", schema: await adapterModel.schema(slug, adapter.id) };
}

export function createAdapterPresenter(slug: () => string, id: () => string): AdapterPresenter {
  // Created here, in the presenter's own body: the follower registers its cleanup with the
  // owner that is current at this moment, and there is none inside an effect or after an await.
  const jobs = createJobFollower();
  const adapter = createRefreshable(() => adaptersModel.get(slug(), id()));
  const detail = createRefreshable(() => loadDetail(slug(), adapter.value()));
  const [plan, setPlan] = createSignal<AdapterDeletionPlan | null>(null);
  const [editing, setEditing] = createSignal(false);
  const [values, setValues] = createSignal<Values>({});
  return {
    editing,
    values,
    openEdit: () => {
      // The dialog stays mounted (design-system rule); seed the per-engine values from the record
      // being edited each time it opens. The view resets the Formisch fields the same way.
      setValues(draftFrom(adapter.value()).values);
      setEditing(true);
    },
    closeEdit: () => setEditing(false),
    setValue: (key, value) => setValues((current) => ({ ...current, [key]: value })),
    save: (input) => {
      const staticSlug = slug();
      const staticId = id();
      const currentAdapter = adapter.value();
      const staticBody = toPatchBody({ ...input, values: values() }, currentAdapter);
      return attempt(async () => {
        const result = await adaptersModel.update(staticSlug, staticId, staticBody);
        setEditing(false);
        adapter.refresh();
        detail.refresh();
        showToast(
          result.init_job === null ? "Adapter saved" : "Adapter saved. Init snapshot queued.",
          "success"
        );
      });
    },
    adapter,
    detail,
    tables: () => {
      const current = detail.value();
      return current.view === "tables" ? current.schema : null;
    },
    entries: () => {
      const current = detail.value();
      return current.view === "files" ? current.entries : null;
    },
    setMode: (mode) => {
      const staticSlug = slug();
      const staticId = id();
      return attempt(async () => {
        await adaptersModel.setMode(staticSlug, staticId, mode);
        adapter.refresh();
      });
    },
    retest: () => {
      const staticSlug = slug();
      const staticId = id();
      return attempt(async () => {
        const outcome = await adaptersModel.retest(staticSlug, staticId);
        showToast(describeOutcome(outcome), "success");
        adapter.refresh();
      });
    },
    plan,
    openDelete: () => {
      const staticSlug = slug();
      const staticId = id();
      return attempt(async () => {
        setPlan(await adaptersModel.deletionPlan(staticSlug, staticId));
      });
    },
    closeDelete: () => setPlan(null),
    confirmDelete: () => {
      const staticPlan = plan();
      const staticSlug = slug();
      const staticId = id();
      const staticKind = adapter.value().kind;
      if (staticPlan === null) return Promise.resolve();
      return attempt(async () => {
        const job = await adaptersModel.remove(staticSlug, staticId, {
          plan_id: staticPlan.plan_id,
          action: staticPlan.adapter.action === "skip" ? "skip" : "restore",
        });
        setPlan(null);
        showToast("Deletion job queued. The database returns to its init state first.", "info");
        // The project page opens on States (the rework of 2026-09-01); send the admin back to the tab
        // they were just working in, not the tester's front door.
        jobs.follow(job, (done) => {
          showToast(
            `Adapter deletion ${done.status}`,
            done.status === "succeeded" ? "success" : "error"
          );
          // A file store is the Storage screen's; a database is the project's.
          navigate(staticKind === "storage" ? "/storage" : `/projects/${staticSlug}?tab=adapters`);
        });
      });
    },
  };
}
