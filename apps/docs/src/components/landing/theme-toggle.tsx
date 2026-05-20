import { useEffect, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";

import { LIcon } from "./primitives";

type Theme = "light" | "dark";

const THEME_STORAGE_KEY = "theme";
const THEME_CHANGE_EVENT = "questpie-theme-change";

function readStoredTheme(): Theme | null {
	try {
		const stored = localStorage.getItem(THEME_STORAGE_KEY);
		return stored === "dark" || stored === "light" ? stored : null;
	} catch {
		return null;
	}
}

function readThemeSnapshot(): Theme {
	const stored = readStoredTheme();
	if (stored) return stored;
	return document.documentElement.classList.contains("light") ? "light" : "dark";
}

function subscribe(onChange: () => void) {
	const observer = new MutationObserver(onChange);
	observer.observe(document.documentElement, {
		attributeFilter: ["class"],
		attributes: true,
	});
	const onStorage = (e: StorageEvent) => {
		if (e.key === THEME_STORAGE_KEY) onChange();
	};
	window.addEventListener("storage", onStorage);
	window.addEventListener(THEME_CHANGE_EVENT, onChange);
	return () => {
		observer.disconnect();
		window.removeEventListener("storage", onStorage);
		window.removeEventListener(THEME_CHANGE_EVENT, onChange);
	};
}

function applyTheme(theme: Theme) {
	const root = document.documentElement;
	root.classList.toggle("dark", theme === "dark");
	root.classList.toggle("light", theme === "light");
	root.style.colorScheme = theme;
	try {
		localStorage.setItem(THEME_STORAGE_KEY, theme);
	} catch {
		// noop
	}
	window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

export function ThemeToggle() {
	const theme = useSyncExternalStore(subscribe, readThemeSnapshot, () => "dark");

	useEffect(() => {
		applyTheme(readThemeSnapshot());
	}, []);

	return (
		<Button
			type="button"
			variant="ghost"
			size="icon-sm"
			onClick={() => applyTheme(theme === "light" ? "dark" : "light")}
			aria-label="Toggle theme"
		>
			<LIcon name={theme === "light" ? "moon" : "sun"} size={14} />
		</Button>
	);
}
