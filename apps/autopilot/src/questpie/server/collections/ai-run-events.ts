import { aiModule } from "@questpie/ai/modules/ai";
import { collection } from "#questpie/factories";

export default collection("ai_run_events").merge(aiModule.collections.ai_run_events);
