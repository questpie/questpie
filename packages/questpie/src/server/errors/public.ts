import { types as nodeTypes } from "node:util";

import type { BackendTranslateFn } from "#questpie/server/i18n/types.js";
import { snapshotBoundedBrokerValue } from "#questpie/server/modules/core/integrated/executor/bindings/protocol.js";
import {
	createZodErrorMap,
	type ZodIssue,
} from "#questpie/shared/i18n/zod-error-map.js";

import { ApiError } from "./base.js";
import { CMS_ERROR_CODES } from "./codes.js";
import { parseDatabaseError } from "./database.js";
import type { ApiErrorShape, FieldError } from "./types.js";

export interface PublicErrorOptions {
	t?: BackendTranslateFn;
	locale?: string;
}

/** Read only own data, including on thrown values: never invoke an accessor/proxy. */
export function errorDataProperty(value: unknown, key: string): unknown {
	if (!value || typeof value !== "object" || nodeTypes.isProxy(value))
		return undefined;
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function boundedData(value: unknown) {
	const snapshot = snapshotBoundedBrokerValue(value, 8192, 8, 256);
	return snapshot.ok ? snapshot.value : undefined;
}

function publicField(
	error: FieldError,
	{ t, locale }: PublicErrorOptions,
): FieldError {
	const path = error.path.slice(0, 256);
	let message = error.message;
	if (t && error.validationIssue) {
		message = createZodErrorMap(
			(key: string, params?: Record<string, unknown>) =>
				t(key, { field: path, ...error.messageParams, ...params }, locale),
		)(error.validationIssue as ZodIssue).message;
	} else if (t && error.messageKey) {
		message = t(
			error.messageKey,
			{ field: path, ...error.messageParams },
			locale,
		);
	}
	return { path, message: message.slice(0, 200) };
}

/** Canonical public product error. Diagnostics and invalid input values stay server-side. */
export function formatPublicError(
	error: unknown,
	options: PublicErrorOptions = {},
): ApiErrorShape {
	const internal = (): ApiErrorShape => ({
		code: "INTERNAL_SERVER_ERROR",
		message: options.t
			? options.t("error.internal", undefined, options.locale)
			: "Internal server error",
	});
	if (!error || typeof error !== "object" || nodeTypes.isProxy(error))
		return internal();
	if (!(error instanceof ApiError)) {
		const database = parseDatabaseError(error);
		return database ? formatPublicError(database, options) : internal();
	}
	// Snapshot selected own data before translating; ignore overridden methods and diagnostics.
	const code = errorDataProperty(error, "code");
	if (typeof code !== "string" || !Object.hasOwn(CMS_ERROR_CODES, code))
		return internal();
	if (code === "HOOK_ERROR" || code === "INTERNAL_SERVER_ERROR")
		return internal();
	const message = errorDataProperty(error, "message");
	const messageKey = errorDataProperty(error, "messageKey");
	const messageParams = boundedData(errorDataProperty(error, "messageParams"));
	const fields = errorDataProperty(error, "fieldErrors");
	// Field values and validation inputs are deliberately excluded from the snapshot.
	const fieldData: unknown[] = [];
	if (Array.isArray(fields) && !nodeTypes.isProxy(fields)) {
		const length = Math.min(Number(errorDataProperty(fields, "length")), 8);
		for (let i = 0; i < length; i++) {
			const field = errorDataProperty(fields, String(i));
			fieldData.push(
				boundedData({
					path: errorDataProperty(field, "path"),
					message: errorDataProperty(field, "message"),
					messageKey: errorDataProperty(field, "messageKey"),
					messageParams: errorDataProperty(field, "messageParams"),
					validationIssue: errorDataProperty(field, "validationIssue"),
				}),
			);
		}
	}
	const fieldErrors = fieldData
		.filter(
			(field): field is FieldError =>
				!!field &&
				typeof field === "object" &&
				typeof Reflect.get(field, "path") === "string" &&
				typeof Reflect.get(field, "message") === "string",
		)
		.map((field) => publicField(field, options));
	const context = errorDataProperty(error, "context");
	const custom = boundedData(errorDataProperty(context, "custom"));
	const access = boundedData(errorDataProperty(context, "access"));
	return {
		code: code as ApiErrorShape["code"],
		message: (options.t && typeof messageKey === "string"
			? options.t(
					messageKey,
					messageParams as Record<string, unknown> | undefined,
					options.locale,
				)
			: typeof message === "string"
				? message
				: "Operation failed"
		).slice(0, 1024),
		...(fieldErrors.length ? { fieldErrors } : {}),
		...(custom || access
			? {
					context: {
						...(custom ? { custom } : {}),
						...(access ? { access } : {}),
					} as ApiErrorShape["context"],
				}
			: {}),
	};
}
