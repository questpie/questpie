import type { output as ZodOutput, ZodType } from "zod";

import type { AppContext } from "#questpie/server/config/app-context.js";

export type CrdtOwnerEditContext<TRow = any> = AppContext & {
	/** The loaded owner record whose collaborative aggregate will be edited. */
	data: TRow;
	/** Incoming HTTP request when authorization runs through an HTTP adapter. */
	request?: Request;
};

export type CrdtOwnerEditRule<TRow = any> =
	| boolean
	| ((context: CrdtOwnerEditContext<TRow>) => boolean | Promise<boolean>);

export type CrdtOwnerAccess<TRow = any> = Readonly<{
	edit: CrdtOwnerEditRule<TRow>;
	fields?: Partial<
		Record<
			Extract<keyof TRow, string>,
			Readonly<{ edit: CrdtOwnerEditRule<TRow> }>
		>
	>;
}>;

export type CrdtOwnerConfig<
	TAwarenessSchema extends ZodType | undefined = undefined,
	TRow = any,
> = (TAwarenessSchema extends ZodType
	? { awareness: TAwarenessSchema }
	: { awareness?: undefined }) & {
	/**
	 * Explicit aggregate edit policy for CRDT operations. This policy receives
	 * the current owner record but no proposed value: CRDT changes are appended
	 * after the session grant is issued and cannot safely reuse a CRUD patch
	 * policy. When `access` is omitted, the legacy CRUD update and field-update
	 * policies remain in effect.
	 */
	access?: CrdtOwnerAccess<TRow>;
};

export type CrdtOwnerCapability<
	TAwarenessSchema extends ZodType | undefined = undefined,
> = Readonly<{
	awarenessSchema: TAwarenessSchema;
	/** Explicit CRDT aggregate edit policy, independent of ordinary CRUD update. */
	editAccess?: CrdtOwnerEditRule;
	/** Optional CRDT field edit policies, independent of ordinary field update. */
	fieldEditAccess?: Readonly<Record<string, CrdtOwnerEditRule>>;
	/** Type-only carrier used by generated aggregate APIs. */
	awareness: TAwarenessSchema extends ZodType
		? ZodOutput<TAwarenessSchema>
		: never;
}>;

export type CrdtAwarenessOfOwner<TEntity> = TEntity extends {
	state: { collaborative: { awareness: infer TAwareness } };
}
	? TAwareness
	: never;
