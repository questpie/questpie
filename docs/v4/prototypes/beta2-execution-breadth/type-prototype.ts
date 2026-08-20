// PROTOTYPE — compile-only candidate for Action and checkpointed Job authoring.

type Awaitable<Value> = Value | Promise<Value>;

type Codec<Value> = Readonly<{
	readonly parse: (input: unknown) => Value;
}>;

type ValueOf<Input extends Codec<unknown>> =
	Input extends Codec<infer Value> ? Value : never;

type Principal = Readonly<{
	kind: "anonymous" | "user" | "service";
	id?: string;
}>;
type Authority = Readonly<{ isSystem(): false }>;

type ExecutionFacts = Readonly<{
	principal: Principal;
	authority: Authority;
	tenant: Readonly<{ id: string }> | null;
	values: Readonly<Record<string, unknown>>;
	signal: AbortSignal;
	deadline: number | null;
}>;

type QueryCaller<Input, Output> = (input: Input) => Promise<Output>;
type MutationCaller<Input, Output> = (input: Input) => Promise<Output>;
type ActionCaller<Input, Output> = (input: Input) => Promise<Output>;

type Policy = Readonly<{ kind: "authenticated" }>;
type DeclaredError = Readonly<{ code: string; status: number }>;
type ErrorThrowers<Errors extends Readonly<Record<string, DeclaredError>>> =
	Readonly<{
		[Name in keyof Errors]: () => Error;
	}>;

type AppQueries = Readonly<{
	article: Readonly<{
		byId: QueryCaller<
			Readonly<{ articleId: string }>,
			Readonly<{ title: string }> | null
		>;
	}>;
}>;

type AppMutations = Readonly<{
	article: Readonly<{
		requestReview: MutationCaller<
			Readonly<{ articleId: string }>,
			Readonly<{ requested: true }>
		>;
	}>;
}>;

type AppActions = Readonly<{
	article: Readonly<{
		publish: ActionCaller<
			Readonly<{ articleId: string; approvedBy: string; effectKey: string }>,
			Readonly<{ providerId: string }>
		>;
	}>;
}>;

type ActionServices = Readonly<{
	publisher: Readonly<{
		publish(
			input: Readonly<{ articleId: string; effectKey: string }>,
			signal: AbortSignal,
		): Promise<string>;
	}>;
}>;

type ActionContext = ExecutionFacts &
	Readonly<{
		services: ActionServices;
		queries: AppQueries;
		mutations: AppMutations;
	}>;

type ActionDefinition<
	Name extends string,
	Input,
	Output,
	Errors extends Readonly<Record<string, DeclaredError>>,
> = Readonly<{
	kind: "action";
	name: Name;
	input: Codec<Input>;
	output?: Codec<Output>;
	policy: Policy;
	errors: Errors;
	network: boolean;
	handler(
		input: Readonly<{
			input: Input;
			ctx: ActionContext;
			errors: ErrorThrowers<Errors>;
		}>,
	): Awaitable<Output>;
}>;

declare function defineAction<
	const Name extends string,
	Input,
	Output,
	const Errors extends Readonly<Record<string, DeclaredError>>,
>(
	definition: Readonly<{
		name: Name;
		input: Codec<Input>;
		output?: Codec<Output>;
		policy: Policy;
		errors: Errors;
		network?: boolean;
		handler(
			input: Readonly<{
				input: Input;
				ctx: ActionContext;
				errors: ErrorThrowers<Errors>;
			}>,
		): Awaitable<Output>;
	}>,
): ActionDefinition<Name, Input, Output, Errors>;

type StepName = string & { readonly __stepName?: never };

type JobSteps<Signals extends Readonly<Record<string, Codec<unknown>>>> =
	Readonly<{
		mutation<Input, Output>(
			name: StepName,
			mutation: MutationCaller<Input, Output>,
			input: Input,
		): Promise<Output>;
		action<Input, Output>(
			name: StepName,
			action: ActionCaller<Input, Output>,
			input: Input,
		): Promise<Output>;
		sleep(
			name: StepName,
			duration: `${number}${"ms" | "s" | "m" | "h" | "d"}`,
		): Promise<void>;
		waitForSignal<const SignalName extends keyof Signals & string>(
			name: StepName,
			options: Readonly<{
				signal: SignalName;
				timeout?: `${number}${"s" | "m" | "h" | "d"}`;
			}>,
		): Promise<ValueOf<Signals[SignalName]>>;
	}>;

