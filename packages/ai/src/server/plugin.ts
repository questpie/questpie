import type { CodegenPlugin } from "questpie/codegen";

export function aiPlugin(): CodegenPlugin {
  return {
    name: "questpie-ai",
    targets: {
      server: {
        root: ".",
        outputFile: "index.ts",
        discover: {
          aiConfig: { pattern: "config/ai.ts", configKey: "ai" },
        },
        registries: {
          singletonFactories: {
            aiConfig: {
              configType: "AiModuleConfig",
              imports: [
                {
                  name: "AiModuleConfig",
                  from: "@questpie/ai",
                },
              ],
              isCallback: true,
            },
          },
        },
      },
    },
  };
}
