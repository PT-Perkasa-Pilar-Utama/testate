-- "Mapping" said which column goes where and nothing else.
--
-- A saved import rule also says how each value is converted, which columns match an existing row,
-- and what happens to one that is already there. That is a normalizer, and the product calls it
-- one everywhere a person can read: this brings the tables and the column in line, so a reader of
-- the schema and a reader of the screen are looking at the same word.
--
-- The index goes with the table it is on; SQLite carries indexes across a table rename, but it
-- keeps the old name, and an index called `import_mappings_adapter_target_name` on a table called
-- `normalizers` is exactly the confusion this migration exists to remove.
ALTER TABLE import_mappings RENAME TO normalizers;

DROP INDEX import_mappings_adapter_target_name;

CREATE UNIQUE INDEX normalizers_adapter_target_name
  ON normalizers (adapter_id, target, name COLLATE NOCASE);

ALTER TABLE import_runs RENAME COLUMN mapping_id TO normalizer_id;
