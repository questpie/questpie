import * as React from "react";

import { SEARCH_PARAMS_EVENT } from "../lib/events.js";

interface UseSearchParamToggleOptions {
	defaultValue?: boolean;
	trueValue?: string;
	legacyKeys?: Array<{
		key: string;
		trueValue?: string;
	}>;
}

function isTruthyParam(value: string | null, trueValue: string): boolean {
	if (value === null) return false;
	if (value === trueValue) return true;
	if (value === "true" || value === "1") return true;
	return false;
}

function readToggleFromUrl(
	key: string,
	defaultValue: boolean,
	trueValue: string,
	legacyKeys: Array<{ key: string; trueValue?: string }> = [],
): boolean {
	if (typeof window === "undefined") return defaultValue;

	const params = new URLSearchParams(window.location.search);
	const value = params.get(key);
	if (isTruthyParam(value, trueValue)) return true;

	for (const legacy of legacyKeys) {
		if (isTruthyParam(params.get(legacy.key), legacy.trueValue ?? "true")) {
			return true;
		}
	}

	if (value === null) return defaultValue;

	return false;
}

function writeToggleToUrl(
	key: string,
	value: boolean,
	trueValue: string,
	legacyKeys: Array<{ key: string; trueValue?: string }> = [],
): void {
	if (typeof window === "undefined") return;

	const url = new URL(window.location.href);

	if (value) {
		url.searchParams.set(key, trueValue);
	} else {
		url.searchParams.delete(key);
	}

	for (const legacy of legacyKeys) {
		url.searchParams.delete(legacy.key);
	}

	window.history.replaceState({}, "", url.toString());
	window.dispatchEvent(new Event(SEARCH_PARAMS_EVENT));
}

export function useSearchParamToggle(
	key: string,
	options: UseSearchParamToggleOptions = {},
) {
	const defaultValue = options.defaultValue ?? false;
	const trueValue = options.trueValue ?? "true";
	const legacyKeys = options.legacyKeys ?? [];

	const [value, setValue] = React.useState<boolean>(() =>
		readToggleFromUrl(key, defaultValue, trueValue, legacyKeys),
	);

	React.useEffect(() => {
		const syncFromUrl = () => {
			setValue(readToggleFromUrl(key, defaultValue, trueValue, legacyKeys));
		};

		window.addEventListener("popstate", syncFromUrl);
		window.addEventListener(SEARCH_PARAMS_EVENT, syncFromUrl);

		return () => {
			window.removeEventListener("popstate", syncFromUrl);
			window.removeEventListener(SEARCH_PARAMS_EVENT, syncFromUrl);
		};
	}, [key, defaultValue, trueValue, legacyKeys]);

	const setToggle = React.useCallback(
		(next: boolean | ((prev: boolean) => boolean)) => {
			setValue((prev) => {
				const resolved =
					typeof next === "function"
						? (next as (prev: boolean) => boolean)(prev)
						: next;

				writeToggleToUrl(key, resolved, trueValue, legacyKeys);
				return resolved;
			});
		},
		[key, trueValue, legacyKeys],
	);

	return [value, setToggle] as const;
}
