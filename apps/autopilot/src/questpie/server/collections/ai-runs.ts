import { aiModule } from "@questpie/ai/modules/ai";
import { collection } from "#questpie/factories";

export default collection("ai_runs").merge(aiModule.collections.ai_runs);
