/**
 * Interpolate `{{param}}` placeholders in a message string.
 *
 * Surrounding whitespace inside the braces is tolerated, so `{{count}}` and
 * `{{ count }}` behave identically — message files are written by translators,
 * not parsers, and both spellings look correct to them.
 *
 * A placeholder with no matching param is echoed back in its normalized form
 * (`{{key}}`) rather than replaced with "undefined", so a missing value is
 * visible in the output instead of silently corrupting the sentence.
 */
export function interpolate(
	template: string,
	params?: Record<string, unknown>,
): string {
	if (!params) return template;
	return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => {
		const value = params[key];
		return value === undefined ? `{{${key}}}` : String(value);
	});
}
