/**
 * Locale to Flag Utility
 *
 * Converts locale codes to country codes for flag display.
 * Uses flagcdn.com for PNG flags via CDN (no dependencies).
 *
 * ## Features
 *
 * - **Smart mapping**: Automatically maps locale codes to country codes (sk → SK, en → GB, en-US → US)
 * - **Custom overrides**: Support for custom country codes via `flagCountryCode` in locale config
 * - **Lightweight**: No dependencies, uses CDN for flags
 * - **Fallback support**: Gracefully handles unknown locale codes
 *
 * ## Usage
 *
 * ### Basic Usage
 *
 * ```tsx
 * import { getFlagUrl } from "@questpie/admin/client";
 *
 * function LocaleBadge({ locale }: { locale: string }) {
 *   return (
 *     <div>
 *       <img src={getFlagUrl(locale, 20)} alt={locale} />
 *       {locale}
 *     </div>
 *   );
 * }
 * ```
 *
 * ### Custom Country Code Mapping
 *
 * If the default mapping doesn't fit your needs, you can provide custom mapping:
 *
 * ```tsx
 * // Show US flag for English instead of UK
 * const flagUrl = getFlagUrl("en", 20, { en: "us" });
 * ```
 *
 * ### In CMS Configuration
 *
 * The best way to customize flag mapping is in your CMS locale config:
 *
 * ```ts
 * // questpie/server/cms.ts
 * q().locale({
 *   locales: [
 *     {
 *       code: "en",
 *       label: "English",
 *       flagCountryCode: "us", // Show US flag instead of UK
 *     },
 *     { code: "sk", label: "Slovenčina" },
 *   ],
 *   defaultLocale: "en",
 * })
 * ```
 *
 * The `flagCountryCode` will be automatically used by `LocaleSwitcher` and other locale UI components.
 */

// ============================================================================
// Types
// ============================================================================

export interface FlagConfig {
  /** Country code (ISO 3166-1 alpha-2) */
  countryCode: string;
  /** Alt text for accessibility */
  alt: string;
}

// ============================================================================
// Locale to Country Code Mapping
// ============================================================================

/**
 * Maps locale codes to country codes.
 * Handles both simple codes (en, sk) and region-specific (en-US, en-GB).
 */
const LOCALE_TO_COUNTRY: Record<string, string> = {
  // English variants
  en: "gb", // Default English → Great Britain
  "en-US": "us",
  "en-GB": "gb",
  "en-CA": "ca",
  "en-AU": "au",
  "en-NZ": "nz",
  "en-IE": "ie",

  // European languages
  sk: "sk", // Slovak
  cs: "cz", // Czech
  de: "de", // German
  "de-AT": "at",
  "de-CH": "ch",
  fr: "fr", // French
  "fr-CA": "ca",
  "fr-CH": "ch",
  es: "es", // Spanish
  "es-MX": "mx",
  "es-AR": "ar",
  it: "it", // Italian
  pt: "pt", // Portuguese
  "pt-BR": "br",
  nl: "nl", // Dutch
  pl: "pl", // Polish
  ru: "ru", // Russian
  uk: "ua", // Ukrainian
  tr: "tr", // Turkish
  sv: "se", // Swedish
  no: "no", // Norwegian
  da: "dk", // Danish
  fi: "fi", // Finnish
  hu: "hu", // Hungarian
  ro: "ro", // Romanian
  bg: "bg", // Bulgarian
  hr: "hr", // Croatian
  sr: "rs", // Serbian
  sl: "si", // Slovenian
  et: "ee", // Estonian
  lv: "lv", // Latvian
  lt: "lt", // Lithuanian

  // Asian languages
  zh: "cn", // Chinese
  "zh-CN": "cn",
  "zh-TW": "tw",
  "zh-HK": "hk",
  ja: "jp", // Japanese
  ko: "kr", // Korean
  th: "th", // Thai
  vi: "vn", // Vietnamese
  id: "id", // Indonesian
  ms: "my", // Malay
  hi: "in", // Hindi
  ar: "sa", // Arabic (Saudi Arabia as default)
  he: "il", // Hebrew

  // Other
  el: "gr", // Greek
  fa: "ir", // Persian
  ur: "pk", // Urdu
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get country code from locale code.
 *
 * @param locale - Locale code (e.g., "en", "sk", "en-US")
 * @param customMapping - Optional custom locale-to-country mapping (overrides defaults)
 * @returns Country code (lowercase, e.g., "gb", "sk", "us")
 *
 * @example
 * ```ts
 * getCountryCode("en") // "gb" (default)
 * getCountryCode("en-US") // "us"
 * getCountryCode("sk") // "sk"
 * getCountryCode("en", { en: "us" }) // "us" (custom mapping)
 * getCountryCode("unknown") // "unknown" (fallback to input)
 * ```
 */
export function getCountryCode(
  locale: string,
  customMapping?: Record<string, string>,
): string {
  const normalized = locale.toLowerCase();

  // Try custom mapping first (highest priority)
  if (customMapping?.[normalized]) {
    return customMapping[normalized].toLowerCase();
  }

  // Try exact match in default mapping
  if (LOCALE_TO_COUNTRY[normalized]) {
    return LOCALE_TO_COUNTRY[normalized];
  }

  // Try base language code (e.g., "en-US" → "en")
  const baseCode = normalized.split("-")[0];
  if (baseCode && customMapping?.[baseCode]) {
    return customMapping[baseCode].toLowerCase();
  }
  if (baseCode && LOCALE_TO_COUNTRY[baseCode]) {
    return LOCALE_TO_COUNTRY[baseCode];
  }

  // Fallback to input (useful for direct country codes)
  return normalized;
}

/**
 * Get flag configuration for a locale.
 *
 * @param locale - Locale code
 * @param customMapping - Optional custom locale-to-country mapping
 * @returns Flag configuration with country code and alt text
 *
 * @example
 * ```ts
 * getFlagConfig("sk") // { countryCode: "sk", alt: "Slovakia" }
 * getFlagConfig("en-US") // { countryCode: "us", alt: "United States" }
 * getFlagConfig("en", { en: "us" }) // { countryCode: "us", alt: "EN" }
 * ```
 */
export function getFlagConfig(
  locale: string,
  customMapping?: Record<string, string>,
): FlagConfig {
  const countryCode = getCountryCode(locale, customMapping);
  return {
    countryCode,
    alt: locale.toUpperCase(),
  };
}

/**
 * Get flag image URL from flagcdn.com.
 *
 * @param locale - Locale code
 * @param size - Width in pixels (default: 20)
 * @param customMapping - Optional custom locale-to-country mapping
 * @returns URL to flag PNG
 *
 * @example
 * ```tsx
 * <img src={getFlagUrl("sk")} alt="SK" />
 * <img src={getFlagUrl("en-US", 40)} alt="EN-US" />
 * <img src={getFlagUrl("en", 20, { en: "us" })} alt="EN" />
 * ```
 */
export function getFlagUrl(
  locale: string,
  size = 24,
  customMapping?: Record<string, string>,
): string {
  const { countryCode } = getFlagConfig(locale, customMapping);
  return `https://flagcdn.com/h${size}/${countryCode}.png`;
}
