/**
 * Global Builder
 *
 * For configuring UI for a backend global.
 * Single generic TState pattern with ~adminApp for type safety.
 */

import type { SetProperty } from "questpie/shared";
import type { ComponentReference } from "#questpie/admin/server";
import type { I18nText } from "../../i18n/types.js";
import type { AdminBuilder } from "../admin-builder";
import type { IconComponent } from "../types/common";
import type { GlobalBuilderState } from "../types/global-types";

export class GlobalBuilder<TState extends GlobalBuilderState> {
  constructor(public readonly state: TState) {}

  /**
   * Merge admin module into state
   */
  use<TAdminApp extends AdminBuilder<any>>(
    adminApp: TAdminApp,
  ): GlobalBuilder<SetProperty<TState, "~adminApp", TAdminApp>> {
    return new GlobalBuilder({
      ...this.state,
      "~adminApp": adminApp,
    } as any);
  }

  /**
   * Set global metadata
   */
  meta(meta: {
    label?: I18nText;
    icon?: IconComponent | ComponentReference;
    description?: I18nText;
  }): GlobalBuilder<TState> {
    return new GlobalBuilder({
      ...this.state,
      ...meta,
    } as any);
  }
}
