import { QueryClient } from "@tanstack/react-query";

const ONE_MINUTE = 60 * 1000;
const FIVE_MINUTES = 5 * ONE_MINUTE;

export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: ONE_MINUTE,
			gcTime: FIVE_MINUTES,
			refetchOnWindowFocus: false,
			retry: 1,
		},
		mutations: {
			retry: 0,
		},
	},
});
