import type { QCMSClient } from "@questpie/cms/client";
import type { QCMS } from "@questpie/cms/server";

export type QueryKey = readonly unknown[];

export type QCMSQueryOptions<TData> = {
	queryKey: QueryKey;
	queryFn: () => Promise<TData>;
};

export type QCMSMutationOptions<TVariables, TData> = {
	mutationKey: QueryKey;
	mutationFn: (variables: TVariables) => Promise<TData>;
};

export type QCMSQueryErrorMap = (error: unknown) => unknown;

export type QCMSQueryOptionsConfig = {
	keyPrefix?: QueryKey;
	errorMap?: QCMSQueryErrorMap;
};

type AnyAsyncFn = (...args: any[]) => Promise<any>;
type QueryData<TFn extends AnyAsyncFn> = Awaited<ReturnType<TFn>>;
type FirstArg<TFn extends AnyAsyncFn> =
	Parameters<TFn> extends [infer TFirst, ...any[]] ? TFirst : never;
type HasArgs<TFn extends AnyAsyncFn> = Parameters<TFn> extends [] ? false : true;
type QueryBuilder<TFn extends AnyAsyncFn> = HasArgs<TFn> extends false
	? () => QCMSQueryOptions<QueryData<TFn>>
	: undefined extends FirstArg<TFn>
		? (options?: FirstArg<TFn>) => QCMSQueryOptions<QueryData<TFn>>
		: (options: FirstArg<TFn>) => QCMSQueryOptions<QueryData<TFn>>;

type CollectionKeys<T extends QCMS<any>> = Extract<
	keyof QCMSClient<T>["collections"],
	string
>;
type GlobalKeys<T extends QCMS<any>> = Extract<
	keyof QCMSClient<T>["globals"],
	string
>;

type CollectionFind<T extends QCMS<any>, K extends CollectionKeys<T>> =
	QCMSClient<T>["collections"][K]["find"];
type CollectionFindOne<
	T extends QCMS<any>,
	K extends CollectionKeys<T>,
> = QCMSClient<T>["collections"][K]["findOne"];
type CollectionCreate<
	T extends QCMS<any>,
	K extends CollectionKeys<T>,
> = QCMSClient<T>["collections"][K]["create"];
type CollectionUpdate<
	T extends QCMS<any>,
	K extends CollectionKeys<T>,
> = QCMSClient<T>["collections"][K]["update"];
type CollectionDelete<
	T extends QCMS<any>,
	K extends CollectionKeys<T>,
> = QCMSClient<T>["collections"][K]["delete"];
type CollectionRestore<
	T extends QCMS<any>,
	K extends CollectionKeys<T>,
> = QCMSClient<T>["collections"][K]["restore"];

type GlobalGet<T extends QCMS<any>, K extends GlobalKeys<T>> =
	QCMSClient<T>["globals"][K] extends { get: infer TGet }
		? TGet extends AnyAsyncFn
			? TGet
			: never
		: never;
type GlobalUpdate<T extends QCMS<any>, K extends GlobalKeys<T>> =
	QCMSClient<T>["globals"][K] extends { update: infer TUpdate }
		? TUpdate extends AnyAsyncFn
			? TUpdate
			: never
		: never;

type CollectionQueryOptionsAPI<
	T extends QCMS<any>,
	K extends CollectionKeys<T>,
> = {
	find: QueryBuilder<CollectionFind<T, K>>;
	findOne: QueryBuilder<CollectionFindOne<T, K>>;
	create: () => QCMSMutationOptions<
		FirstArg<CollectionCreate<T, K>>,
		QueryData<CollectionCreate<T, K>>
	>;
	update: () => QCMSMutationOptions<
		{
			id: Parameters<CollectionUpdate<T, K>>[0];
			data: Parameters<CollectionUpdate<T, K>>[1];
		},
		QueryData<CollectionUpdate<T, K>>
	>;
	delete: () => QCMSMutationOptions<
		{
			id: Parameters<CollectionDelete<T, K>>[0];
		},
		QueryData<CollectionDelete<T, K>>
	>;
	restore: () => QCMSMutationOptions<
		{
			id: Parameters<CollectionRestore<T, K>>[0];
		},
		QueryData<CollectionRestore<T, K>>
	>;
};

type GlobalQueryOptionsAPI<
	T extends QCMS<any>,
	K extends GlobalKeys<T>,
> = {
	get: QueryBuilder<GlobalGet<T, K>>;
	update: () => QCMSMutationOptions<
		{
			data: Parameters<GlobalUpdate<T, K>>[0];
			options?: Parameters<GlobalUpdate<T, K>>[1];
		},
		QueryData<GlobalUpdate<T, K>>
	>;
};

export type QCMSQueryOptionsProxy<T extends QCMS<any>> = {
	collections: {
		[K in CollectionKeys<T>]: CollectionQueryOptionsAPI<T, K>;
	};
	globals: {
		[K in GlobalKeys<T>]: GlobalQueryOptionsAPI<T, K>;
	};
	custom: {
		query: <TData>(config: {
			key: QueryKey;
			queryFn: () => Promise<TData>;
		}) => QCMSQueryOptions<TData>;
		mutation: <TVariables, TData>(config: {
			key: QueryKey;
			mutationFn: (variables: TVariables) => Promise<TData>;
		}) => QCMSMutationOptions<TVariables, TData>;
	};
	key: (parts: QueryKey) => QueryKey;
};

const defaultErrorMap: QCMSQueryErrorMap = (error) =>
	error instanceof Error
		? error
		: new Error(typeof error === "string" ? error : "Unknown error");

const buildKey = (prefix: QueryKey, parts: QueryKey) =>
	prefix.length ? [...prefix, ...parts] : parts;

