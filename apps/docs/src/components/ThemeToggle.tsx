"use client";

import { Icon } from "@iconify/react";
import { useEffect, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Theme = "light" | "dark";

const THEME_STORAGE_KEY = "theme";
const THEME_CHANGE_EVENT = "questpie-theme-change";

function readStoredTheme(): Theme | null {
	try {
		const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
		return storedTheme === "dark" || storedTheme === "light"
			? storedTheme
			: null;
	} catch {
		return null;
	}
}

function readThemeSnapshot(): Theme {
	const storedTheme = readStoredTheme();
	if (storedTheme) return storedTheme;
	return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function subscribeTheme(onStoreChange: () => void) {
	const observer = new MutationObserver(onStoreChange);
	observer.observe(document.documentElement, {
		attributeFilter: ["class"],
		attributes: true,
	});

	const handleStorage = (event: StorageEvent) => {
		if (event.key === THEME_STORAGE_KEY) onStoreChange();
	};

	window.addEventListener("storage", handleStorage);
	window.addEventListener(THEME_CHANGE_EVENT, onStoreChange);

	return () => {
		observer.disconnect();
		window.removeEventListener("storage", handleStorage);
		window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange);
	};
}

function applyTheme(nextTheme: Theme) {
	const root = document.documentElement;
	root.classList.toggle("dark", nextTheme === "dark");
	root.classList.toggle("light", nextTheme === "light");
	root.style.colorScheme = nextTheme;

	try {
		localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
	} catch {
		// Ignore storage failures in restricted browser contexts.
	}

	window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

export function ThemeToggle() {
	const theme = useSyncExternalStore(
		subscribeTheme,
		readThemeSnapshot,
		() => "light",
	);

	useEffect(() => {
		applyTheme(readThemeSnapshot());
	}, []);

	const toggleTheme = () => {
		const newTheme = theme === "dark" ? "light" : "dark";
		applyTheme(newTheme);
	};

	const iconClass =
		"absolute size-5 transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none";

	return (
		<Button
			type="button"
			onClick={toggleTheme}
			variant="ghost"
			size="icon-lg"
			className="text-muted-foreground hover:text-foreground relative"
			aria-label={
				theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
			}
			aria-pressed={theme === "dark"}
		>
			<Icon
				icon="ph:sun"
				aria-hidden="true"
				className={cn(
					iconClass,
					theme === "dark"
						? "scale-75 rotate-90 opacity-0"
						: "scale-100 rotate-0 opacity-100",
				)}
			/>
			<Icon
				icon="ph:moon"
				aria-hidden="true"
				className={cn(
					iconClass,
					theme === "dark"
						? "scale-100 rotate-0 opacity-100"
						: "scale-75 -rotate-90 opacity-0",
				)}
			/>
			<span className="sr-only">Toggle theme</span>
		</Button>
	);
}
