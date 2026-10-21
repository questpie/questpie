import type { z } from "zod";

import type { AppContext } from "#questpie/server/config/app-context.js";

const CHANNEL_NAME_PATTERN = /^[A-Za-z0-9_\-=@,.;]+$/;
const CHANNEL_PARAM_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CHANNEL_MAX_LENGTH = 164;

type Simplify<T> = { [K in keyof T]: T[K] } & {};

type ExtractChannelParamsInner<TPattern extends string> =
	TPattern extends `${string}[${infer TParam}]${infer TTail}`
		? Record<TParam, string> & ExtractChannelParamsInner<TTail>
		: {};

/** Extract every in-string `[param]` placeholder from a channel wire pattern. */
export type ExtractChannelParams<TPattern extends string> = Simplify<
	ExtractChannelParamsInner<TPattern>
>;

export type ChannelEventSchemas = Record<string, z.ZodType>;
export type EphemeralChannelOptions = Readonly<{
	/** Latest value per publisher and event, batched per resolved channel. Default 100 ms. */
	coalesceMs?: number;
	/** Serialized event payload limit, default 1024 bytes, maximum 4096. */
	maxPayloadBytes?: number;
}>;

export type ChannelVisibility = "public" | "private" | "presence";

export type ChannelOperationContext<TPattern extends string> = AppContext & {
	params: ExtractChannelParams<TPattern>;
};

export type ChannelAuthorizationRule<TPattern extends string> =
	| boolean
	| ((
			context: ChannelOperationContext<TPattern>,
	  ) => boolean | Promise<boolean>);

export type ChannelAuthorization<TPattern extends string> = Readonly<{
	subscribe: ChannelAuthorizationRule<TPattern>;
	publish?: ChannelAuthorizationRule<TPattern>;
}>;

export type ChannelAuthorizationInput<TPattern extends string> =
	| ChannelAuthorization<TPattern>
	| ((
			context: ChannelOperationContext<TPattern>,
	  ) => boolean | Promise<boolean>);

export type ChannelPresenceResolver<
	TPattern extends string,
	TResult = Record<string, unknown>,
> = (context: ChannelOperationContext<TPattern>) => TResult | Promise<TResult>;

export interface ChannelDefinition<
	TPattern extends string = string,
	TEvents extends ChannelEventSchemas = ChannelEventSchemas,
	TAuthorization extends ChannelAuthorization<TPattern> | undefined =
		| ChannelAuthorization<TPattern>
		| undefined,
	TPresence extends
		| ChannelPresenceResolver<TPattern, Record<string, unknown>>
		| undefined =
		| ChannelPresenceResolver<TPattern, Record<string, unknown>>
		| undefined,
	TVisibility extends ChannelVisibility = ChannelVisibility,
> {
	readonly __brand: "channel";
	readonly pattern: TPattern;
	readonly eventSchemas: Readonly<TEvents>;
	readonly authorization: TAuthorization;
	readonly presenceResolver: TPresence;
	readonly visibility: TVisibility;
	readonly ephemeralOptions?: EphemeralChannelOptions;
}

export type AnyChannelDefinition = ChannelDefinition<any, any, any, any, any>;
export type ChannelDefinitions = Record<string, AnyChannelDefinition>;

export type ChannelParamsOf<TDefinition> =
	TDefinition extends ChannelDefinition<infer TPattern, any, any, any, any>
		? ExtractChannelParams<TPattern>
		: never;

export type ChannelEventsOf<TDefinition> =
	TDefinition extends ChannelDefinition<any, infer TEvents, any, any, any>
		? TEvents
		: never;

export type ChannelPresenceOf<TDefinition> =
	TDefinition extends ChannelDefinition<any, any, any, infer TPresence, any>
		? TPresence extends (...args: infer _TArgs) => infer TResult
			? Awaited<TResult>
			: never
		: never;

function visibilityPrefix(visibility: ChannelVisibility): string {
	if (visibility === "private") return "private-";
	if (visibility === "presence") return "presence-";
	return "";
}

