"use client";

/**
 * Theme Provider adapted from next-themes for TanStack Start
 * https://github.com/pacocoursey/next-themes (MIT license)
 */

import * as React from "react";

interface ValueObject {
	[themeName: string]: string;
}

export interface UseThemeProps {
	themes: string[];
	forcedTheme?: string | undefined;
	setTheme: React.Dispatch<React.SetStateAction<string>>;
	theme?: string | undefined;
	resolvedTheme?: "dark" | "light" | undefined;
	systemTheme?: "dark" | "light" | undefined;
}

export type Attribute = `data-${string}` | "class";

export interface ThemeProviderProps extends React.PropsWithChildren {
	themes?: string[] | undefined;
	forcedTheme?: string | undefined;
	enableSystem?: boolean | undefined;
	disableTransitionOnChange?: boolean | undefined;
	enableColorScheme?: boolean | undefined;
	storageKey?: string | undefined;
	defaultTheme?: string | undefined;
	attribute?: Attribute | Attribute[] | undefined;
	value?: ValueObject | undefined;
	nonce?: string | undefined;
}

const colorSchemes = ["light", "dark"];
const MEDIA = "(prefers-color-scheme: dark)";
const isServer = typeof window === "undefined";
const ThemeContext = React.createContext<UseThemeProps | undefined>(undefined);
const defaultContext: UseThemeProps = { setTheme: (_) => {}, themes: [] };

export const useTheme = () => React.useContext(ThemeContext) ?? defaultContext;

export const ThemeProvider = (props: ThemeProviderProps): React.ReactNode => {
	const context = React.useContext(ThemeContext);

	// Ignore nested context providers, just passthrough children
	if (context) return props.children;
	return <Theme {...props} />;
};

const defaultThemes = ["light", "dark"];

const Theme = ({
	forcedTheme,
	disableTransitionOnChange = false,
	enableSystem = true,
	enableColorScheme = true,
	storageKey = "barbershop-theme",
	themes = defaultThemes,
	defaultTheme = enableSystem ? "system" : "light",
	attribute = "class",
	value,
	children,
	nonce,
}: ThemeProviderProps) => {
	const [theme, setThemeState] = React.useState(() =>
		getTheme(storageKey, defaultTheme),
	);
	const [resolvedTheme, setResolvedTheme] = React.useState(() =>
		getTheme(storageKey),
	);
	const attrs = !value ? themes : Object.values(value);

	const applyTheme = React.useCallback(
		(theme: string | undefined) => {
			let resolved = theme;
			if (!resolved) return;

			// If theme is system, resolve it before setting theme
			if (theme === "system" && enableSystem) {
				resolved = getSystemTheme();
			}

			const name = value ? value[resolved] : resolved;
			const enable = disableTransitionOnChange ? disableAnimation() : null;
			const d = document.documentElement;

			const handleAttribute = (attr: Attribute) => {
				if (attr === "class") {
					d.classList.remove(...attrs);
					if (name) d.classList.add(name);
				} else if (attr.startsWith("data-")) {
					if (name) {
						d.setAttribute(attr, name);
					} else {
						d.removeAttribute(attr);
					}
				}
			};

			if (Array.isArray(attribute)) attribute.forEach(handleAttribute);
			else handleAttribute(attribute);

			if (enableColorScheme) {
				const fallback = colorSchemes.includes(defaultTheme)
					? defaultTheme
					: null;
				const colorScheme = colorSchemes.includes(resolved)
					? resolved
					: fallback;
				// @ts-expect-error
				d.style.colorScheme = colorScheme;
			}

			enable?.();
		},
		[
			attrs,
			attribute,
			defaultTheme,
			disableTransitionOnChange,
			enableColorScheme,
			enableSystem,
			value,
		],
	);

	const setTheme = React.useCallback(
		(value: React.SetStateAction<string>) => {
			const newTheme = typeof value === "function" ? value(theme ?? "") : value;
			setThemeState(newTheme);

			// Save to storage
			try {
				localStorage.setItem(storageKey, newTheme);
			} catch (e) {
				// Unsupported
			}
		},
		[theme, storageKey],
	);

	const handleMediaQuery = React.useCallback(
		(e: MediaQueryListEvent | MediaQueryList) => {
			const resolved = getSystemTheme(e);
			setResolvedTheme(resolved);

			if (theme === "system" && enableSystem && !forcedTheme) {
				applyTheme("system");
			}
		},
		[theme, forcedTheme, enableSystem, applyTheme],
	);

	// Always listen to System preference
	React.useEffect(() => {
		const media = window.matchMedia(MEDIA);

		media.addEventListener("change", handleMediaQuery);
		handleMediaQuery(media);

		return () => media.removeEventListener("change", handleMediaQuery);
	}, [handleMediaQuery]);

	// localStorage event handling
	React.useEffect(() => {
		const handleStorage = (e: StorageEvent) => {
			if (e.key !== storageKey) {
				return;
			}

			const theme = e.newValue || defaultTheme;
			setTheme(theme);
		};

		window.addEventListener("storage", handleStorage);
		return () => window.removeEventListener("storage", handleStorage);
	}, [setTheme, storageKey, defaultTheme]);

	// Whenever theme or forcedTheme changes, apply it
	React.useEffect(() => {
		applyTheme(forcedTheme ?? theme);
	}, [forcedTheme, theme, applyTheme]);

	// Update resolved theme when theme changes
	React.useEffect(() => {
		if (theme === "system" && enableSystem) {
			setResolvedTheme(getSystemTheme());
		} else if (theme) {
			setResolvedTheme(theme as "light" | "dark");
		}
	}, [theme, enableSystem]);

	const providerValue = React.useMemo(
		() => ({
			theme,
			setTheme,
			forcedTheme,
			resolvedTheme: resolvedTheme as "light" | "dark" | undefined,
			themes: enableSystem ? [...themes, "system"] : themes,
			systemTheme: getSystemTheme() as "light" | "dark",
		}),
		[theme, setTheme, forcedTheme, resolvedTheme, enableSystem, themes],
	);

	return (
		<ThemeContext.Provider value={providerValue}>
			<ThemeScript
				{...{
					forcedTheme,
					storageKey,
					attribute,
					enableSystem,
					enableColorScheme,
					defaultTheme,
					value,
					themes,
					nonce,
				}}
			/>
			{children}
		</ThemeContext.Provider>
	);
};

