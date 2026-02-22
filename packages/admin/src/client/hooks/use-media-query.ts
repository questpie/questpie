"use client";

import * as React from "react";

/**
 * Hook to detect media query matches
 *
 * @example
 * ```tsx
 * const isMobile = useMediaQuery("(max-width: 768px)");
 * const isDesktop = useMediaQuery("(min-width: 769px)");
 * const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");
 * ```
 */
export function useMediaQuery(query: string): boolean {
	const [matches, setMatches] = React.useState<boolean>(() => {
		// Check if we're on the server
		if (typeof window === "undefined") {
			return false;
		}
		return window.matchMedia(query).matches;
	});

	React.useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		const mediaQuery = window.matchMedia(query);

		// Set initial value
		setMatches(mediaQuery.matches);

		// Create listener
		const listener = (event: MediaQueryListEvent) => {
			setMatches(event.matches);
		};

		// Add listener (using modern API with fallback)
		if (mediaQuery.addEventListener) {
			mediaQuery.addEventListener("change", listener);
		} else {
			// Fallback for older browsers
			mediaQuery.addListener(listener);
		}

		// Cleanup
		return () => {
			if (mediaQuery.removeEventListener) {
				mediaQuery.removeEventListener("change", listener);
			} else {
				mediaQuery.removeListener(listener);
			}
		};
	}, [query]);

	return matches;
}

/**
 * Predefined breakpoints matching Tailwind CSS defaults
 */
const breakpoints = {
	sm: "(min-width: 640px)",
	md: "(min-width: 768px)",
	lg: "(min-width: 1024px)",
	xl: "(min-width: 1280px)",
	"2xl": "(min-width: 1536px)",
} as const;

/**
 * Hook to check if viewport is mobile (below md breakpoint)
 */
export function useIsMobile(): boolean {
	return !useMediaQuery(breakpoints.md);
}

/**
 * Hook to check if viewport is desktop (md breakpoint and above)
 */
export function useIsDesktop(): boolean {
	return useMediaQuery(breakpoints.md);
}
