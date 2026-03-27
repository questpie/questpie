import { describe, expect, it } from "bun:test";

import { z } from "zod";

import {
	email,
	type EmailTemplateDefinition,
	type InferEmailTemplateInput,
	type InferEmailTemplateContext,
	type EmailResult,
	type EmailHandlerArgs,
} from "../../../src/server/integrated/mailer/template.js";

describe("email() factory", () => {
	it("returns the definition unchanged", () => {
		const def = email({
			name: "test-email",
			schema: z.object({ name: z.string() }),
			handler: ({ input }) => ({
				subject: `Hello ${input.name}`,
				html: `<h1>Hello ${input.name}</h1>`,
			}),
		});

		expect(def.name).toBe("test-email");
		expect(def.schema).toBeDefined();
		expect(typeof def.handler).toBe("function");
	});

	it("handler receives input and returns EmailResult", () => {
		const def = email({
			name: "sync-template",
			schema: z.object({ greeting: z.string() }),
			handler: ({ input }) => ({
				subject: input.greeting,
				html: `<p>${input.greeting}</p>`,
			}),
		});

		const result = def.handler({ input: { greeting: "Hi!" } } as any);
		expect(result).toEqual({
			subject: "Hi!",
			html: "<p>Hi!</p>",
		});
	});

	it("handler can be async", async () => {
		const def = email({
			name: "async-template",
			schema: z.object({ userId: z.string() }),
			handler: async ({ input }) => {
				// Simulate async operation
				await Promise.resolve();
				return {
					subject: `User ${input.userId}`,
					html: `<p>User: ${input.userId}</p>`,
				};
			},
		});

		const result = await def.handler({ input: { userId: "abc" } } as any);
		expect(result.subject).toBe("User abc");
		expect(result.html).toBe("<p>User: abc</p>");
	});

	it("handler can return optional text", () => {
		const def = email({
			name: "with-text",
			schema: z.object({ msg: z.string() }),
			handler: ({ input }) => ({
				subject: "Test",
				html: `<p>${input.msg}</p>`,
				text: input.msg,
			}),
		});

		const result = def.handler({
			input: { msg: "plain" },
		} as any) as EmailResult;
		expect(result.text).toBe("plain");
	});

	it("preserves type inference for InferEmailTemplateInput", () => {
		const def = email({
			name: "typed",
			schema: z.object({
				name: z.string(),
				age: z.number(),
			}),
			handler: ({ input }) => ({
				subject: input.name,
				html: `<p>${input.name} (${input.age})</p>`,
			}),
		});

		// Type-level test: InferEmailTemplateInput should extract the input type
		type Input = InferEmailTemplateInput<typeof def>;
		const testInput: Input = { name: "test", age: 25 };
		expect(testInput).toBeDefined();
	});

	it("InferEmailTemplateContext is a backward-compat alias", () => {
		const def = email({
			name: "compat",
			schema: z.object({ x: z.string() }),
			handler: ({ input }) => ({
				subject: input.x,
				html: `<p>${input.x}</p>`,
			}),
		});

		// Both should resolve to the same type
		type ViaInput = InferEmailTemplateInput<typeof def>;
		type ViaContext = InferEmailTemplateContext<typeof def>;
		const a: ViaInput = { x: "test" };
		const b: ViaContext = a; // should be assignable
		expect(b).toBe(a);
	});
});
