/**
 * Page Builder
 *
 * Defines custom admin pages outside of collections/globals.
 */

import type { SetProperty } from "questpie/shared";
import type { MaybeLazyComponent } from "../types/common";

export interface PageDefinition<TName extends string = string> {
  readonly name: TName;
  readonly component: any;
  readonly path?: string;
}

export interface PageBuilderState {
  readonly name: string;
  readonly component: any;
  readonly path?: string;
  readonly showInNav?: boolean;
}

export class PageBuilder<TState extends PageBuilderState> {
  constructor(public readonly state: TState) {}

  path(path: string): PageBuilder<SetProperty<TState, "path", string>> {
    return new PageBuilder({
      ...this.state,
      path,
    } as any);
  }
}

/**
 * Create a custom page
 */
export function page<
  TName extends string,
  TComponent extends MaybeLazyComponent,
>(
  name: TName,
  config: { component: TComponent; showInNav?: boolean },
): PageBuilder<{
  name: TName;
  component: TComponent;
  path: undefined;
  showInNav: boolean | undefined;
}> {
  return new PageBuilder({
    name,
    component: config.component,
    path: undefined,
    showInNav: config.showInNav,
  } as any);
}
