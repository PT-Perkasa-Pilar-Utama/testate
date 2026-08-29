/** Migration-history tables no state should carry unless the adapter re-includes them (12 §12.3). */
export const DEFAULT_EXCLUDED_TABLES: readonly string[] = [
  "__drizzle_migrations",
  "_prisma_migrations",
  "knex_migrations",
  "knex_migrations_lock",
  "migrations",
  "typeorm_metadata",
  "mikro_orm_migrations",
  "sequelizemeta",
  "flyway_schema_history",
  "databasechangelog",
  "databasechangeloglock",
  "alembic_version",
  "django_migrations",
  "schema_migrations",
  "ar_internal_metadata",
  "__efmigrationshistory",
];

export function isDefaultExcluded(name: string): boolean {
  return DEFAULT_EXCLUDED_TABLES.includes(name.toLowerCase());
}
