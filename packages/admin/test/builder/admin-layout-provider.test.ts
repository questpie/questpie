import { describe, expect, it } from "bun:test";

import { QueryClient } from "@tanstack/react-query";

import {
	configureAdminQueryClient,
	shouldRetryAdminQuery,
} from "#questpie/admin/client/views/layout/admin-layout-provider";

describe("shouldRetryAdminQuery", () => {
	it("retries transient and server-side failures", () => {
		expect(shouldRetryAdminQuery(0, new TypeError("Failed to fetch"))).toBe(
			true,
		);
		expect(shouldRetryAdminQuery(2, { status: 503 })).toBe(true);
		expect(shouldRetryAdminQuery(3, { status: 503 })).toBe(false);
	});

	it("does not retry auth or non-transient client errors", () => {
		expect(shouldRetryAdminQuery(0, { status: 401 })).toBe(false);
		expect(shouldRetryAdminQuery(0, { status: 404 })).toBe(false);
		expect(shouldRetryAdminQuery(0, { status: 422 })).toBe(false);
	});

	it("retries timeout and rate-limit client errors", () => {
		expect(shouldRetryAdminQuery(0, { status: 408 })).toBe(true);
		expect(shouldRetryAdminQuery(0, { status: 429 })).toBe(true);
	});
});

describe("configureAdminQueryClient", () => {
	it("adds admin defaults to a provided QueryClient", () => {
		const queryClient = configureAdminQueryClient(
			new QueryClient({
				defaultOptions: {
					queries: {
						staleTime: 5 * 60 * 1000,
					},
				},
			}),
		);

		const queryDefaults = queryClient.getDefaultOptions().queries;

		expect(queryDefaults?.staleTime).toBe(5 * 60 * 1000);
		expect(queryDefaults?.refetchOnWindowFocus).toBe(false);
		expect(typeof queryDefaults?.retry).toBe("function");
	});

	it("preserves explicit app QueryClient settings", () => {
		const queryClient = configureAdminQueryClient(
			new QueryClient({
				defaultOptions: {
					queries: {
						refetchOnWindowFocus: true,
						retry: false,
					},
				},
			}),
		);

		const queryDefaults = queryClient.getDefaultOptions().queries;

		expect(queryDefaults?.refetchOnWindowFocus).toBe(true);
		expect(queryDefaults?.retry).toBe(false);
	});
});