const sanitizeKeyPart = (value: unknown): unknown => {
	if (value === null || value === undefined) return value;
	if (typeof value === "function") return undefined;
	if (Array.isArray(value)) {
		return value.map((item) => sanitizeKeyPart(item));
	}
	if (typeof value === "object") {
		const sanitized: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value)) {
			if (typeof entry === "function") continue;
			const nextValue = sanitizeKeyPart(entry);
			if (nextValue !== undefined) {
				sanitized[key] = nextValue;
			}
		}
		return sanitized;
	}
	return value;
};

const normalizeQueryKeyOptions = (options: unknown) =>
	sanitizeKeyPart(options ?? {});

const wrapQueryFn = <TData>(
	queryFn: () => Promise<TData>,
	errorMap: QCMSQueryErrorMap,
) => {
	return async () => {
		try {
			return await queryFn();
		} catch (error) {
			throw errorMap(error);
		}
	};
};

const wrapMutationFn = <TVariables, TData>(
	mutationFn: (variables: TVariables) => Promise<TData>,
	errorMap: QCMSQueryErrorMap,
) => {
	return async (variables: TVariables) => {
		try {
			return await mutationFn(variables);
		} catch (error) {
			throw errorMap(error);
		}
	};
};

export function createQueryOptions<TData>(config: {
	queryKey: QueryKey;
	queryFn: () => Promise<TData>;
	errorMap?: QCMSQueryErrorMap;
}): QCMSQueryOptions<TData> {
	const errorMap = config.errorMap ?? defaultErrorMap;
	return {
		queryKey: config.queryKey,
		queryFn: wrapQueryFn(config.queryFn, errorMap),
	};
}

export function createMutationOptions<TVariables, TData>(config: {
	mutationKey: QueryKey;
	mutationFn: (variables: TVariables) => Promise<TData>;
	errorMap?: QCMSQueryErrorMap;
}): QCMSMutationOptions<TVariables, TData> {
	const errorMap = config.errorMap ?? defaultErrorMap;
	return {
		mutationKey: config.mutationKey,
		mutationFn: wrapMutationFn(config.mutationFn, errorMap),
	};
}

export function createQCMSQueryOptions<T extends QCMS<any>>(
	client: QCMSClient<T>,
	config: QCMSQueryOptionsConfig = {},
): QCMSQueryOptionsProxy<T> {
	const keyPrefix = config.keyPrefix ?? ["qcms"];
	const errorMap = config.errorMap ?? defaultErrorMap;

	const collections = new Proxy({} as QCMSQueryOptionsProxy<T>["collections"], {
		get: (_target, collectionName) => {
			if (typeof collectionName !== "string") return undefined;
			const collection = client.collections[
				collectionName as CollectionKeys<T>
			] as any;
			const baseKey = ["collections", collectionName];

			return {
				find: (options?: any) =>
					createQueryOptions({
						queryKey: buildKey(
							keyPrefix,
							[...baseKey, "find", normalizeQueryKeyOptions(options)],
						),
						queryFn: () => collection.find(options),
						errorMap,
					}),
				findOne: (options: any) =>
					createQueryOptions({
						queryKey: buildKey(keyPrefix, [
							...baseKey,
							"findOne",
							normalizeQueryKeyOptions(options),
						]),
						queryFn: () => collection.findOne(options),
						errorMap,
					}),
				create: () =>
					createMutationOptions({
						mutationKey: buildKey(keyPrefix, [...baseKey, "create"]),
						mutationFn: (data: any) => collection.create(data),
						errorMap,
					}),
				update: () =>
					createMutationOptions({
						mutationKey: buildKey(keyPrefix, [...baseKey, "update"]),
						mutationFn: (variables: { id: string; data: any }) =>
							collection.update(variables.id, variables.data),
						errorMap,
					}),
				delete: () =>
					createMutationOptions({
						mutationKey: buildKey(keyPrefix, [...baseKey, "delete"]),
						mutationFn: (variables: { id: string }) =>
							collection.delete(variables.id),
						errorMap,
					}),
				restore: () =>
					createMutationOptions({
						mutationKey: buildKey(keyPrefix, [...baseKey, "restore"]),
						mutationFn: (variables: { id: string }) =>
							collection.restore(variables.id),
						errorMap,
					}),
			};
		},
	});

	const globals = new Proxy({} as QCMSQueryOptionsProxy<T>["globals"], {
		get: (_target, globalName) => {
			if (typeof globalName !== "string") return undefined;
			const global = client.globals[globalName as GlobalKeys<T>] as any;
			const baseKey = ["globals", globalName];

			return {
				get: (options?: any) =>
					createQueryOptions({
						queryKey: buildKey(
							keyPrefix,
							[...baseKey, "get", normalizeQueryKeyOptions(options)],
						),
						queryFn: () => global.get(options),
						errorMap,
					}),
				update: () =>
					createMutationOptions({
						mutationKey: buildKey(keyPrefix, [...baseKey, "update"]),
						mutationFn: (variables: { data: any; options?: any }) =>
							global.update(variables.data, variables.options),
						errorMap,
					}),
			};
		},
	});

	return {
		collections,
		globals,
		custom: {
			query: (customConfig) =>
				createQueryOptions({
					queryKey: buildKey(keyPrefix, customConfig.key),
					queryFn: customConfig.queryFn,
					errorMap,
				}),
			mutation: (customConfig) =>
				createMutationOptions({
					mutationKey: buildKey(keyPrefix, customConfig.key),
					mutationFn: customConfig.mutationFn,
					errorMap,
				}),
		},
		key: (parts) => buildKey(keyPrefix, parts),
	};
}
