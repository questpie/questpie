/**
 * Global Definition Helper
 */

import { GlobalBuilder } from "./global-builder";

export function global(name: string) {
  return new GlobalBuilder({
    name,
    "~adminApp": undefined as any, // Will be set via .use()
  } as const);
}
