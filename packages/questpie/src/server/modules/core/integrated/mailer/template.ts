import type { z } from "zod";

import type { AppContext } from "#questpie/server/config/app-context.js";

/**
 * The result returned by an email handler.
 */
export interface EmailResult {
	subject: string;
	html: string;
	text?: string;
}

/**
 * Arguments passed to an email handler.
 * Extends AppContext with the validated input and optional locale.
 */
export type EmailHandlerArgs<TInput> = AppContext & {
	input: TInput;
	locale?: string;
};

/**
 * Email template definition with typesafe input and handler-based rendering.
 *
 * Unlike the old React-based API, the handler receives full AppContext
 * (db, collections, services, etc.) and can perform async data fetching.
 */
export interface EmailTemplateDefinition<
	TInput = any,
	TName extends string = string,
> {
	/**
	 * Unique name for this email template
	 */
	name: TName;

	/**
	 * Zod schema for input validation
	 */
	schema: z.ZodSchema<TInput>;

	/**
	 * Handler that produces the email content.
	 * Receives validated input + AppContext (db, collections, etc.).
	 * Must return `{ subject, html, text? }`.
	 */
	handler: (
		args: EmailHandlerArgs<TInput>,
	) => EmailResult | Promise<EmailResult>;
}

/**
 * Infer input type from email template definition
 */
export type InferEmailTemplateInput<T> =
	T extends EmailTemplateDefinition<infer I, any> ? I : never;

/**
 * @deprecated Use `InferEmailTemplateInput` instead
 */
export type InferEmailTemplateContext<T> = InferEmailTemplateInput<T>;

/**
 * Extract template names from email template definitions Record
 */
export type EmailTemplateNames<
	TTemplates extends Record<string, EmailTemplateDefinition<any, any>>,
> = keyof TTemplates;

/**
 * Get specific email template by name from templates Record
 */
export type GetEmailTemplate<
	TTemplates extends Record<string, EmailTemplateDefinition<any, any>>,
	Name extends EmailTemplateNames<TTemplates>,
> = TTemplates[Name];

/**
 * Define a typesafe email template
 *
 * @example
 * ```ts
 * import { email } from 'questpie';
 * import { z } from 'zod';
 *
 * export default email({
 *   name: 'welcome',
 *   schema: z.object({
 *     name: z.string(),
 *     activationLink: z.string().url(),
 *   }),
 *   handler: ({ input }) => ({
 *     subject: `Welcome to the platform, ${input.name}!`,
 *     html: `
 *       <div>
 *         <h1>Welcome, ${input.name}!</h1>
 *         <a href="${input.activationLink}">Activate your account</a>
 *       </div>
 *     `,
 *   }),
 * });
 * ```
 */
export function email<TName extends string, TInput>(
	definition: EmailTemplateDefinition<TInput, TName>,
): EmailTemplateDefinition<TInput, TName> {
	return definition;
}
