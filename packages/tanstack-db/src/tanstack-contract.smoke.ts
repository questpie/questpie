import { createCollection, type Collection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { QueryClient } from "@tanstack/react-query";

type ContractRow = {
	id: string;
	title: string;
};

const queryClient = new QueryClient();
const collection = createCollection(
	queryCollectionOptions({
		queryClient,
		queryKey: ["questpie", "contract-smoke"] as const,
		queryFn: async (): Promise<ContractRow[]> => [],
		getKey: (row) => row.id,
		onInsert: async ({ transaction }) => {
			const mutation = transaction.mutations[0];
			const row: ContractRow = mutation.modified;
			void row;
		},
		onUpdate: async ({ transaction }) => {
			const mutation = transaction.mutations[0];
			const key: string = mutation.key;
			const changes: Partial<ContractRow> = mutation.changes;
			void key;
			void changes;
		},
		onDelete: async ({ transaction }) => {
			const key: string = transaction.mutations[0].key;
			void key;
		},
	}),
);

const typedCollection: Collection<ContractRow, string> = collection;
void typedCollection;
