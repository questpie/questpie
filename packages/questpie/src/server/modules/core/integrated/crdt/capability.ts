import type { output as ZodOutput, ZodType } from "zod";

export type CrdtOwnerConfig<
	TAwarenessSchema extends ZodType | undefined = undefined,
> = TAwarenessSchema extends ZodType
	? { awareness: TAwarenessSchema }
	: { awareness?: undefined };

export type CrdtOwnerCapability<
	TAwarenessSchema extends ZodType | undefined = undefined,
> = Readonly<{
	awarenessSchema: TAwarenessSchema;
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
