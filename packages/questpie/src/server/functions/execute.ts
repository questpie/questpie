import type { Questpie } from "#questpie/server/config/questpie.js";
import type { RequestContext } from "#questpie/server/config/context.js";
import type {
  JsonFunctionDefinition,
  InferFunctionOutput,
  InferFunctionInput,
} from "#questpie/server/functions/types.js";

export async function executeJsonFunction<
  TInput,
  TOutput,
  TFunctions extends JsonFunctionDefinition<TInput, TOutput>,
>(app: Questpie<any>,
  definition: TFunctions,
  input: InferFunctionInput<TFunctions>,
  context?: RequestContext,
): Promise<InferFunctionOutput<TFunctions>> {
  const parsed = definition.schema.parse(input);
  const resolvedContext =
    context ?? (await app.createContext({ accessMode: "system" }));

  // Execute handler directly - no AsyncLocalStorage wrapper needed
  const result = await definition.handler({
    input: parsed as TInput,
    app: app as any,
    session: resolvedContext.session,
    locale: resolvedContext.locale,
    db: resolvedContext.db ?? app.db,
  });

  if (definition.outputSchema) {
    return definition.outputSchema.parse(
      result,
    ) as InferFunctionOutput<TFunctions>;
  }
  return result as InferFunctionOutput<TFunctions>;
}
