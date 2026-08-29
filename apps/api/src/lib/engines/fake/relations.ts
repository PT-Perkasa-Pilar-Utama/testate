import type { TableSchema } from "@testate/shared";

/** `<singular>_id` columns reference `<singular>s` when that table exists, so relation walks have edges. */
export function inferForeignKeys(tables: TableSchema[]): void {
  for (const table of tables) {
    for (const column of table.columns) {
      const match = /^(.+)_id$/.exec(column.name);
      const parent =
        match === null ? undefined : tables.find((item) => item.name === `${match[1]}s`);
      if (parent === undefined || parent === table) continue;
      const ref = { schema: parent.schema, name: parent.name };
      table.foreign_keys_out.push({
        columns: [column.name],
        ref,
        ref_columns: ["id"],
        deferrable: false,
      });
      parent.foreign_keys_in.push({
        from: { schema: table.schema, name: table.name },
        columns: [column.name],
      });
    }
  }
}
