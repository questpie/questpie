import { client } from "@/lib/client";
import { createQuestpieQueryOptions } from "@questpie/tanstack-query";

/**
 * Typed TanStack Query option builders for this project.
 *
 * `q.collections.*`, `q.globals.*`, and `q.routes.*` return `queryOptions()` /
 * `mutationOptions()` objects you pass straight into `useQuery` / `useMutation`.
 * Full type inference flows from the server schema via `AppConfig`.
 *
 * @example
 * const { data } = useQuery(q.collections.posts.find({ limit: 10 }));
 * const create = useMutation(q.collections.posts.create());
 */
export const q = createQuestpieQueryOptions(client);

export type QueryOptions = typeof q;
