import { createSignal } from "solid-js";
import type { Adapter, Project } from "@testate/shared";

import { humanMessage } from "@/lib/api-error.ts";
import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { navigate } from "@/lib/router.ts";
import { showToast } from "@/lib/toast.ts";
import { adaptersModel } from "../adapters/adapters.model.ts";
import { projectsModel } from "../projects/projects.model.ts";

export type MovePresenter = {
  projects: Refreshable<Project[]>;
  open: () => boolean;
  target: () => string;
  setTarget: (slug: string) => void;
  error: () => string | null;
  busy: () => boolean;
  openMove: () => void;
  close: () => void;
  confirm: () => Promise<void>;
};

export function createMovePresenter(slug: () => string, adapter: () => Adapter): MovePresenter {
  const projects = createRefreshable(() => projectsModel.list());
  const [open, setOpen] = createSignal(false);
  const [target, setTarget] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  return {
    projects,
    open,
    target,
    setTarget,
    error,
    busy,
    openMove: () => {
      setTarget("");
      setError(null);
      setOpen(true);
    },
    close: () => setOpen(false),
    confirm: async () => {
      const [staticSlug, staticAdapter, staticTarget] = [slug(), adapter(), target()];
      setBusy(true);
      setError(null);
      try {
        const moved = await adaptersModel.move(staticSlug, staticAdapter.id, staticTarget);
        setOpen(false);
        showToast(
          moved.init_job === null
            ? `${moved.adapter.name} moved`
            : `${moved.adapter.name} moved; init snapshot queued`,
          "success"
        );
        navigate(`/projects/${encodeURIComponent(staticTarget)}/adapters/${moved.adapter.id}`);
      } catch (cause: unknown) {
        setError(humanMessage(cause, "The adapter could not be moved"));
      } finally {
        setBusy(false);
      }
    },
  };
}
