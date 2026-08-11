/**
 * Regression: generated user route outputs must stay exact when the app also
 * consumes package modules whose route records are merged and overridden.
 */

import type { ModuleDefinition } from "questpie/types";
import { z } from "zod";

import type { CodegenResolvedModulePropArr } from "#questpie/server/config/codegen-type-utils.js";
import { route } from "#questpie/server/routes/define-route.js";
import type {
	InferRouteOutput,
	RouteParamsFromKey,
	RouteWithParams,
} from "#questpie/server/routes/types.js";
import type { Override } from "#questpie/shared/type-utils.js";

import type { Equal, Expect, IsUnknown, Not } from "./type-test-utils.js";

// Keep this fixture small. Importing each package's full generated module type
// here measures those large package graphs as test cost instead of exercising
// the generic regression. The literal names preserve the production ordering
// while the final value preserves the public ModuleDefinition[] boundary.
const starterModule = { name: "questpie-starter" } as const;
const openApiModule = { name: "questpie-openapi" } as const;
const workflowsModule = { name: "questpie-workflows" } as const;
const mcpModule = { name: "questpie-mcp" } as const;
const publicModules: readonly ModuleDefinition[] = [{ name: "public-module" }];
const publicModule = publicModules[0]!;
const modules = [
	starterModule,
	openApiModule,
	workflowsModule,
	mcpModule,
	publicModule,
] as const;

const userRoute = route()
	.post()
	.schema(z.object({}))
	.handler(() => ({ connectionId: "connection-1", enabled: true }));

type RouteDefinitionWithoutHandler<T> = T extends { mode: "raw" }
	? Omit<T, "handler"> & {
			handler: (args: unknown) => Response | Promise<Response>;
		}
	: Omit<T, "handler"> & {
			handler: (args: unknown) => unknown | Promise<unknown>;
		};

type ModuleRoutes = CodegenResolvedModulePropArr<typeof modules, "routes">;
type AppRoutes = Override<
	ModuleRoutes,
	{
		"account/externalAiConnection": RouteWithParams<
			RouteDefinitionWithoutHandler<typeof userRoute>,
			RouteParamsFromKey<"account/externalAiConnection">
		>;
	}
>;

type UserRouteOutput = InferRouteOutput<
	AppRoutes["account/externalAiConnection"]
>;

type _userRouteOutputIsExact = Expect<
	Equal<UserRouteOutput, { connectionId: string; enabled: boolean }>
>;
type _userRouteOutputIsNotUnknown = Expect<Not<IsUnknown<UserRouteOutput>>>;
