import * as React from "react";

/**
 * Theme mode for the admin interface.
 */
export type AdminTheme = "light" | "dark" | "system";

const ADMIN_THEME_STORAGE_KEY = "questpie:admin-theme";
export const AdminThemeAppliedContext = React.createContext(false);

function getStoredAdminTheme(): AdminTheme {
	if (typeof window === "undefined") return "system";
	const stored = window.localStorage.getItem(ADMIN_THEME_STORAGE_KEY);
	return stored === "light" || stored === "dark" || stored === "system"
		? stored
		: "system";
}

export function useManagedAdminTheme(
	controlledTheme: AdminTheme | undefined,
	controlledSetTheme: ((theme: AdminTheme) => void) | undefined,
	options: { enabled?: boolean } = {},
) {
	const enabled = options.enabled ?? true;
	const [uncontrolledTheme, setUncontrolledTheme] =
		React.useState<AdminTheme>(getStoredAdminTheme);
	const theme = controlledTheme ?? uncontrolledTheme;

	const setTheme = React.useCallback(
		(next: AdminTheme) => {
			if (controlledSetTheme) {
				controlledSetTheme(next);
				return;
			}

			setUncontrolledTheme(next);
			try {
				window.localStorage.setItem(ADMIN_THEME_STORAGE_KEY, next);
			} catch {
				// Ignore storage failures; class application still updates in memory.
			}
		},
		[controlledSetTheme],
	);

	React.useEffect(() => {
		if (!enabled) return;

		const root = document.documentElement;
		const media = window.matchMedia("(prefers-color-scheme: dark)");

		const applyTheme = () => {
			const resolved =
				theme === "system" ? (media.matches ? "dark" : "light") : theme;
			root.classList.toggle("dark", resolved === "dark");
			root.classList.toggle("light", resolved === "light");
			root.style.colorScheme = resolved;
		};

		applyTheme();
		if (theme !== "system") return;

		media.addEventListener("change", applyTheme);
		return () => media.removeEventListener("change", applyTheme);
	}, [enabled, theme]);

	return { theme, setTheme };
}

export function useHasManagedAdminTheme() {
	return React.useContext(AdminThemeAppliedContext);
}
