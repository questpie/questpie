/**
 * Test utilities for @questpie/admin components
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type RenderOptions, render } from "@testing-library/react";
import * as React from "react";

/**
 * Create a fresh QueryClient for each test
 */
function createTestQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
				gcTime: 0,
			},
			mutations: {
				retry: false,
			},
		},
	});
}

/**
 * Test wrapper with all required providers
 */
function TestWrapper({ children }: { children: React.ReactNode }) {
	const [queryClient] = React.useState(() => createTestQueryClient());

	return (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}

/**
 * Custom render function that wraps components with test providers
 */
function customRender(
	ui: React.ReactElement,
	options?: Omit<RenderOptions, "wrapper">,
): ReturnType<typeof render> {
	return render(ui, { wrapper: TestWrapper, ...options });
}

// Re-export everything from testing-library
export * from "@testing-library/react";
export { customRender as render };
