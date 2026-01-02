import type { z } from "zod";
import type { RequestContext } from "#questpie/cms/server/config/context";

export type FunctionType = "query" | "mutation";

export type JsonFunctionDefinition<TInput = any, TOutput = any> = {
	mode?: "json";
	type?: FunctionType;
	schema: z.ZodSchema<TInput>;
	outputSchema?: z.ZodSchema<TOutput>;
	handler: (input: TInput) => TOutput | Promise<TOutput>;
};

export type RawFunctionDefinition = {
	mode: "raw";
	type?: FunctionType;
	handler: (params: {
		request: Request;
		context: RequestContext;
	}) => Response | Promise<Response>;
};

export type FunctionDefinition<TInput = any, TOutput = any> =
	| JsonFunctionDefinition<TInput, TOutput>
	| RawFunctionDefinition;

export type FunctionsMap = Record<string, FunctionDefinition>;
export type JsonFunctionsMap = Record<string, JsonFunctionDefinition<any, any>>;

export type InferFunctionInput<T> = T extends {
	schema: z.ZodSchema<infer Input>;
}
	? Input
	: never;

export type InferFunctionOutput<T> = T extends {
	outputSchema: z.ZodSchema<infer Output>;
}
	? Output
	: T extends { handler: (...args: any) => infer Result }
		? Awaited<Result>
		: never;

export type ExtractJsonFunctions<T extends FunctionsMap> = {
	[K in keyof T as T[K] extends JsonFunctionDefinition<any, any>
		? K
		: never]: T[K];
};
