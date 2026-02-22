/**
 * Type Test Utilities
 *
 * These utilities are used for compile-time type assertions.
 * If any assertion fails, TypeScript compilation will fail.
 *
 * Usage:
 * type _ = Expect<Equal<ActualType, ExpectedType>>;
 */

/**
 * Asserts that T is true at compile time.
 * If T is not true, this will cause a type error.
 */
export type Expect<T extends true> = T;

/**
 * Checks if two types are exactly equal.
 * Uses a technique that catches edge cases like distributive conditional types.
 */
export type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;

/**
 * Checks if A is assignable to B (A extends B).
 */
export type Extends<A, B> = A extends B ? true : false;

/**
 * Checks if type is `never`.
 * Uses tuple wrapping to avoid distribution.
 */
export type IsNever<T> = [T] extends [never] ? true : false;

/**
 * Checks if type is `any`.
 * Exploits that `any` is both a subtype and supertype of all types.
 */
export type IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * Checks if type is `unknown`.
 */
export type IsUnknown<T> =
	IsAny<T> extends true ? false : unknown extends T ? true : false;

/**
 * Gets keys of T that are required (non-optional).
 */
export type RequiredKeys<T> = {
	[K in keyof T]-?: {} extends Pick<T, K> ? never : K;
}[keyof T];

/**
 * Gets keys of T that are optional.
 */
export type OptionalKeys<T> = {
	[K in keyof T]-?: {} extends Pick<T, K> ? K : never;
}[keyof T];

/**
 * Checks if a key is required in T.
 */
export type IsRequired<T, K extends keyof T> = K extends RequiredKeys<T>
	? true
	: false;

/**
 * Checks if a key is optional in T.
 */
export type IsOptional<T, K extends keyof T> = K extends OptionalKeys<T>
	? true
	: false;

/**
 * Checks if type T has key K.
 */
export type HasKey<T, K> = K extends keyof T ? true : false;

/**
 * Checks if type T is a literal type (not widened).
 */
export type IsLiteral<T> = T extends string
	? string extends T
		? false
		: true
	: T extends number
		? number extends T
			? false
			: true
		: T extends boolean
			? boolean extends T
				? false
				: true
			: false;

/**
 * Checks if type T is nullable (includes null or undefined).
 */
export type IsNullable<T> = null extends T
	? true
	: undefined extends T
		? true
		: false;

/**
 * Checks if type T is an array type.
 */
export type IsArray<T> = T extends readonly any[] ? true : false;

/**
 * Checks if type T is a function type.
 */
export type IsFunction<T> = T extends (...args: any[]) => any ? true : false;

/**
 * Checks if type T is an object type (not array, not function).
 */
export type IsObject<T> = T extends object
	? T extends readonly any[]
		? false
		: T extends (...args: any[]) => any
			? false
			: true
	: false;

/**
 * Extracts the element type from an array type.
 */
export type ArrayElement<T> = T extends readonly (infer E)[] ? E : never;

/**
 * Extracts the return type, unwrapping Promise if async.
 */
export type UnwrapReturn<T extends (...args: any[]) => any> = Awaited<
	ReturnType<T>
>;

/**
 * Counts the number of keys in a type.
 * Note: This is approximate and works for simple object types.
 */
export type KeyCount<T> = keyof T extends never
	? 0
	: [keyof T] extends [infer K]
		? K extends any
			? 1
			: never
		: never;

/**
 * Checks if two types have the same keys.
 */
export type SameKeys<A, B> = Equal<keyof A, keyof B>;

/**
 * Type-level assertion that will fail compilation if condition is false.
 * Usage: const _: AssertTrue<Condition> = true;
 */
export type AssertTrue<T extends true> = T;

/**
 * Type-level assertion that will fail compilation if condition is true.
 * Usage: const _: AssertFalse<Condition> = false;
 */
export type AssertFalse<T extends false> = T;

/**
 * Prettier type display - expands type for better IDE hover info.
 */
export type Prettify<T> = {
	[K in keyof T]: T[K];
} & {};

/**
 * Deep prettify - expands nested types.
 */
export type DeepPrettify<T> = {
	[K in keyof T]: T[K] extends object
		? T[K] extends (...args: any[]) => any
			? T[K]
			: DeepPrettify<T[K]>
		: T[K];
} & {};

/**
 * NOT operation for type booleans.
 */
export type Not<T extends boolean> = T extends true ? false : true;

/**
 * AND operation for type booleans.
 */
export type And<A extends boolean, B extends boolean> = A extends true
	? B extends true
		? true
		: false
	: false;

/**
 * OR operation for type booleans.
 */
export type Or<A extends boolean, B extends boolean> = A extends true
	? true
	: B extends true
		? true
		: false;

/**
 * Debug helper - use this to inspect types in IDE.
 * Hover over _debug to see the resolved type.
 */
export type Debug<T> = { _debug: T };
