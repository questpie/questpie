import type { CurrentAppContract } from "./app";

export interface GeneratedClient {
	readonly queries: CurrentAppContract["queries"];
	readonly mutations: CurrentAppContract["mutations"];
	readonly collections: {
		readonly messages: {
			readonly list: CurrentAppContract["queries"]["messages.list"];
			readonly get: CurrentAppContract["queries"]["messages.get"];
			readonly create: CurrentAppContract["mutations"]["messages.create"];
			readonly update: CurrentAppContract["mutations"]["messages.update"];
			readonly delete: CurrentAppContract["mutations"]["messages.delete"];
		};
	};
	withContext(input: { readonly companyId: string }): GeneratedClient;
}
