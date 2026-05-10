import { collection } from "questpie";
import { index } from "questpie/drizzle-pg-core";

export const aiSessionsCollection = collection("ai_sessions")
  .fields(({ f }) => ({
    title: f.text().label({ en: "Title" }),
    status: f
      .select([
        { value: "active", label: { en: "Active" } },
        { value: "closed", label: { en: "Closed" } },
        { value: "archived", label: { en: "Archived" } },
      ])
      .default("active")
      .label({ en: "Status" }),
    scopeType: f
      .select([
        { value: "global", label: { en: "Global" } },
        { value: "project", label: { en: "Project" } },
      ])
      .default("global")
      .label({ en: "Scope Type" }),
    projectId: f.text().label({ en: "Project ID" }),
    runtimeSessionRef: f.text().label({ en: "Runtime Session Ref" }),
    metadata: f.json().label({ en: "Metadata" }),
  }))
  .title(({ f }) => f.title)
  .indexes(({ table }) => [
    index("ai_sessions_status_idx").on(table.status as any),
    index("ai_sessions_project_idx").on(table.projectId as any),
  ])
  .set("admin", {
    label: { en: "AI Sessions" },
    icon: { type: "icon", props: { name: "ph:chat-circle" } },
  })
  .set("adminList", {
    view: "collection-table",
    showSearch: true,
    showFilters: true,
    showToolbar: true,
  });
