import type { AppContextInput, GeneratedOperations } from "./app";

export interface ScopedClient extends GeneratedOperations {
	readonly context: Readonly<AppContextInput>;
}

export interface GeneratedClient {
	withContext(input: AppContextInput): ScopedClient;
}

export declare function createClient(options: {
	readonly baseUrl: string;
	readonly credentials?: "include" | "omit";
}): GeneratedClient;
