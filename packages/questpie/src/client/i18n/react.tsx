import {
	createContext,
	type ReactElement,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useSyncExternalStore,
} from "react";

import type { I18nAdapter } from "./types.js";

type ContextAdapter = I18nAdapter<string, string>;

const I18nContext = createContext<ContextAdapter | null>(null);

export interface I18nProviderProps<
	TLocale extends string = string,
	TMessageKey extends string = string,
> {
	adapter: I18nAdapter<TLocale, TMessageKey>;
	children: ReactNode;
}

export interface UseTranslationResult<
	TLocale extends string = string,
	TMessageKey extends string = string,
> {
	locale: TLocale;
	locales: readonly TLocale[];
	t: I18nAdapter<TLocale, TMessageKey>["t"];
	setLocale: I18nAdapter<TLocale, TMessageKey>["setLocale"];
	formatDate: I18nAdapter<TLocale, TMessageKey>["formatDate"];
	formatNumber: I18nAdapter<TLocale, TMessageKey>["formatNumber"];
	getLocaleName: I18nAdapter<TLocale, TMessageKey>["getLocaleName"];
	isRTL: boolean;
}

export function I18nProvider<
	TLocale extends string,
	TMessageKey extends string,
>({
	adapter,
	children,
}: I18nProviderProps<TLocale, TMessageKey>): ReactElement {
	const subscribe = useCallback(
		(onStoreChange: () => void) =>
			adapter.onLocaleChange(() => onStoreChange()),
		[adapter],
	);
	const getSnapshot = useCallback(() => adapter.locale, [adapter]);
	const initialServerLocale = useRef(adapter.locale);
	const getServerSnapshot = useCallback(() => initialServerLocale.current, []);
	const locale = useSyncExternalStore(
		subscribe,
		getSnapshot,
		getServerSnapshot,
	);

	const contextValue = useMemo<I18nAdapter<TLocale, TMessageKey>>(
		() => ({
			locale,
			locales: adapter.locales,
			t: adapter.t.bind(adapter),
			setLocale: adapter.setLocale.bind(adapter),
			onLocaleChange: adapter.onLocaleChange.bind(adapter),
			formatDate: adapter.formatDate.bind(adapter),
			formatNumber: adapter.formatNumber.bind(adapter),
			...(adapter.formatRelative
				? { formatRelative: adapter.formatRelative.bind(adapter) }
				: {}),
			getLocaleName: adapter.getLocaleName.bind(adapter),
			isRTL: adapter.isRTL.bind(adapter),
		}),
		[adapter, locale],
	);

	return (
		<I18nContext.Provider value={contextValue as ContextAdapter}>
			{children}
		</I18nContext.Provider>
	);
}

export function useSafeI18n<
	TLocale extends string = string,
	TMessageKey extends string = string,
>(): I18nAdapter<TLocale, TMessageKey> | null {
	return useContext(I18nContext) as I18nAdapter<TLocale, TMessageKey> | null;
}

export function useI18n<
	TLocale extends string = string,
	TMessageKey extends string = string,
>(): I18nAdapter<TLocale, TMessageKey> {
	const adapter = useSafeI18n<TLocale, TMessageKey>();
	if (!adapter) {
		throw new Error("useI18n must be used within I18nProvider");
	}
	return adapter;
}

export function useTranslation<
	TLocale extends string = string,
	TMessageKey extends string = string,
>(): UseTranslationResult<TLocale, TMessageKey> {
	const adapter = useI18n<TLocale, TMessageKey>();
	return {
		locale: adapter.locale,
		locales: adapter.locales,
		t: adapter.t,
		setLocale: adapter.setLocale,
		formatDate: adapter.formatDate,
		formatNumber: adapter.formatNumber,
		getLocaleName: adapter.getLocaleName,
		isRTL: adapter.isRTL(),
	};
}
