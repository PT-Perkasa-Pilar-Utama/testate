-- A normalizer belongs to a table, not just to the adapter it lives on.
--
-- The name was unique per adapter, which was the right shape while a mapping was named once and
-- picked from a wizard. It is the wrong shape now that the screen offers the saved ones for the
-- table you are importing into: two tables on one database cannot both have the one called
-- "weekly", and the one that gets there first takes the name for the whole adapter.
--
-- Nothing can conflict on the way in. The old index made (adapter_id, name) unique, and that
-- implies (adapter_id, target, name) is unique too, so every existing row already satisfies the
-- narrower rule.
DROP INDEX import_mappings_adapter_name;

CREATE UNIQUE INDEX import_mappings_adapter_target_name
  ON import_mappings (adapter_id, target, name COLLATE NOCASE);
