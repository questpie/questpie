import { expect, test } from "bun:test";

import { expectPostgresMajor } from "../integration/postgres/helpers/postgres-major";

test("PostgreSQL evidence matches the exact CI-selected major", () => {
	expect(() => expectPostgresMajor(160_004, "16")).not.toThrow();
	expect(() => expectPostgresMajor("170009", "17")).not.toThrow();
	expect(() => expectPostgresMajor(180_001, "18")).not.toThrow();
});

test("PostgreSQL evidence rejects an actual server from another major", () => {
	expect(() => expectPostgresMajor(170_009, "16")).toThrow();
	expect(() => expectPostgresMajor(180_001, "17")).toThrow();
	expect(() => expectPostgresMajor(170_009, "18")).toThrow();
});

test.serial(
	"PostgreSQL evidence reads CI configuration and defaults only when unset",
	() => {
		const previous = process.env.QUESTPIE_POSTGRES_MAJOR;
		try {
			delete process.env.QUESTPIE_POSTGRES_MAJOR;
			expect(() => expectPostgresMajor(170_009)).not.toThrow();
			expect(() => expectPostgresMajor(160_004)).toThrow();
			process.env.QUESTPIE_POSTGRES_MAJOR = "18";
			expect(() => expectPostgresMajor(180_001)).not.toThrow();
			expect(() => expectPostgresMajor(170_009)).toThrow();
			process.env.QUESTPIE_POSTGRES_MAJOR = "";
			expect(() => expectPostgresMajor(170_009)).toThrow(
				"QUESTPIE_POSTGRES_MAJOR must be 16, 17, or 18 when set",
			);
		} finally {
			if (previous === undefined) delete process.env.QUESTPIE_POSTGRES_MAJOR;
			else process.env.QUESTPIE_POSTGRES_MAJOR = previous;
		}
	},
);

test("PostgreSQL evidence rejects invalid configured majors instead of defaulting", () => {
	for (const declared of [
		"",
		" 17",
		"17 ",
		"017",
		"17.0",
		"17x",
		"15",
		"19",
		"NaN",
		"Infinity",
	]) {
		expect(() => expectPostgresMajor(170_009, declared)).toThrow(
			"QUESTPIE_POSTGRES_MAJOR must be 16, 17, or 18 when set",
		);
	}
});
