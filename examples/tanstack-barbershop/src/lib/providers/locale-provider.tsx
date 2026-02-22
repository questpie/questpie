"use client";

import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useState,
} from "react";
import { en, type TranslationKey } from "../../translations/en";
import { sk } from "../../translations/sk";

export type Locale = "en" | "sk";

type Translations = Record<TranslationKey, string>;

interface LocaleContextValue {
	locale: Locale;
	setLocale: (locale: Locale) => void;
	t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

const STORAGE_KEY = "barbershop-locale";

const translations: Record<Locale, Translations> = {
	en: en as Translations,
	sk: sk as Translations,
};

function getStoredLocale(): Locale {
	if (typeof window === "undefined") return "en";
	const stored = localStorage.getItem(STORAGE_KEY);
	if (stored === "en" || stored === "sk") {
		return stored;
	}
	// Try to detect from browser
	const browserLang = navigator.language.split("-")[0];
	if (browserLang === "sk") return "sk";
	return "en";
}

export function LocaleProvider({ children }: { children: ReactNode }) {
	const [locale, setLocaleState] = useState<Locale>("en");
	const [mounted, setMounted] = useState(false);

	// Initialize locale from localStorage or browser
	useEffect(() => {
		setMounted(true);
		const stored = getStoredLocale();
		setLocaleState(stored);
	}, []);

	const setLocale = useCallback((newLocale: Locale) => {
		setLocaleState(newLocale);
		localStorage.setItem(STORAGE_KEY, newLocale);
		// Set cookie for SSR
		document.cookie = `${STORAGE_KEY}=${newLocale}; path=/; max-age=31536000; SameSite=Lax`;
		// Update html lang attribute
		document.documentElement.lang = newLocale;
	}, []);

	const t = useCallback(
		(key: TranslationKey, params?: Record<string, string | number>): string => {
			let text: string =
				translations[locale][key] || translations.en[key] || key;

			// Replace parameters like {name} with actual values
			if (params) {
				for (const [paramKey, value] of Object.entries(params)) {
					text = text.replace(
						new RegExp(`\\{${paramKey}\\}`, "g"),
						String(value),
					);
				}
			}

			return text;
		},
		[locale],
	);

	// Update html lang attribute when locale changes
	useEffect(() => {
		if (mounted) {
			document.documentElement.lang = locale;
		}
	}, [locale, mounted]);

	// Prevent flash during SSR - return with default locale
	if (!mounted) {
		return (
			<LocaleContext.Provider
				value={{
					locale: "en",
					setLocale: () => {},
					t: (key) => en[key] || key,
				}}
			>
				{children}
			</LocaleContext.Provider>
		);
	}

	return (
		<LocaleContext.Provider value={{ locale, setLocale, t }}>
			{children}
		</LocaleContext.Provider>
	);
}

export function useLocale() {
	const context = useContext(LocaleContext);
	if (context === undefined) {
		throw new Error("useLocale must be used within a LocaleProvider");
	}
	return context;
}

/**
 * Hook to get just the translation function
 */
export function useTranslation() {
	const { t, locale } = useLocale();
	return { t, locale };
}