type JobRun<Signals extends Readonly<Record<string, Codec<unknown>>>> =
	Readonly<{
		effect(name: string): string;
		scheduledFor: Date | null;
		step: JobSteps<Signals>;
	}>;

type JobAttempt = Readonly<{
	heartbeat(progress: Readonly<Record<string, unknown>>): Promise<void>;
}>;

type JobContext<Signals extends Readonly<Record<string, Codec<unknown>>>> =
	ExecutionFacts &
		Readonly<{
			queries: AppQueries;
			mutations: AppMutations;
			actions: AppActions;
		}>;

type JobDefinition<
	Name extends string,
	Input,
	Output,
	Signals extends Readonly<Record<string, Codec<unknown>>>,
> = Readonly<{
	kind: "job";
	name: Name;
	version: number;
	input: Codec<Input>;
	output?: Codec<Output>;
	signals: Signals;
	schedule?: Readonly<{
		cron: string;
		timeZone: string;
	}>;
	handler(
		input: Readonly<{
			input: Input;
			ctx: JobContext<Signals>;
			run: JobRun<Signals>;
			attempt: JobAttempt;
		}>,
	): Awaitable<Output>;
}>;

declare function defineJob<
	const Name extends string,
	Input,
	Output,
	const Signals extends Readonly<Record<string, Codec<unknown>>> = Readonly<
		Record<never, never>
	>,
>(
	definition: Readonly<{
		name: Name;
		version: number;
		input: Codec<Input>;
		output?: Codec<Output>;
		signals?: Signals;
		schedule?: Readonly<{
			cron: string;
			timeZone: string;
		}>;
		handler(
			input: Readonly<{
				input: Input;
				ctx: JobContext<Signals>;
				run: JobRun<Signals>;
				attempt: JobAttempt;
			}>,
		): Awaitable<Output>;
	}>,
): JobDefinition<Name, Input, Output, Signals>;

declare const articleInput: Codec<Readonly<{ articleId: string }>>;
declare const publishedOutput: Codec<Readonly<{ providerId: string }>>;
declare const approvalSignal: Codec<Readonly<{ approvedBy: string }>>;

export const publishArticle = defineAction({
	name: "article.publish",
	input: articleInput,
	output: publishedOutput,
	policy: { kind: "authenticated" },
	errors: {
		outcomeUnknown: { code: "PUBLISH_OUTCOME_UNKNOWN", status: 502 },
	},
	network: true,
	async handler({ input, ctx }) {
		const providerId = await ctx.services.publisher.publish(
			{ articleId: input.articleId, effectKey: `manual:${input.articleId}` },
			ctx.signal,
		);
		await ctx.mutations.article.requestReview({ articleId: input.articleId });

		// @ts-expect-error Action owns no transaction/data facade.
		ctx.data;
		// @ts-expect-error Action owns no durable checkpoint/lease control.
		ctx.run;

		return { providerId };
	},
});

export const refreshSearch = defineJob({
	name: "search.refresh",
	version: 1,
	input: articleInput,
	async handler({ input, ctx, run, attempt }) {
		const article = await ctx.queries.article.byId({
			articleId: input.articleId,
		});
		await attempt.heartbeat({ completed: "query" });

		// A simple Job uses no checkpoint and creates no step history.
		// @ts-expect-error No signal name exists when the Job declares no signals.
		await run.step.waitForSignal("approval-gate", { signal: "approval" });

		return { providerId: article?.title ?? "missing" };
	},
});

export const scheduledPublication = defineJob({
	name: "article.scheduledPublication",
	version: 3,
	input: articleInput,
	output: publishedOutput,
	signals: { approval: approvalSignal },
	schedule: { cron: "0 9 * * *", timeZone: "UTC" },
	async handler({ input, ctx, run }) {
		await run.step.mutation(
			"request-review",
			ctx.mutations.article.requestReview,
			{ articleId: input.articleId },
		);
		const approval = await run.step.waitForSignal("approval-gate", {
			signal: "approval",
			timeout: "30d",
		});
		return run.step.action("publish", ctx.actions.article.publish, {
			articleId: input.articleId,
			approvedBy: approval.approvedBy,
			effectKey: run.effect("publish"),
		});
	},
});

defineJob({
	name: "article.invalidSignal",
	version: 1,
	input: articleInput,
	output: publishedOutput,
	signals: { approval: approvalSignal },
	async handler({ run }) {
		// @ts-expect-error Signal names are closed by the Job Definition.
		await run.step.waitForSignal("rejection-gate", { signal: "rejection" });
		return { providerId: "never" };
	},
});

// There is deliberately no defineWorkflow factory in this candidate surface.
