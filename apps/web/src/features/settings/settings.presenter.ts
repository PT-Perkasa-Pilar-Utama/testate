import { createSignal } from "solid-js";
import type { HealthAdmin, Job, JsonObject, Settings } from "@testate/shared";

import { attempt, showToast } from "@/lib/toast.ts";
import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { followJob } from "@/lib/sse.ts";
import { settingsModel } from "./settings.model.ts";

export const SECTIONS = ["retention", "limits", "quota"] as const;
export type Section = (typeof SECTIONS)[number];
export type SettingRow = { key: string; name: string; value: string; locked: boolean };
export type S3Draft = {
  bucket: string;
  prefix: string;
  region: string;
  endpoint: string;
  virtual_hosted: boolean;
  access_key_id: string;
  secret_access_key: string;
};

export type SettingsPresenter = Refreshable<Settings> & {
  /** The same report `GET /health` serves an admin; the standalone screen nothing linked to is gone. */
  health: Refreshable<HealthAdmin>;
  rows: (section: Section) => SettingRow[];
  drafts: () => Map<string, string>;
  setValue: (key: string, value: string) => void;
  save: (section: Section) => Promise<void>;
  /** The deny list as text, one entry per line; empty until the person edits it. */
  denyDraft: () => string | null;
  setDenyDraft: (value: string) => void;
  saveDeny: () => Promise<void>;
  migrating: () => boolean;
  targetDriver: () => "local" | "s3";
  s3: () => S3Draft;
  openMigrate: () => void;
  closeMigrate: () => void;
  setTargetDriver: (driver: "local" | "s3") => void;
  setS3: (patch: Partial<S3Draft>) => void;
  migrate: () => Promise<void>;
  includeBlobs: () => boolean;
  setIncludeBlobs: (value: boolean) => void;
  backupJob: () => Job | null;
  runBackup: () => Promise<void>;
  backupUrl: (job: Job) => string;
};

const EMPTY_S3: S3Draft = {
  bucket: "",
  prefix: "",
  region: "",
  endpoint: "",
  virtual_hosted: true,
  access_key_id: "",
  secret_access_key: "",
};

/** One host, CIDR or host:port per line, blanks dropped. */
export function denyList(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** The PATCH body for one section: only edited, unlocked keys, as integers (story 120). */
export function sectionPatch(
  section: Section,
  rows: SettingRow[],
  drafts: Map<string, string>
): JsonObject {
  const changes: JsonObject = {};
  for (const row of rows) {
    const text = drafts.get(row.key);
    if (row.locked || text === undefined || text.trim() === row.value) continue;
    changes[row.name] = text.trim() === "" ? null : Number(text);
  }
  return { [section]: changes };
}

/** The migration body: local needs nothing; S3 sends every field, blanks for region and endpoint as absent. */
export function migrationBody(driver: "local" | "s3", s3: S3Draft): JsonObject {
  if (driver === "local") return { target: { driver: "local" } };
  const target: JsonObject = {
    bucket: s3.bucket.trim(),
    prefix: s3.prefix.trim(),
    virtual_hosted: s3.virtual_hosted,
    access_key_id: s3.access_key_id,
    secret_access_key: s3.secret_access_key,
  };
  if (s3.region.trim() !== "") target["region"] = s3.region.trim();
  if (s3.endpoint.trim() !== "") target["endpoint"] = s3.endpoint.trim();
  return { target: { driver: "s3", s3: target } };
}

export function createSettingsPresenter(): SettingsPresenter {
  const settings = createRefreshable(() => settingsModel.get());
  const health = createRefreshable(() => settingsModel.health());
  const [drafts, setDrafts] = createSignal(new Map<string, string>());
  const [denyDraft, setDenyDraft] = createSignal<string | null>(null);
  const [migrating, setMigrating] = createSignal(false);
  const [targetDriver, setTargetDriver] = createSignal<"local" | "s3">("s3");
  const [s3, setS3Signal] = createSignal<S3Draft>(EMPTY_S3);
  const [includeBlobs, setIncludeBlobs] = createSignal(false);
  const [backupJob, setBackupJob] = createSignal<Job | null>(null);
  const rows = (section: Section): SettingRow[] => {
    const current = settings.value();
    return Object.entries(current[section]).map(([name, value]) => ({
      key: `${section}.${name}`,
      name,
      value: value === null ? "" : String(value),
      locked: current.locked_by_env.includes(`${section}.${name}`),
    }));
  };
  return {
    ...settings,
    health,
    rows,
    drafts,
    denyDraft,
    setDenyDraft: (value) => setDenyDraft(value),
    saveDeny: () => {
      const staticDeny = denyList(denyDraft() ?? "");
      return attempt(async () => {
        const result = await settingsModel.update({ netguard: { deny: staticDeny } });
        setDenyDraft(null);
        settings.refresh();
        const disabled = result.disabled_adapters ?? [];
        showToast(
          disabled.length === 0
            ? "netguard saved"
            : `netguard saved; disabled ${disabled.join(", ")}`,
          "success"
        );
      });
    },
    setValue: (key, value) => setDrafts((current) => new Map(current).set(key, value)),
    save: (section) => {
      const staticBody = sectionPatch(section, rows(section), drafts());
      return attempt(async () => {
        const result = await settingsModel.update(staticBody);
        setDrafts(new Map());
        settings.refresh();
        const disabled = result.disabled_adapters ?? [];
        showToast(
          disabled.length === 0
            ? `${section} saved`
            : `${section} saved; disabled ${disabled.join(", ")}`,
          "success"
        );
      });
    },
    migrating,
    targetDriver,
    s3,
    openMigrate: () => {
      setTargetDriver(settings.value().store.driver === "s3" ? "local" : "s3");
      setS3Signal(EMPTY_S3);
      setMigrating(true);
    },
    closeMigrate: () => setMigrating(false),
    setTargetDriver,
    setS3: (patch) => setS3Signal((current) => ({ ...current, ...patch })),
    migrate: () => {
      const staticBody = migrationBody(targetDriver(), s3());
      return attempt(async () => {
        const job = await settingsModel.migrate(staticBody);
        setMigrating(false);
        showToast("Store migration queued; snapshots copy to the new store", "info");
        followJob(job, (done) => {
          showToast(
            `Store migration ${done.status}`,
            done.status === "succeeded" ? "success" : "error"
          );
          settings.refresh();
        });
      });
    },
    includeBlobs,
    setIncludeBlobs,
    backupJob,
    runBackup: () => {
      const staticBody: JsonObject = { include_blobs: includeBlobs(), destination: "download" };
      return attempt(async () => {
        const job = await settingsModel.backup(staticBody);
        setBackupJob(job);
        followJob(job, (done) => {
          setBackupJob(done);
          showToast(`Backup ${done.status}`, done.status === "succeeded" ? "success" : "error");
        });
      });
    },
    backupUrl: (job) => settingsModel.backupUrl(job.id),
  };
}
