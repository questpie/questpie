/**
 * Auth options merging utilities.
 * Separated from config.ts to avoid circular dependencies.
 */

import { dedupeBy, deepMerge } from "#questpie/shared/index.js";
import type { BetterAuthOptions } from "better-auth";

/**
 * Type-safe helper to define Better Auth options
 */
export function auth<O extends BetterAuthOptions>(options: O): O {
  return options;
}

export type MergeAuthOptions<
  A extends BetterAuthOptions,
  B extends BetterAuthOptions,
> = {
  [K in keyof A | keyof B]: K extends "plugins"
    ? [
        ...(B extends { plugins: Array<infer BP> } ? BP[] : []),
        ...(A extends { plugins: Array<infer AP> } ? AP[] : []),
      ]
    : K extends keyof B
      ? B[K]
      : K extends keyof A
        ? A[K]
        : never;
};

export function mergeAuthOptions<
  A extends BetterAuthOptions,
  B extends BetterAuthOptions,
>(base: A, overrides: B): MergeAuthOptions<A, B> {
  // Separate plugins and socialProviders to avoid cloning issues
  const {
    plugins: basePlugins,
    socialProviders: baseSocialProviders,
    ...baseRest
  } = base || {};
  const {
    plugins: overridePlugins,
    socialProviders: overrideSocialProviders,
    ...overridesRest
  } = overrides || {};

  const merged = {
    // we deepmerge all except plugins and socialProviders
    ...deepMerge(baseRest, overridesRest),
    // merge plugins, newer plugins take precedence
    plugins: dedupeBy(
      [...(overridePlugins || []), ...(basePlugins || [])],
      (plugin) => plugin.id,
    ),
    // social providers are merged shallowly
    socialProviders: {
      ...baseSocialProviders,
      ...overrideSocialProviders,
    },
  } as any;

  return merged;
}
