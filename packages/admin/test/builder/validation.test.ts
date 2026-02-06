/**
 * Validation Schema Builder Tests
 *
 * Tests for createZod, buildValidationSchema, and nested field validation.
 */

import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { builtInFields } from "#questpie/admin/client/builder/defaults/fields";
import {
  buildValidationSchema as buildValidationSchemaBase,
  createFormSchema as createFormSchemaBase,
} from "#questpie/admin/client/builder/validation";

const buildValidationSchema = (fields: Record<string, any>) =>
  buildValidationSchemaBase(fields, builtInFields);

const createFormSchema = (fields: Record<string, any>) =>
  createFormSchemaBase(fields, builtInFields);

describe("buildValidationSchema", () => {
  describe("simple fields", () => {
    it("should generate schema for required text field", () => {
      const fields = {
        name: builtInFields.text.$options({ required: true }),
      };

      const schema = buildValidationSchema(fields);

      // Should pass
      expect(() => schema.parse({ name: "John" })).not.toThrow();

      // Should fail - empty string is still valid for z.string()
      expect(() => schema.parse({ name: "" })).not.toThrow();

      // Should fail - missing required field
      expect(() => schema.parse({})).toThrow();
    });

    it("should generate schema for optional text field", () => {
      const fields = {
        name: builtInFields.text.$options({ required: false }),
      };

      const schema = buildValidationSchema(fields);

      // Should pass with value
      expect(() => schema.parse({ name: "John" })).not.toThrow();

      // Should pass with null
      expect(() => schema.parse({ name: null })).not.toThrow();

      // Should pass with undefined
      expect(() => schema.parse({})).not.toThrow();
    });

    it("should apply maxLength constraint", () => {
      const fields = {
        name: builtInFields.text.$options({ required: true, maxLength: 5 }),
      };

      const schema = buildValidationSchema(fields);

      // Should pass
      expect(() => schema.parse({ name: "John" })).not.toThrow();

      // Should fail - too long
      expect(() => schema.parse({ name: "Jonathan" })).toThrow();
    });

    it("should generate schema for email field", () => {
      const fields = {
        email: builtInFields.email.$options({ required: true }),
      };

      const schema = buildValidationSchema(fields);

      // Should pass
      expect(() => schema.parse({ email: "test@example.com" })).not.toThrow();

      // Should fail - invalid email
      expect(() => schema.parse({ email: "not-an-email" })).toThrow();
    });

    it("should generate schema for number field with min/max", () => {
      const fields = {
        age: builtInFields.number.$options({
          required: true,
          min: 0,
          max: 120,
        }),
      };

      const schema = buildValidationSchema(fields);

      // Should pass
      expect(() => schema.parse({ age: 25 })).not.toThrow();

      // Should fail - too low
      expect(() => schema.parse({ age: -1 })).toThrow();

      // Should fail - too high
      expect(() => schema.parse({ age: 150 })).toThrow();
    });

    it("should generate schema for boolean field", () => {
      const fields = {
        active: builtInFields.boolean.$options({ required: true }),
      };

      const schema = buildValidationSchema(fields);

      // Should pass
      expect(() => schema.parse({ active: true })).not.toThrow();
      expect(() => schema.parse({ active: false })).not.toThrow();

      // Should fail - not boolean
      expect(() => schema.parse({ active: "yes" })).toThrow();
    });

    it("should generate schema for select field with options", () => {
      const fields = {
        status: builtInFields.select.$options({
          required: true,
          options: [
            { label: "Active", value: "active" },
            { label: "Inactive", value: "inactive" },
          ],
        }),
      };

      const schema = buildValidationSchema(fields);

      // Should pass
      expect(() => schema.parse({ status: "active" })).not.toThrow();
      expect(() => schema.parse({ status: "inactive" })).not.toThrow();

      // Should fail - invalid option
      expect(() => schema.parse({ status: "unknown" })).toThrow();
    });
  });

  describe("nested object fields", () => {
    it("should generate schema for simple nested object", () => {
      const fields = {
        address: builtInFields.object.$options({
          required: true,
          fields: ({ r }) => ({
            street: r.text({ required: true }),
            city: r.text({ required: true }),
            zip: r.text(),
          }),
        }),
      };

      const schema = buildValidationSchema(fields);

      // Should pass
      expect(() =>
        schema.parse({
          address: { street: "123 Main St", city: "NYC", zip: "10001" },
        }),
      ).not.toThrow();

      // Should pass - zip is optional
      expect(() =>
        schema.parse({
          address: { street: "123 Main St", city: "NYC" },
        }),
      ).not.toThrow();

      // Should fail - missing required city
      expect(() =>
        schema.parse({
          address: { street: "123 Main St" },
        }),
      ).toThrow();
    });

    it("should generate schema for deeply nested objects", () => {
      const fields = {
        company: builtInFields.object.$options({
          required: true,
          fields: ({ r }) => ({
            name: r.text({ required: true }),
            headquarters: r.object({
              required: true,
              fields: ({ r }) => ({
                country: r.text({ required: true }),
                address: r.object({
                  fields: ({ r }) => ({
                    street: r.text({ required: true }),
                    city: r.text({ required: true }),
                  }),
                }),
              }),
            }),
          }),
        }),
      };

      const schema = buildValidationSchema(fields);

      // Should pass
      expect(() =>
        schema.parse({
          company: {
            name: "Acme Inc",
            headquarters: {
              country: "USA",
              address: {
                street: "123 Main St",
                city: "NYC",
              },
            },
          },
        }),
      ).not.toThrow();

      // Should fail - missing nested required field
      expect(() =>
        schema.parse({
          company: {
            name: "Acme Inc",
            headquarters: {
              country: "USA",
              address: {
                street: "123 Main St",
                // missing city
              },
            },
          },
        }),
      ).toThrow();
    });

    it("should handle optional nested objects", () => {
      const fields = {
        profile: builtInFields.object.$options({
          // not required
          fields: ({ r }) => ({
            bio: r.text(),
            website: r.text(),
          }),
        }),
      };

      const schema = buildValidationSchema(fields);

      // Should pass with value
      expect(() =>
        schema.parse({
          profile: { bio: "Hello", website: "https://example.com" },
        }),
      ).not.toThrow();

      // Should pass with null
      expect(() => schema.parse({ profile: null })).not.toThrow();

      // Should pass without the field
      expect(() => schema.parse({})).not.toThrow();
    });
  });

  describe("array fields", () => {
    it("should generate schema for primitive array", () => {
      const fields = {
        tags: builtInFields.array.$options({
          required: true,
          itemType: "text",
        }),
      };

      const schema = buildValidationSchema(fields);

      // Should pass
      expect(() => schema.parse({ tags: ["a", "b", "c"] })).not.toThrow();

      // Should pass - empty array
      expect(() => schema.parse({ tags: [] })).not.toThrow();

      // Should fail - not array
      expect(() => schema.parse({ tags: "not-array" })).toThrow();
    });

    it("should apply minItems/maxItems constraints", () => {
      const fields = {
        items: builtInFields.array.$options({
          required: true,
          itemType: "text",
          minItems: 1,
          maxItems: 3,
        }),
      };

      const schema = buildValidationSchema(fields);

      // Should pass
      expect(() => schema.parse({ items: ["a"] })).not.toThrow();
      expect(() => schema.parse({ items: ["a", "b", "c"] })).not.toThrow();

      // Should fail - too few
      expect(() => schema.parse({ items: [] })).toThrow();

      // Should fail - too many
      expect(() => schema.parse({ items: ["a", "b", "c", "d"] })).toThrow();
    });

    it("should generate schema for array of objects", () => {
      const fields = {
        contacts: builtInFields.array.$options({
          required: true,
          item: ({ r }) => ({
            name: r.text({ required: true }),
            email: r.email({ required: true }),
            phone: r.text(),
          }),
        }),
      };

      const schema = buildValidationSchema(fields);

      // Should pass
      expect(() =>
        schema.parse({
          contacts: [
            { name: "John", email: "john@example.com", phone: "123" },
            { name: "Jane", email: "jane@example.com" },
          ],
        }),
      ).not.toThrow();

      // Should fail - invalid email in item
      expect(() =>
        schema.parse({
          contacts: [{ name: "John", email: "not-an-email" }],
        }),
      ).toThrow();

      // Should fail - missing required field in item
      expect(() =>
        schema.parse({
          contacts: [
            { email: "john@example.com" }, // missing name
          ],
        }),
      ).toThrow();
    });

    it("should generate schema for nested arrays with objects", () => {
      const fields = {
        departments: builtInFields.array.$options({
          required: true,
          item: ({ r }) => ({
            name: r.text({ required: true }),
            employees: r.array({
              required: true,
              item: ({ r }) => ({
                firstName: r.text({ required: true }),
                lastName: r.text({ required: true }),
              }),
            }),
          }),
        }),
      };

      const schema = buildValidationSchema(fields);

      // Should pass
      expect(() =>
        schema.parse({
          departments: [
            {
              name: "Engineering",
              employees: [
                { firstName: "John", lastName: "Doe" },
                { firstName: "Jane", lastName: "Smith" },
              ],
            },
          ],
        }),
      ).not.toThrow();

      // Should fail - missing lastName in nested employee
      expect(() =>
        schema.parse({
          departments: [
            {
              name: "Engineering",
              employees: [
                { firstName: "John" }, // missing lastName
              ],
            },
          ],
        }),
      ).toThrow();
    });
  });

  describe("relation fields", () => {
    it("should generate schema for single relation", () => {
      const fields = {
        authorId: builtInFields.relation.$options({
          required: true,
          targetCollection: "users",
          type: "single",
        }),
      };

      const schema = buildValidationSchema(fields);

      // Should pass
      expect(() => schema.parse({ authorId: "user-123" })).not.toThrow();

      // Should fail - missing required
      expect(() => schema.parse({})).toThrow();
    });

    it("should generate schema for multiple relation", () => {
      const fields = {
        tagIds: builtInFields.relation.$options({
          required: true,
          targetCollection: "tags",
          type: "multiple",
          maxItems: 5,
        }),
      };

      const schema = buildValidationSchema(fields);

      // Should pass
      expect(() => schema.parse({ tagIds: ["tag-1", "tag-2"] })).not.toThrow();

      // Should fail - too many items
      expect(() =>
        schema.parse({
          tagIds: ["1", "2", "3", "4", "5", "6"],
        }),
      ).toThrow();
    });
  });

  describe("upload fields", () => {
    it("should generate schema for single upload", () => {
      const fields = {
        avatar: builtInFields.upload.$options({ required: true }),
      };

      const schema = buildValidationSchema(fields);

      // Should pass - asset ID as string
      expect(() => schema.parse({ avatar: "asset-123" })).not.toThrow();

      // Should fail - missing required
      expect(() => schema.parse({})).toThrow();
    });

    it("should generate schema for multiple uploads", () => {
      const fields = {
        gallery: builtInFields.upload.$options({
          required: true,
          multiple: true,
        }),
      };

      const schema = buildValidationSchema(fields);

      // Should pass
      expect(() =>
        schema.parse({
          gallery: ["asset-1", "asset-2", "asset-3"],
        }),
      ).not.toThrow();

      // Should fail - not strings
      expect(() => schema.parse({ gallery: [1, 2, 3] })).toThrow();
    });
  });

  describe("createFormSchema", () => {
    it("should create schema with custom validators", () => {
      const fields = {
        password: builtInFields.text.$options({
          required: true,
          validation: {
            validate: (value, formValues) => {
              if (value && value.length < 8) {
                return "Password must be at least 8 characters";
              }
              return undefined;
            },
          },
        }),
      };

      const schema = createFormSchema(fields);

      // Should pass
      expect(() => schema.parse({ password: "longpassword123" })).not.toThrow();

      // Should fail - custom validator
      expect(() => schema.parse({ password: "short" })).toThrow();
    });

    it("should support cross-field validation", () => {
      const fields = {
        password: builtInFields.text.$options({ required: true }),
        confirmPassword: builtInFields.text.$options({
          required: true,
          validation: {
            validate: (value, formValues) => {
              if (value !== formValues.password) {
                return "Passwords must match";
              }
              return undefined;
            },
          },
        }),
      };

      const schema = createFormSchema(fields);

      // Should pass
      expect(() =>
        schema.parse({
          password: "secret123",
          confirmPassword: "secret123",
        }),
      ).not.toThrow();

      // Should fail - passwords don't match
      expect(() =>
        schema.parse({
          password: "secret123",
          confirmPassword: "different",
        }),
      ).toThrow();
    });
  });

  describe("complex real-world scenarios", () => {
    it("should handle barbershop appointment form", () => {
      const fields = {
        customerId: builtInFields.relation.$options({
          required: true,
          targetCollection: "customers",
          type: "single",
        }),
        barberId: builtInFields.relation.$options({
          required: true,
          targetCollection: "barbers",
          type: "single",
        }),
        services: builtInFields.array.$options({
          required: true,
          minItems: 1,
          item: ({ r }) => ({
            serviceId: r.relation({
              required: true,
              targetCollection: "services",
              type: "single",
            }),
            price: r.number({ required: true, min: 0 }),
          }),
        }),
        scheduledAt: builtInFields.datetime.$options({ required: true }),
        notes: builtInFields.textarea.$options({ maxLength: 500 }),
      };

      const schema = buildValidationSchema(fields);

      // Should pass
      expect(() =>
        schema.parse({
          customerId: "cust-1",
          barberId: "barber-1",
          services: [
            { serviceId: "service-1", price: 25 },
            { serviceId: "service-2", price: 15 },
          ],
          scheduledAt: new Date(),
          notes: "Please be on time",
        }),
      ).not.toThrow();

      // Should fail - no services
      expect(() =>
        schema.parse({
          customerId: "cust-1",
          barberId: "barber-1",
          services: [],
          scheduledAt: new Date(),
        }),
      ).toThrow();

      // Should fail - negative price
      expect(() =>
        schema.parse({
          customerId: "cust-1",
          barberId: "barber-1",
          services: [{ serviceId: "service-1", price: -10 }],
          scheduledAt: new Date(),
        }),
      ).toThrow();
    });

    it("should handle working hours configuration", () => {
      const daySchedule = ({ r }: any) => ({
        isOpen: r.boolean({ required: true }),
        openTime: r.text(),
        closeTime: r.text(),
        breaks: r.array({
          item: ({ r }: any) => ({
            start: r.text({ required: true }),
            end: r.text({ required: true }),
          }),
        }),
      });

      const fields = {
        workingHours: builtInFields.object.$options({
          required: true,
          fields: ({ r }) => ({
            monday: r.object({ fields: daySchedule }),
            tuesday: r.object({ fields: daySchedule }),
            wednesday: r.object({ fields: daySchedule }),
            thursday: r.object({ fields: daySchedule }),
            friday: r.object({ fields: daySchedule }),
            saturday: r.object({ fields: daySchedule }),
            sunday: r.object({ fields: daySchedule }),
          }),
        }),
      };

      const schema = buildValidationSchema(fields);

      // Should pass
      expect(() =>
        schema.parse({
          workingHours: {
            monday: {
              isOpen: true,
              openTime: "09:00",
              closeTime: "17:00",
              breaks: [{ start: "12:00", end: "13:00" }],
            },
            tuesday: { isOpen: true, openTime: "09:00", closeTime: "17:00" },
            wednesday: { isOpen: true, openTime: "09:00", closeTime: "17:00" },
            thursday: { isOpen: true, openTime: "09:00", closeTime: "17:00" },
            friday: { isOpen: true, openTime: "09:00", closeTime: "17:00" },
            saturday: { isOpen: false },
            sunday: { isOpen: false },
          },
        }),
      ).not.toThrow();
    });
  });
});
