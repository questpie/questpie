import { index, uniqueIndex } from "drizzle-orm/pg-core";

import { collection } from "#questpie/factories";

/**
 * `document_store` — the NoSQL DATA store for mini-app records (Decision 8 + §7).
 *
 * The v2 split: the `assets` file store holds FILES (incl. the `.app` bundle);
 * `document_store` holds RECORDS — queryable jsonb keyed by a `store` namespace.
 *
 * **Namespaced + capability-GRANTED, NOT hard app-clamped.** A row is namespaced
 * by `store`; a mini-app accesses a store IFF its manifest grants it
 * (`data.stores: { <store>: ["read"|"write"] }`). This ENABLES cross-app sharing
 * (an analytics app granted `{ invoices:["read"] }` reads the invoicing app's
 * `invoices` store) while staying default-deny — a hard per-app silo would kill
 * every cross-app tool.
 *
 * **The write boundary lives in the broker, not here.** Guest CRUD routes through
 * `mini-app-bindings.ts` `buildDocumentStoreAccessor`, which clamps every call to
 * the run's GRANTED stores (read: inject `where.store IN grantedRead` + the G3
 * where/orderBy guard; create: force `store` ∈ grantedWrite, reject a
 * client-supplied `store`/`id`/`createdAt`; update/delete: blast-radius-contain
 * the `where` to granted stores) and dispatches `accessMode:"system"` — the
 * store-grant clamp IS the authorization (mirrors the G1 file-as-DB pattern). The
 * `.access()` rules below therefore gate only the NON-mini-app surface (admin /
 * HTTP), which must never be anonymously writable.
 *
 * `createdByApp` is PROVENANCE ONLY (which app first wrote the row) — it is NOT
 * the access key. Access is decided purely by the caller's `store` grants, so a
 * row created by app A in a shared store is readable/writable by app B if B is
 * also granted that store.
 *
 * Schema: `{ store, key, data jsonb, createdByApp }` + auto timestamps,
 * `unique(store, key)`, `GIN(data)`.
 */
export default collection("document_store")
	.fields(({ f }) => ({
		/** Namespace this record belongs to (the capability-granted axis). */
		store: f.text().required().label({ en: "Store" }),
		/** Record key, unique WITHIN a store. */
		key: f.text().required().label({ en: "Key" }),
		/** The record payload (queryable jsonb). */
		data: f.json().label({ en: "Data" }),
		/**
		 * PROVENANCE: the appId that first created the row. NOT the access key —
		 * access is governed by the caller's `store` grants, never by this column.
		 */
		createdByApp: f.text().label({ en: "Created By App" }),
	}))
	.access({
		/**
		 * The NON-mini-app surface (admin / direct HTTP) requires an authenticated
		 * session for EVERY op — `document_store` is never anonymously readable or
		 * writable. The mini-app binding path bypasses these rules (it dispatches
		 * `accessMode:"system"` after the broker's store-grant row-filter clamp, which
		 * is the real tenant authorization). These rules are written EXPLICITLY (not
		 * left to the framework's rule-less `!!session` fallback) so the collection's
		 * intent is auditable and consistent.
		 */
		read: ({ session }) => !!session,
		create: ({ session }) => !!session,
		update: ({ session }) => !!session,
		delete: ({ session }) => !!session,
	})
	.title(({ f }) => f.key)
	.admin(({ c }) => ({
		label: { en: "Document Store" },
		icon: c.icon("ph:database"),
		hidden: true,
		audit: false,
	}))
	.indexes(({ table }) => [
		// One row per (store, key) — the NoSQL upsert key.
		uniqueIndex("document_store_store_key_idx").on(
			table.store as any,
			table.key as any,
		),
		// Fast store-scoped scans (the row-filter clamp keys on `store`).
		index("document_store_store_idx").on(table.store as any),
		// jsonb containment/path queries on the payload.
		index("document_store_data_gin_idx").using("gin", table.data as any),
	]);
