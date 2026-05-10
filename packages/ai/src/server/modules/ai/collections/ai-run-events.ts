import { collection } from "questpie";
import { index } from "questpie/drizzle-pg-core";

export const aiRunEventsCollection = collection("ai_run_events")
  .fields(({ f }) => ({
    run: f.relation("ai_runs").required().label({ en: "Run" }),
    type: f.text().required().label({ en: "Type" }),
    level: f
      .select([
        { value: "debug", label: { en: "Debug" } },
        { value: "info", label: { en: "Info" } },
        { value: "warn", label: { en: "Warn" } },
        { value: "error", label: { en: "Error" } },
      ])
      .default("info")
      .label({ en: "Level" }),
    summary: f.text().label({ en: "Summary" }),
    sequence: f.number().label({ en: "Sequence" }),
    meta: f.json().label({ en: "Meta" }),
  }))
  .indexes(({ table }) => [
    index("ai_run_events_run_idx").on(table.run as any),
    index("ai_run_events_run_sequence_idx").on(
      table.run as any,
      table.sequence as any,
    ),
  ])
  .set("admin", {
    label: { en: "AI Run Events" },
    icon: { type: "icon", props: { name: "ph:list-bullets" } },
    hidden: true,
  });
