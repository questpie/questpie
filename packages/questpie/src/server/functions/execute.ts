import { extractAppServices } from "#questpie/server/config/app-context.js";
import {
	type RequestContext,
	runWithContext,
} from "#questpie/server/config/context.js";
import type { Questpie } from "#questpie/server/config/questpie.js";
import type {
	InferFunctionInput,
	InferFunctionOutput,
	JsonFunctionDefinition,
} from "#questpie/server/functions/types.js";

/**
 * Execute a server function with full context propagation.
 *
 * ## Context propagation inside function handlers
 *
 * The handler runs inside `runWithContext()` so that all nested CRUD calls
 * (e.g. `app.api.collections.posts.find()`) automatically inherit:
 * - `locale`  — from the incoming request (HTTP header / explicit param)
 * - `session` — from the incoming request (auth cookie / explicit param)
 * - `stage`   — from the request context
 * - `accessMode: "system"` — functions execute as server code by default
 *
 * ### accessMode inside a handler
 *
 * The handler body runs with `accessMode: "system"` — this means access rules
 * are bypassed unless you opt-in explicitly:
 *
 * ```typescript
 * // Inside a function handler:
 *
 * // ✅ bypasses access rules (system level — default)
 * const posts = await app.api.collections.posts.find();
 *
 * // ✅ enforces access rules AND auto-inherits session from request
 * const posts = await app.api.collections.posts.find({ accessMode: "user" });
 * // session is inherited automatically from the ALS scope — no threading needed
 * ```
 *
 * ### Why runWithContext is needed
 *
 * Without it, every nested `normalizeContext()` call would fall back to its
 * own defaults (losing locale, session). By wrapping the handler, the ALS
 * scope is set once and all descendants inherit from it automatically.
 */
export async function executeJsonFunction<
	TInput,
	TOutput,
	TFunctions extends JsonFunctionDefinition<TInput, TOutput>,
>(
	app: Questpie<any>,
	definition: TFunctions,
	input: InferFunctionInput<TFunctions>,
	context?: RequestContext,
): Promise<InferFunctionOutput<TFunctions>> {
	const parsed = definition.schema.parse(input);
	const resolvedContext =
		context ?? (await app.createContext({ accessMode: "system" }));

	const services = extractAppServices(app, {
		db: resolvedContext.db ?? app.db,
		session: resolvedContext.session,
	});

	// Wrap handler in runWithContext so all nested CRUD calls (collections,
	// globals, etc.) automatically inherit locale, session, and stage from
	// the incoming request. accessMode is "system" — function body is server
	// code; callers can override per-call if they need user-level access.
	const result = await runWithContext(
		{
			app,
			session: resolvedContext.session,
			db: resolvedContext.db ?? app.db,
			locale: resolvedContext.locale,
			accessMode: "system",
			stage: resolvedContext.stage,
		},
		() =>
			definition.handler({
				...services,
				input: parsed as TInput,
				locale: resolvedContext.locale,
			} as any),
	);

	if (definition.outputSchema) {
		return definition.outputSchema.parse(
			result,
		) as InferFunctionOutput<TFunctions>;
	}
	return result as InferFunctionOutput<TFunctions>;
}
