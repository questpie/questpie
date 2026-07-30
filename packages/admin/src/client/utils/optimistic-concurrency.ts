export type OptimisticConcurrencyConfig = true;

export function optimisticUpdateInput(
	id: string,
	data: Record<string, any>,
	config?: OptimisticConcurrencyConfig,
) {
	if (!config) return { id, data };

	const nextData = { ...data };
	const expectedRevision = nextData.revision;
	delete nextData.revision;
	return { id, data: nextData, expectedRevision };
}

export function optimisticIdInput(
	id: string,
	record: Record<string, any> | undefined,
	config?: OptimisticConcurrencyConfig,
) {
	if (!config) return { id };
	return { id, expectedRevision: record?.revision };
}

export function optimisticBatchEntry(
	id: string,
	data: Record<string, any>,
	record: Record<string, any>,
	config?: OptimisticConcurrencyConfig,
) {
	if (!config) return { id, data };
	return {
		id,
		data,
		expectedRevision: record.revision,
	};
}

export function optimisticManyInput(
	ids: string[],
	records: Array<Record<string, any> | undefined>,
	config?: OptimisticConcurrencyConfig,
) {
	const where = { id: { in: ids } };
	if (!config) return { where };

	const recordsById = new Map(
		records
			.filter((record): record is Record<string, any> => !!record)
			.map((record) => [String(record.id), record]),
	);
	return {
		where,
		expectedRevisions: ids.map((id) => ({
			id,
			expectedRevision: recordsById.get(id)?.revision,
		})),
	};
}

export function optimisticActionInput(
	record: Record<string, any> | undefined,
	records: Array<Record<string, any>> | undefined,
	config?: OptimisticConcurrencyConfig,
) {
	if (!config) return {};

	return {
		...(record ? { expectedRevision: record.revision } : {}),
		...(records
			? {
					expectedRevisions: records.map((item) => ({
						id: String(item.id),
						expectedRevision: item.revision,
					})),
				}
			: {}),
	};
}

export async function runAdminBulkDelete<TResult>(options: {
	ids: string[];
	records: Array<Record<string, any> | undefined>;
	config?: OptimisticConcurrencyConfig;
	deleteById: (input: { id: string }) => Promise<TResult>;
	deleteMany: (
		input: ReturnType<typeof optimisticManyInput>,
	) => Promise<unknown>;
}): Promise<PromiseSettledResult<TResult>[] | null> {
	if (options.config) {
		await options.deleteMany(
			optimisticManyInput(options.ids, options.records, options.config),
		);
		return null;
	}

	return Promise.allSettled(
		options.ids.map((id) => options.deleteById({ id })),
	);
}