/** Validate the stable, unresolved application wire pattern. */
export function validateChannelWirePattern(pattern: string): void {
	if (!pattern) throw new Error("Channel wire pattern cannot be empty");

	let literal = "";
	let cursor = 0;
	const params = new Set<string>();
	const matcher = /\[([^\]]*)\]/g;
	for (
		let match = matcher.exec(pattern);
		match;
		match = matcher.exec(pattern)
	) {
		literal += pattern.slice(cursor, match.index);
		const param = match[1] ?? "";
		if (!CHANNEL_PARAM_PATTERN.test(param)) {
			throw new Error(`Invalid channel wire pattern parameter "${param}"`);
		}
		if (params.has(param)) {
			throw new Error(`Duplicate channel wire pattern parameter "${param}"`);
		}
		params.add(param);
		cursor = match.index + match[0].length;
	}
	literal += pattern.slice(cursor);

	if (literal.includes("[") || literal.includes("]")) {
		throw new Error("Invalid channel wire pattern brackets");
	}
	if (literal && !CHANNEL_NAME_PATTERN.test(literal)) {
		throw new Error(
			"Channel wire pattern literals must use the transport-safe alphabet",
		);
	}

	const shortestResolved = pattern.replace(/\[[^\]]+\]/g, "x");
	if (shortestResolved.length > CHANNEL_MAX_LENGTH) {
		throw new Error(
			`Channel wire pattern cannot resolve within ${CHANNEL_MAX_LENGTH} characters`,
		);
	}
}

export function resolveChannelName<TDefinition extends AnyChannelDefinition>(
	definition: TDefinition,
	params: ChannelParamsOf<TDefinition>,
): string {
	validateChannelWirePattern(definition.pattern);
	const expected = [...definition.pattern.matchAll(/\[([^\]]+)\]/g)].map(
		(match) => match[1] as string,
	);
	const supplied = Object.keys((params ?? {}) as Record<string, unknown>);
	if (
		expected.length !== supplied.length ||
		expected.some((param) => !supplied.includes(param))
	) {
		throw new Error("Channel params do not match the wire pattern");
	}

	const applicationName = definition.pattern.replace(
		/\[([^\]]+)\]/g,
		(_placeholder: string, param: string) => {
			const value = (params as Record<string, unknown>)[param];
			if (
				typeof value !== "string" ||
				value.length === 0 ||
				!CHANNEL_NAME_PATTERN.test(value)
			) {
				throw new Error(
					`Channel param "${param}" must use the transport-safe alphabet`,
				);
			}
			return value;
		},
	);
	const resolved = `${visibilityPrefix(definition.visibility)}${applicationName}`;
	if (
		resolved.length === 0 ||
		resolved.length > CHANNEL_MAX_LENGTH ||
		!CHANNEL_NAME_PATTERN.test(resolved)
	) {
		throw new Error(
			`Resolved channel name must be transport-safe and at most ${CHANNEL_MAX_LENGTH} characters`,
		);
	}
	return resolved;
}

type NoAuthorization = undefined;
type NoPresence = undefined;

/** Experimental immutable builder for typed application channels. */
export class ChannelBuilder<
	TPattern extends string,
	TEvents extends ChannelEventSchemas = {},
	TAuthorization extends ChannelAuthorization<TPattern> | undefined =
		NoAuthorization,
	TPresence extends
		| ChannelPresenceResolver<TPattern, Record<string, unknown>>
		| undefined = NoPresence,
	TVisibility extends ChannelVisibility = "public",
> implements ChannelDefinition<
	TPattern,
	TEvents,
	TAuthorization,
	TPresence,
	TVisibility
