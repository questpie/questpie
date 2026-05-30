import type { QuestpieApp, QuestpieClient } from "questpie/client";
import type { QuestpieQueryOptionsProxy } from "@questpie/tanstack-query";

import type { RegisteredCollectionNames } from "../builder/registry";
import { selectClient, useAdminStore } from "../runtime";

/** Runtime collection name narrowed for typed admin hooks. */
export type AdminCollectionKey = RegisteredCollectionNames;

/** Single intentional cast site for dynamic collection names in views. */
export function adminCollectionKey(name: string): AdminCollectionKey {
	return name as AdminCollectionKey;
}

export type CollectionQueryKey<TApp extends QuestpieApp> = keyof QuestpieQueryOptionsProxy<TApp>["collections"] &
	string;

export function getCollectionQueryApi<
	TApp extends QuestpieApp,
	K extends CollectionQueryKey<TApp>,
>(
	queryOpts: QuestpieQueryOptionsProxy<TApp>,
	collection: K,
): QuestpieQueryOptionsProxy<TApp>["collections"][K] {
	return queryOpts.collections[collection];
}

export function getGlobalQueryApi<
	TApp extends QuestpieApp,
	K extends keyof QuestpieQueryOptionsProxy<TApp>["globals"] & string,
>(
	queryOpts: QuestpieQueryOptionsProxy<TApp>,
	globalName: K,
): QuestpieQueryOptionsProxy<TApp>["globals"][K] {
	return queryOpts.globals[globalName];
}

/** Typed app client from admin store (factory hooks with explicit TApp). */
export function useAppClient<TApp extends QuestpieApp>(): QuestpieClient<TApp> {
	return useAdminStore(selectClient) as QuestpieClient<TApp>;
}