const ThemeScript = React.memo(
	({
		forcedTheme,
		storageKey,
		attribute,
		enableSystem,
		enableColorScheme,
		defaultTheme,
		value,
		themes,
		nonce,
	}: Omit<ThemeProviderProps, "children"> & { defaultTheme: string }) => {
		const scriptArgs = JSON.stringify([
			attribute,
			storageKey,
			defaultTheme,
			forcedTheme,
			themes,
			value,
			enableSystem,
			enableColorScheme,
		]).slice(1, -1);

		return (
			<script
				suppressHydrationWarning
				nonce={typeof window === "undefined" ? nonce : ""}
				dangerouslySetInnerHTML={{
					__html: `(${script.toString()})(${scriptArgs})`,
				}}
			/>
		);
	},
);

ThemeScript.displayName = "ThemeScript";

// Helpers
const getTheme = (key: string, fallback?: string) => {
	if (isServer) return undefined;
	let theme: string | undefined;
	try {
		theme = localStorage.getItem(key) || undefined;
	} catch (e) {
		// Unsupported
	}
	return theme || fallback;
};

const disableAnimation = () => {
	const css = document.createElement("style");
	css.appendChild(
		document.createTextNode(
			"*,*::before,*::after{-webkit-transition:none!important;-moz-transition:none!important;-o-transition:none!important;-ms-transition:none!important;transition:none!important}",
		),
	);
	document.head.appendChild(css);

	return () => {
		// Force restyle
		(() => window.getComputedStyle(document.body))();

		// Wait for next tick before removing
		setTimeout(() => {
			document.head.removeChild(css);
		}, 1);
	};
};

const getSystemTheme = (e?: MediaQueryList | MediaQueryListEvent) => {
	if (isServer) return "light";
	const event = e ?? window.matchMedia(MEDIA);
	const isDark = event.matches;
	const systemTheme = isDark ? "dark" : "light";
	return systemTheme;
};

/**
 * Inline script to prevent FOUC (Flash of Unstyled Content)
 * Runs before React hydration to set the correct theme immediately
 */
export const script = (
	attribute: Attribute | Attribute[],
	storageKey: string,
	defaultTheme: string,
	forcedTheme: string | undefined,
	themes: string[],
	value: ValueObject | undefined,
	enableSystem: boolean,
	enableColorScheme: boolean,
) => {
	const el = document.documentElement;
	const systemThemes = ["light", "dark"];
	const isClass = attribute === "class";
	const classes =
		isClass && value ? themes.map((t: string) => value[t] || t) : themes;

	function updateDOM(theme: string) {
		if (isClass) {
			el.classList.remove(...(classes as string[]));
			el.classList.add(theme);
		} else if (typeof attribute === "string") {
			el.setAttribute(attribute, theme);
		}

		setColorScheme(theme);
	}

	function setColorScheme(theme: string) {
		if (enableColorScheme && systemThemes.includes(theme)) {
			el.style.colorScheme = theme;
		}
	}

	function getSystemTheme() {
		return window.matchMedia("(prefers-color-scheme: dark)").matches
			? "dark"
			: "light";
	}

	if (forcedTheme) {
		updateDOM(forcedTheme);
	} else {
		try {
			const themeName = localStorage.getItem(storageKey) || defaultTheme;
			const isSystem = enableSystem && themeName === "system";
			const theme = isSystem ? getSystemTheme() : themeName;
			updateDOM(theme);
		} catch (e) {
			//
		}
	}
};
