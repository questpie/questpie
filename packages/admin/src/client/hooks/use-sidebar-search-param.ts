import * as React from "react";

import { SEARCH_PARAMS_EVENT } from "../lib/events.js";

interface UseSidebarSearchParamOptions {
	paramKey?: string;
	legacyKey?: string;
	legacyTrueValue?: string;
}

function isTruthyParam(value: string | null, trueValue: string): boolean {
	if (value === null) return false;
	if (value === trueValue) return true;
	if (value === "true" || value === "1") return true;
	return false;
}

function readSidebarOpen(
	sidebarId: string,
	paramKey: string,
	legacyKey?: string,
	legacyTrueValue = "true",
): boolean {
	if (typeof window === "undefined") return false;

	const params = new URLSearchParams(window.location.search);
	if (params.get(paramKey) === sidebarId) {
		return true;
	}

	if (legacyKey) {
		return isTruthyParam(params.get(legacyKey), legacyTrueValue);
	}

	return false;
}

export function useSidebarSearchParam(
	sidebarId: string,
	options: UseSidebarSearchParamOptions = {},
) {
	const paramKey = options.paramKey ?? "sidebar";
	const legacyKey = options.legacyKey;
	const legacyTrueValue = options.legacyTrueValue ?? "true";

	const [open, setOpenState] = React.useState<boolean>(() =>
		readSidebarOpen(sidebarId, paramKey, legacyKey, legacyTrueValue),
	);

	React.useEffect(() => {
		const syncFromUrl = () => {
			setOpenState(
				readSidebarOpen(sidebarId, paramKey, legacyKey, legacyTrueValue),
			);
		};

		window.addEventListener("popstate", syncFromUrl);
		window.addEventListener(SEARCH_PARAMS_EVENT, syncFromUrl);

		return () => {
			window.removeEventListener("popstate", syncFromUrl);
			window.removeEventListener(SEARCH_PARAMS_EVENT, syncFromUrl);
		};
	}, [sidebarId, paramKey, legacyKey, legacyTrueValue]);

	const setOpen = React.useCallback(
		(next: boolean | ((prev: boolean) => boolean)) => {
			setOpenState((prev) => {
				const resolved =
					typeof next === "function"
						? (next as (prev: boolean) => boolean)(prev)
						: next;

				if (typeof window === "undefined") {
					return resolved;
				}

				const url = new URL(window.location.href);

				if (resolved) {
					url.searchParams.set(paramKey, sidebarId);
				} else if (url.searchParams.get(paramKey) === sidebarId) {
					url.searchParams.delete(paramKey);
				}

				if (legacyKey) {
					url.searchParams.delete(legacyKey);
				}

				window.history.replaceState({}, "", url.toString());
				window.dispatchEvent(new Event(SEARCH_PARAMS_EVENT));
				return resolved;
			});
		},
		[paramKey, sidebarId, legacyKey],
	);

	return [open, setOpen] as const;
}
