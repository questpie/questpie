"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export function ThemeToggle() {
	const [theme, setThemeState] = useState<"light" | "dark">("light");
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
		const isDark = document.documentElement.classList.contains("dark");
		setThemeState(isDark ? "dark" : "light");
	}, []);

	const toggleTheme = () => {
		const newTheme = theme === "dark" ? "light" : "dark";
		setThemeState(newTheme);

		if (newTheme === "dark") {
			document.documentElement.classList.add("dark");
			localStorage.setItem("theme", "dark");
		} else {
			document.documentElement.classList.remove("dark");
			localStorage.setItem("theme", "light");
		}
	};

	// Prevent flash during hydration
	if (!mounted) {
		return <div className="inline-flex items-center justify-center w-9 h-9" />;
	}

	return (
		<button
			type="button"
			onClick={toggleTheme}
			className="inline-flex items-center justify-center w-9 h-9 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors rounded-none border border-transparent hover:border-border"
			aria-label="Toggle theme"
		>
			<Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
			<Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
			<span className="sr-only">Toggle theme</span>
		</button>
	);
}
