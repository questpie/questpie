export type NonEmptyLocaleTuple = readonly [string, ...string[]];

export type PluralMessages = {
	zero?: string;
	one: string;
	two?: string;
	few?: string;
	many?: string;
	other: string;
};

export type I18nMessage = string | PluralMessages;
export type MessageCatalog = Readonly<Record<string, I18nMessage>>;

export interface I18nAdapter<
	TLocale extends string = string,
	TMessageKey extends string = string,
> {
	readonly locale: TLocale;
	readonly locales: readonly TLocale[];
	t(key: TMessageKey, params?: Readonly<Record<string, unknown>>): string;
	setLocale(locale: TLocale): void | Promise<void>;
	onLocaleChange(callback: (locale: TLocale) => void): () => void;
	formatDate(date: Date | number, options?: Intl.DateTimeFormatOptions): string;
	formatNumber(value: number, options?: Intl.NumberFormatOptions): string;
	formatRelative?(date: Date | number): string;
	getLocaleName(locale: string): string;
	isRTL(): boolean;
}

export type SimpleMessages = MessageCatalog;

export type MessageKeys<TMessages extends Record<string, MessageCatalog>> =
	Extract<keyof TMessages[keyof TMessages], string>;

type EqualKeys<TLeft, TRight> =
	Exclude<TLeft, TRight> extends never
		? Exclude<TRight, TLeft> extends never
			? true
			: false
		: false;

type MismatchedCatalogLocales<
	TLocales extends NonEmptyLocaleTuple,
	TMessages extends Record<TLocales[number], MessageCatalog>,
> = {
	[TLocale in TLocales[number]]: EqualKeys<
		Extract<keyof TMessages[TLocale], string>,
		Extract<keyof TMessages[TLocales[0]], string>
	> extends true
		? never
		: TLocale;
}[TLocales[number]];

type ValidatedMessageCatalogs<
	TLocales extends NonEmptyLocaleTuple,
	TMessages extends Record<TLocales[number], MessageCatalog>,
> =
	Exclude<Extract<keyof TMessages, string>, TLocales[number]> extends never
		? MismatchedCatalogLocales<TLocales, TMessages> extends never
			? unknown
			: never
		: never;

export type SimpleI18nOptions<
	TLocales extends NonEmptyLocaleTuple,
	TMessages extends Record<TLocales[number], MessageCatalog>,
> = {
	locale: TLocales[number];
	locales: TLocales;
	messages: TMessages & ValidatedMessageCatalogs<TLocales, TMessages>;
	fallbackLocale?: TLocales[number];
	onLocaleChange?: (locale: TLocales[number]) => void;
};
