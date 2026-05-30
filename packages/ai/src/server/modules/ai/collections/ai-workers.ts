import { collection } from "questpie";
import { index, uniqueIndex } from "questpie/drizzle-pg-core";

export const aiWorkersCollection = collection("ai_workers")
  .fields(({ f }) => ({
    deviceId: f.text().required().label({ en: "Device ID" }),
    name: f.text().required().label({ en: "Name" }),
    volumeId: f.text().label({ en: "Volume ID" }),
    status: f
      .select([
        { value: "online", label: { en: "Online" } },
        { value: "offline", label: { en: "Offline" } },
        { value: "busy", label: { en: "Busy" } },
        { value: "draining", label: { en: "Draining" } },
      ])
      .default("offline")
      .label({ en: "Status" }),
    capabilities: f.json().label({ en: "Capabilities" }),
    lastHeartbeat: f.datetime().label({ en: "Last Heartbeat" }),
    secretHash: f.text().outputFalse().label({ en: "Secret Hash" }),
    metadata: f.json().label({ en: "Metadata" }),
  }))
  .title(({ f }) => f.name)
  .indexes(({ table }) => [
    uniqueIndex("ai_workers_device_id_unique").on(table.deviceId as any),
    index("ai_workers_status_idx").on(table.status as any),
  ])
  .set("admin", {
    label: { en: "AI Workers" },
    icon: { type: "icon", props: { name: "ph:desktop-tower" } },
    hidden: true,
    audit: false,
  })
  .set("adminList", {
    view: "collection-table",
    showSearch: true,
    showFilters: true,
    showToolbar: true,
  });
