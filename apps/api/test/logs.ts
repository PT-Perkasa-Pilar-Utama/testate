import type { AdapterDraft } from "@testate/shared";

/** A `logfile` adapter over the harness's in-memory SFTP host: a pm2 app's logs (#69). */
export const PM2_LOGS: AdapterDraft = {
  kind: "logs",
  engine: "logfile",
  name: "api-logs",
  config: {
    transport: "sftp",
    host: "logs.sit.internal",
    user: "deploy",
    root_path: "/home/deploy",
    sources: [{ name: "api", glob: ".pm2/logs/api-*.log", format: "pm2" }],
  },
  secrets: { password: "deploy-secret" },
};
