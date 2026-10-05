import type { Handler } from "../../lib/http/index.ts";

export type DataHandlers = {
  schema: Handler;
  rows: Handler;
  lookup: Handler;
  startWriteSession: Handler;
  setWriteSessionOptions: Handler;
  endWriteSession: Handler;
  rowEdits: Handler;
  query: Handler;
  tableExport: Handler;
  queryExport: Handler;
  runningQueries: Handler;
  cancelQuery: Handler;
  savedQueries: Handler;
  createSavedQuery: Handler;
  updateSavedQuery: Handler;
  removeSavedQuery: Handler;
  history: Handler;
  policies: Handler;
  upsertPolicy: Handler;
  removePolicy: Handler;
  lockPolicy: Handler;
  unlockPolicy: Handler;
  fixture: Handler;
};
