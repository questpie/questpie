/**
 * Collection Definition Helper
 */

import { CollectionBuilder } from "./collection-builder";

export function collection(name: string) {
  return new CollectionBuilder({
    name,
    "~adminApp": undefined as any, // Will be set via .use()
  } as const);
}
