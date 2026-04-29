/**
 * Shared i18n Exports
 *
 * Validation messages and Zod error mapping shared between FE and BE.
 */

export {
	type I18nLocaleMap,
	type I18nText,
	type I18nTranslationKey,
	isI18nLocaleMap,
	isI18nTranslationKey,
	resolveI18nText,
} from "./types.js";
export {
	createValidationTranslator,
	mergeValidationMessages,
	type ValidationMessage,
	type ValidationMessageKey,
	type ValidationMessagesMap,
	type ValidationTranslateFn,
	validationMessagesCS,
	validationMessagesDE,
	validationMessagesEN,
	validationMessagesES,
	validationMessagesFR,
	validationMessagesPL,
	validationMessagesPT,
	validationMessagesSK,
} from "./validation-messages.js";
export {
	createZodErrorMap,
	i18nParams,
	type ZodErrorMapFn,
	type ZodIssue,
} from "./zod-error-map.js";
