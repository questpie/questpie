/**
 * Drizzle Column Utilities for Field Definitions
 *
 * Re-exports Drizzle column types for convenient access in field implementations.
 */

// Re-export Drizzle column builders for field implementations
export {
  varchar,
  text,
  integer,
  smallint,
  bigint,
  real,
  doublePrecision,
  numeric,
  boolean,
  date,
  timestamp,
  time,
  jsonb,
  json,
  uuid,
  serial,
  smallserial,
  bigserial,
  char,
  cidr,
  inet,
  macaddr,
  macaddr8,
  interval,
  point,
  line,
  geometry,
} from "drizzle-orm/pg-core";

// Re-export types commonly used in field definitions
export type {
  AnyPgColumn,
  PgColumn,
  PgVarchar,
  PgText,
  PgInteger,
  PgSmallInt,
  PgBigInt53,
  PgBigInt64,
  PgReal,
  PgDoublePrecision,
  PgNumeric,
  PgBoolean,
  PgDate,
  PgTimestamp,
  PgTime,
  PgJsonb,
  PgJson,
  PgUUID,
} from "drizzle-orm/pg-core";
