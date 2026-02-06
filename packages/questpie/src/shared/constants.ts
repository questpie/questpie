/**
 * Default locale fallback used across the CMS.
 */
export const DEFAULT_LOCALE = "en" as const;

/**
 * Default locale configuration.
 */
export const DEFAULT_LOCALE_CONFIG: {
  default: string;
  supported: string[];
} = {
  default: DEFAULT_LOCALE,
  supported: [DEFAULT_LOCALE],
};
