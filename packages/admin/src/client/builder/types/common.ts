/**
 * Common Types and Helpers for Builders
 */

import type * as React from "react";
import type { I18nText } from "../../i18n/types.js";

/**
 * Dynamic I18n text resolver (supports functions based on form values)
 */
export type DynamicI18nText =
  | I18nText
  | ((values: Record<string, any>) => I18nText);

/**
 * Component that can be lazy-loaded or direct
 * Supports React.lazy, dynamic imports, and direct components
 */
export type MaybeLazyComponent<TProps = any> =
  | React.LazyExoticComponent<React.ComponentType<TProps>>
  | (() => Promise<{ default: React.ComponentType<TProps> }>)
  | React.ComponentType<TProps>;

/**
 * Icon component type
 * Icons are always synchronous - no lazy loading needed for small SVGs
 */
export type IconComponent = React.ComponentType<
  React.SVGProps<SVGSVGElement> & { className?: string }
>;

/**
 * Base field props that are provided by the form (runtime)
 * These should be omitted when inferring field options from component props
 */
export type BaseFieldProps = {
  name: string;
  value: any;
  onChange?: (value: any) => void; // Optional in preview mode
  onBlur: () => void;
  disabled?: boolean;
  readOnly?: boolean;
  error?: string;
  label?: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  localized?: boolean;
  locale?: string;
  control?: any;
  className?: string;
};

/**
 * Base field props for builder config (supports I18nText)
 * These are resolved to plain strings at runtime before passing to components
 */
export type BaseFieldConfigProps = {
  /** Field label - supports inline translations and dynamic resolvers */
  label?: DynamicI18nText;
  /** Field description - supports inline translations and dynamic resolvers */
  description?: DynamicI18nText;
  /** Field placeholder - supports inline translations and dynamic resolvers */
  placeholder?: DynamicI18nText;
  required?: boolean;
};
