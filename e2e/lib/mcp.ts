import type { APIRequestContext } from "@playwright/test";

export type ToolArg = string | number | boolean | null | ToolArg[] | { [key: string]: ToolArg };
export type ToolArgs = { [key: string]: ToolArg };

type RpcReply = {
  result?: { content?: { text: string }[]; tools?: { name: string }[] };
  error?: { code: number; message: string };
};

let nextId = 1;

async function rpc(mcp: APIRequestContext, method: string, params: ToolArgs): Promise<RpcReply> {
  nextId += 1;
  const response = await mcp.post("mcp", { data: { jsonrpc: "2.0", id: nextId, method, params } });
  if (!response.ok()) throw new Error(`${method}: ${response.status()} ${await response.text()}`);
  return response.json();
}

export async function listTools(mcp: APIRequestContext): Promise<string[]> {
  const reply = await rpc(mcp, "tools/list", {});
  return (reply.result?.tools ?? []).map((tool) => tool.name);
}

/** One `tools/call`; the tool's JSON payload comes back parsed, an MCP error throws. */
export async function callTool<T>(
  mcp: APIRequestContext,
  name: string,
  args: ToolArgs
): Promise<T> {
  const reply = await rpc(mcp, "tools/call", { name, arguments: args });
  const failure = reply.error;
  if (failure !== undefined) throw new Error(`${name}: ${failure.code} ${failure.message}`);
  const text = reply.result?.content?.[0]?.text;
  if (text === undefined) throw new Error(`${name}: no content in the reply`);
  return JSON.parse(text);
}

export type ToolTable = { name: string; schema: string | null };

/** `schema.name` for a table `list_tables` returned; a missing table is a seed failure. */
export function tableRef(tables: ToolTable[], name: string): string {
  const found = tables.find((table) => table.name === name);
  if (found === undefined) throw new Error(`no table named ${name} in the tool reply`);
  return found.schema === null ? found.name : `${found.schema}.${found.name}`;
}

/** The `id` of the first row of a `page_rows` reply, for a fixture's primary key. */
export function firstId(rows: { id: number }[]): number {
  const first = rows[0];
  if (first === undefined) throw new Error("the table returned no rows");
  return first.id;
}
