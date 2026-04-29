"use client";

import { Icon } from "@iconify/react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ThemeToggle() {
	const [theme, setThemeState] = useState<"light" | "dark">("light");
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
		const storedTheme = localStorage.getItem("theme");
		const currentTheme =
			storedTheme === "dark" || storedTheme === "light"
				? storedTheme
				: document.documentElement.classList.contains("dark")
					? "dark"
					: "light";

		applyTheme(currentTheme);
		setThemeState(currentTheme);
	}, []);

	const applyTheme = (nextTheme: "light" | "dark") => {
		const root = document.documentElement;
		root.classList.toggle("dark", nextTheme === "dark");
		root.classList.toggle("light", nextTheme === "light");
		root.style.colorScheme = nextTheme;
		localStorage.setItem("theme", nextTheme);
	};

	const toggleTheme = () => {
		const newTheme = theme === "dark" ? "light" : "dark";
		setThemeState(newTheme);
		applyTheme(newTheme);
	};

	// Prevent flash during hydration
	if (!mounted) {
		return (
			<div
				className="inline-flex size-10 items-center justify-center rounded-[var(--control-radius,0.75rem)]"
				aria-hidden="true"
			/>
		);
	}

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
