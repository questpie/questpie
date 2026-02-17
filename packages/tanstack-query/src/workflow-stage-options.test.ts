import { describe, expect, it } from "bun:test";
import { createQuestpieQueryOptions } from "./index.js";

describe("tanstack query workflow stage config", () => {
	it("includes stage in keys and forwards stage for mutations", async () => {
		const createOptionsCalls: any[] = [];
		const globalUpdateOptionsCalls: any[] = [];

		const client = {
			collections: {
				posts: {
					find: async () => ({
						docs: [],
						totalDocs: 0,
						limit: 10,
						offset: 0,
						hasNextPage: false,
						hasPrevPage: false,
					}),
					create: async (_data: any, options?: any) => {
						createOptionsCalls.push(options);
						return { id: "post-1" };
					},
				},
			},
			globals: {
				siteSettings: {
					update: async (_data: any, options?: any) => {
						globalUpdateOptionsCalls.push(options);
						return { id: "global-1" };
					},
				},
			},
			rpc: {},
			realtime: undefined,
		} as any;

		const queryOptions = createQuestpieQueryOptions(client as any, {
			keyPrefix: ["questpie"],
			locale: "sk",
			stage: "review",
		}) as any;

		const findQuery = queryOptions.collections.posts.find({ limit: 5 });
		expect(findQuery.queryKey).toContain("review");

		const createMutation = queryOptions.collections.posts.create();
		await createMutation.mutationFn?.({ title: "New" });

		const updateGlobalMutation = queryOptions.globals.siteSettings.update();
		await updateGlobalMutation.mutationFn?.({ data: { siteName: "Site" } });

		expect(createOptionsCalls[0]).toEqual({ locale: "sk", stage: "review" });
		expect(globalUpdateOptionsCalls[0]).toEqual({
			locale: "sk",
			stage: "review",
		});
	});

	it("generates transitionStage mutation for collections and globals", async () => {
		const collTransitionCalls: any[] = [];
		const globalTransitionCalls: any[] = [];

		const client = {
			collections: {
				posts: {
					transitionStage: async (params: any, options?: any) => {
						collTransitionCalls.push({ params, options });
						return { id: params.id };
					},
				},
			},
			globals: {
				siteSettings: {
					transitionStage: async (params: any, options?: any) => {
						globalTransitionCalls.push({ params, options });
						return { id: "global-1" };
					},
				},
			},
			rpc: {},
			realtime: undefined,
		} as any;

		const queryOptions = createQuestpieQueryOptions(client as any, {
			keyPrefix: ["questpie"],
			locale: "en",
			stage: "draft",
		}) as any;

		// Collection transitionStage mutation
		const collMutation = queryOptions.collections.posts.transitionStage();
		expect(collMutation.mutationKey).toContain("transitionStage");
		await collMutation.mutationFn?.({ id: "post-1", stage: "published" });
		expect(collTransitionCalls[0]?.params).toEqual({
			id: "post-1",
			stage: "published",
		});
		expect(collTransitionCalls[0]?.options).toEqual({
			locale: "en",
			stage: "draft",
		});

		// Global transitionStage mutation
		const globalMutation =
			queryOptions.globals.siteSettings.transitionStage();
		expect(globalMutation.mutationKey).toContain("transitionStage");
		await globalMutation.mutationFn?.({
			params: { stage: "published" },
		});
		expect(globalTransitionCalls[0]?.params).toEqual({
			stage: "published",
		});
		expect(globalTransitionCalls[0]?.options).toEqual({ locale: "en" });
	});
});
