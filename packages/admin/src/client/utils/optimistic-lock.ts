export interface OptimisticLockConfig {
	field: string;
	required: true;
}

export function optimisticUpdateInput(
	id: string,
	data: Record<string, any>,
	config?: OptimisticLockConfig,
) {
	if (!config) return { id, data };

	const nextData = { ...data };
	const expectedVersion = nextData[config.field];
	delete nextData[config.field];
	return { id, data: nextData, expectedVersion };
}

export function optimisticIdInput(
	id: string,
	record: Record<string, any> | undefined,
	config?: OptimisticLockConfig,
) {
	if (!config) return { id };
	return { id, expectedVersion: record?.[config.field] };
}

export function optimisticBatchEntry(
	id: string,
	data: Record<string, any>,
	record: Record<string, any>,
	config?: OptimisticLockConfig,
) {
	if (!config) return { id, data };
	return {
		id,
		data,
		expectedVersion: record[config.field],
	};
}

export function optimisticManyInput(
	ids: string[],
	records: Array<Record<string, any> | undefined>,
	config?: OptimisticLockConfig,
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
		expectedVersions: ids.map((id) => ({
			id,
			expectedVersion: recordsById.get(id)?.[config.field],
		})),
	};
}

export function optimisticActionInput(
	record: Record<string, any> | undefined,
	records: Array<Record<string, any>> | undefined,
	config?: OptimisticLockConfig,
) {
	if (!config) return {};

	return {
		...(record ? { expectedVersion: record[config.field] } : {}),
		...(records
			? {
					expectedVersions: records.map((item) => ({
						id: String(item.id),
						expectedVersion: item[config.field],
					})),
				}
			: {}),
	};
}

export async function runAdminBulkDelete<TResult>(options: {
	ids: string[];
	records: Array<Record<string, any> | undefined>;
	config?: OptimisticLockConfig;
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
