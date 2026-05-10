import { collection } from "questpie";
import { index } from "questpie/drizzle-pg-core";

export const aiWorkerLeasesCollection = collection("ai_worker_leases")
  .fields(({ f }) => ({
    worker: f.relation("ai_workers").required().label({ en: "Worker" }),
    run: f.relation("ai_runs").required().label({ en: "Run" }),
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
    index("ai_worker_leases_worker_idx").on(table.worker as any),
    index("ai_worker_leases_run_idx").on(table.run as any),
    index("ai_worker_leases_status_idx").on(table.status as any),
  ])
  .set("admin", {
    label: { en: "AI Worker Leases" },
    icon: { type: "icon", props: { name: "ph:handshake" } },
    hidden: true,
  });
