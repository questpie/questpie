/**
 * Global Builder Types
 */

import type { ComponentReference } from "#questpie/admin/server";
import type { I18nText } from "../../i18n/types.js";
import type { AdminBuilder } from "../admin-builder";
import type { IconComponent } from "./common";

/**
 * Global metadata for navigation and display
 */
export interface GlobalMeta {
  /** Display label - supports inline translations */
  label?: I18nText;
  /** Description - supports inline translations */
  description?: I18nText;
  icon?: IconComponent | ComponentReference | string;
  group?: string;
  order?: number;
  hidden?: boolean;
}

export interface GlobalConfig<TApp = any> {
  /**
   * Global metadata (for navigation/display)
   */
  meta?: GlobalMeta;

  /**
   * Display label - supports inline translations
   */
  label?: I18nText;

  /**
   * Description - supports inline translations
   */
  description?: I18nText;

  /**
   * Icon
   */
  icon?: IconComponent | ComponentReference | string;

  /**
   * Field configurations
   */
  fields?: Record<string, any>;

  /**
   * Form view configuration
   */
  form?: any;

  /**
   * Navigation group
   */
  group?: string;

  /**
   * Sort order
   */
  order?: number;

  /**
   * Hide from navigation
   */
  hidden?: boolean;
}

export interface GlobalBuilderState<
  TAdminApp extends AdminBuilder<any> = AdminBuilder<any>,
> {
  readonly name: string;
  readonly "~adminApp": TAdminApp;
  /** Display label - supports inline translations */
  readonly label?: I18nText;
  /** Description - supports inline translations */
  readonly description?: I18nText;
  readonly icon?: IconComponent | ComponentReference;
  readonly fields?: Record<string, any>;
  readonly form?: any;
}
