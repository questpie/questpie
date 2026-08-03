import type { PGlite } from "@electric-sql/pglite";

import type { PGliteClient } from "../../src/exports/types.js";

declare const pglite: PGlite;

pglite satisfies PGliteClient;