> {
	readonly __brand = "channel" as const;
	readonly pattern: TPattern;
	readonly eventSchemas: Readonly<TEvents>;
	readonly authorization: TAuthorization;
	readonly presenceResolver: TPresence;
	readonly visibility: TVisibility;
	readonly ephemeralOptions?: EphemeralChannelOptions;

	constructor(state: {
		pattern: TPattern;
		eventSchemas?: TEvents;
		authorization?: TAuthorization;
		presenceResolver?: TPresence;
		visibility?: TVisibility;
		ephemeralOptions?: EphemeralChannelOptions;
	}) {
		validateChannelWirePattern(state.pattern);
		this.pattern = state.pattern;
		this.eventSchemas = Object.freeze({
			...(state.eventSchemas ?? {}),
		}) as TEvents;
		this.authorization = state.authorization as TAuthorization;
		this.presenceResolver = state.presenceResolver as TPresence;
		this.visibility = (state.visibility ?? "public") as TVisibility;
		this.ephemeralOptions = state.ephemeralOptions;
		const shortest = resolveChannelName(
			this as AnyChannelDefinition,
			Object.fromEntries(
				[...state.pattern.matchAll(/\[([^\]]+)\]/g)].map((match) => [
					match[1],
					"x",
				]),
			) as ChannelParamsOf<AnyChannelDefinition>,
		);
		void shortest;
		Object.freeze(this);
	}

	/** Lossy, memory-only events and presence over the shared SSE connection. */
	ephemeral(
		options: EphemeralChannelOptions = {},
	): ChannelBuilder<TPattern, TEvents, TAuthorization, TPresence, TVisibility> {
		const coalesceMs = options.coalesceMs ?? 100;
		const maxPayloadBytes = options.maxPayloadBytes ?? 1024;
		if (!Number.isInteger(coalesceMs) || coalesceMs < 10 || coalesceMs > 1000) {
			throw new Error(
				"Ephemeral coalesceMs must be an integer between 10 and 1000",
			);
		}
		if (
			!Number.isInteger(maxPayloadBytes) ||
			maxPayloadBytes < 1 ||
			maxPayloadBytes > 4096
		) {
			throw new Error(
				"Ephemeral maxPayloadBytes must be an integer between 1 and 4096",
			);
		}
		return new ChannelBuilder({
			pattern: this.pattern,
			eventSchemas: this.eventSchemas as TEvents,
			authorization: this.authorization,
			presenceResolver: this.presenceResolver,
			visibility: this.visibility,
			ephemeralOptions: Object.freeze({ coalesceMs, maxPayloadBytes }),
		});
	}

	events<const TNextEvents extends ChannelEventSchemas>(
		events: TNextEvents,
	): ChannelBuilder<
		TPattern,
		TNextEvents,
		TAuthorization,
		TPresence,
		TVisibility
	> {
		return new ChannelBuilder({
			pattern: this.pattern,
			eventSchemas: events,
			authorization: this.authorization,
			presenceResolver: this.presenceResolver,
			visibility: this.visibility,
			ephemeralOptions: this.ephemeralOptions,
		});
	}

	authorize(
		authorization: ChannelAuthorizationInput<TPattern>,
	): ChannelBuilder<
		TPattern,
		TEvents,
		ChannelAuthorization<TPattern>,
		TPresence,
		TVisibility extends "presence" ? "presence" : "private"
	> {
		const normalized = Object.freeze(
			typeof authorization === "function"
				? { subscribe: authorization }
				: { ...authorization },
		) as ChannelAuthorization<TPattern>;
		return new ChannelBuilder({
			pattern: this.pattern,
			eventSchemas: this.eventSchemas as TEvents,
			authorization: normalized,
			presenceResolver: this.presenceResolver,
			ephemeralOptions: this.ephemeralOptions,
			visibility: (this.visibility === "presence"
				? "presence"
				: "private") as TVisibility extends "presence" ? "presence" : "private",
		});
	}

	presence<TResult extends Record<string, unknown>>(
		this: ChannelBuilder<
			TPattern,
			TEvents,
			ChannelAuthorization<TPattern>,
			TPresence,
			TVisibility
		>,
		resolver: ChannelPresenceResolver<TPattern, TResult>,
	): ChannelBuilder<
		TPattern,
		TEvents,
		ChannelAuthorization<TPattern>,
		ChannelPresenceResolver<TPattern, TResult>,
		"presence"
	> {
		return new ChannelBuilder({
			pattern: this.pattern,
			eventSchemas: this.eventSchemas as TEvents,
			authorization: this.authorization,
			presenceResolver: resolver,
			visibility: "presence",
			ephemeralOptions: this.ephemeralOptions,
		});
	}
}

export function channel<const TPattern extends string>(
	pattern: TPattern,
): ChannelBuilder<TPattern> {
	return new ChannelBuilder({ pattern });
}
