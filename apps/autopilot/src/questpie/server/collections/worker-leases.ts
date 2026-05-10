import { collection } from "#questpie/factories";
import { index } from "drizzle-orm/pg-core";

export const workerLeases = collection("worker_leases")
	.fields(({ f }) => ({
		worker: f.relation("workers").required().label({ en: "Worker" }),
		run: f.relation("runs").required().label({ en: "Run" }),
		claimedAt: f.datetime().required().label({ en: "Claimed At" }),
		expiresAt: f.datetime().label({ en: "Expires At" }),
		status: f
			.select([
				{ value: "active", label: { en: "Active" } },
				{ value: "completed", label: { en: "Completed" } },
				{ value: "expired", label: { en: "Expired" } },
				{ value: "released", label: { en: "Released" } },
			])
			.default("active")
			.label({ en: "Status" }),
		metadata: f.json().label({ en: "Metadata" }),
	}))
	.indexes(({ table }) => [
		index("worker_leases_worker_idx").on(table.worker as any),
		index("worker_leases_run_idx").on(table.run as any),
		index("worker_leases_status_idx").on(table.status as any),
	]);
