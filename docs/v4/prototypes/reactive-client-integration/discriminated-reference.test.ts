import { expect, test } from "bun:test";

import {
	type DiscriminatedValue,
	matchDiscriminated,
} from "./discriminated-reference";

type Subject = DiscriminatedValue<{
	message: { id: string; channelId: string };
	space: { id: string };
}>;

const message = Object.freeze({
	kind: "message" as const,
	id: "message:one",
	channelId: "channel:one",
}) satisfies Subject;

// @ts-expect-error a message subject requires its exact channel member
const malformed: Subject = { kind: "message", id: "message:one" };
void malformed;

test("matches every discriminated reference value exhaustively", () => {
	const label = matchDiscriminated<Subject, string>(message, {
		message: (value) => `${value.channelId}/${value.id}`,
		space: (value) => value.id,
	});
	expect(label).toBe("channel:one/message:one");
});

test("remains an ordinary value without Relation behavior", () => {
	expect(Object.keys(message).sort()).toEqual(["channelId", "id", "kind"]);
	expect(message).not.toHaveProperty("relation");
	expect(message).not.toHaveProperty("policy");
	expect(message).not.toHaveProperty("watch");
});
