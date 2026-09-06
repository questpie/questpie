import type { DataQueryPage } from "../relational";
import {
	executeCollectionStatement,
	type CollectionExecutionBudget,
} from "./collection-budget";
import type { LinkedCollectionMutationProgramsV1 } from "./program";

type CollectionData = Readonly<
	Record<
		string,
		Readonly<Record<string, (request: unknown) => Promise<unknown>>>
	>
>;
export type CollectionListResult = DataQueryPage &
	Readonly<{ observed: number }>;

/** One bounded list access shared by named Mutations and compiled lifecycle. */
export function createCollectionListAccess(
	input: Readonly<{
		operations?: LinkedCollectionMutationProgramsV1;
		execute?(identity: string, request: unknown): Promise<CollectionListResult>;
		budget: CollectionExecutionBudget;
		consumeRows(count: number): void;
	}>,
) {
	const execute = async (
		identity: string,
		request: unknown,
		started: number,
	): Promise<DataQueryPage> => {
		if (!input.execute)
			throw new TypeError("Collection list capability is unavailable");
		const result = await executeCollectionStatement({
			budget: input.budget,
			started,
			durationMilliseconds: 5_000,
			use: () => input.execute!(identity, request),
		});
		input.consumeRows(result.observed);
		return Object.freeze({ nodes: result.nodes, pageInfo: result.pageInfo });
	};
	return Object.freeze({
		lifecycle: input.execute
			? async (identity: string, request: unknown, started: number) =>
					(await execute(identity, request, started)).nodes
			: undefined,
		bind(data: CollectionData): CollectionData {
			if (!input.execute || !input.operations) return data;
			const entries = new Map(Object.entries(data));
			for (const [target, operations] of input.operations.byTarget) {
				const list = operations.get("list");
				if (!list) continue;
				const name = target.slice("collection:".length);
				entries.set(
					name,
					Object.freeze({
						...entries.get(name),
						list: (request: unknown) =>
							execute(list.identity, request, performance.now()),
					}),
				);
			}
			return Object.freeze(Object.fromEntries(entries));
		},
	});
}
