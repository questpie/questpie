/*
 * This source runs inside the compiler's controlled evaluator. Keeping the
 * callback execution there ensures authored Policy and dataQuery functions do
 * not escape the structural sandbox.
 */
export const relationalDiscoverySource = String.raw`
const relationalCollections = new Map();
for (const record of records) for (const value of Object.values(record.exports)) {
  if (value?.__questpie?.category === "definition" && value.__questpie.resourceKind === "collection")
    relationalCollections.set(value.name, value);
}

const collectionIdentity = (collection) => "collection:" + collection.name;
const fieldIdentity = (collection, name) => collectionIdentity(collection) + "/field:" + name;
const fieldCodec = (field) => {
  if (field.scalar === "text") return { kind: "text", minLength: field.options?.minLength ?? null, maxLength: field.options?.maxLength ?? null, collation: "questpie.binary" };
  if (field.scalar === "integer") return { kind: "integer", minimum: field.options?.minimum ?? null, maximum: field.options?.maximum ?? null };
  if (field.scalar === "bigint") return { kind: "bigint", minimum: field.options?.minimum ?? null, maximum: field.options?.maximum ?? null };
  if (field.scalar === "numeric") return { kind: "numeric", precision: field.options.precision, scale: field.options.scale };
  if (field.scalar === "timestamp") return { kind: "timestamp", withTimezone: field.options?.withTimezone === true };
  return { kind: field.scalar };
};
const literalCodec = (value, fallback) => fallback ?? (typeof value === "boolean" ? "boolean" : typeof value === "number" ? "integer" : "text");

function compilePolicy(value) {
  const body = value.body;
  const scopes = [];
  let nextScope = 0;
  const ensureRootScope = (scope) => {
    if (!scopes.some((item) => item.scope === scope))
      scopes.push({ scope, collection: value.target, parentScope: null });
  };
  const executionOperand = (source, path, codec) => ({ kind: "executionFact", source, path, codec });
  const literalOperand = (candidate, codec) => ({ kind: "literal", codec: literalCodec(candidate, codec), value: candidate });
  const operand = (candidate, codec) => candidate?.__policyOperand ?? literalOperand(candidate, codec);
  const makeOperand = (scope, collection, name, field) => {
    const canonical = { kind: "field", scope, collection: collectionIdentity(collection), path: [name], codec: field.scalar };
    return {
      __policyOperand: canonical,
      equal: (right) => ({ kind: "equal", left: canonical, right: operand(right, field.scalar) }),
      notEqual: (right) => ({ kind: "notEqual", left: canonical, right: operand(right, field.scalar) }),
      in: (values) => ({ kind: "in", operand: canonical, values: values.map((item) => literalOperand(item, field.scalar)) }),
      isNull: () => ({ kind: "equal", left: canonical, right: literalOperand(null, field.scalar) }),
    };
  };
  const executionScope = () => ({
    principal: {
      id: { __policyOperand: executionOperand("principal", ["id"], "uuid"), equal(right) { return { kind: "equal", left: this.__policyOperand, right: operand(right, "uuid") }; }, notEqual(right) { return { kind: "notEqual", left: this.__policyOperand, right: operand(right, "uuid") }; }, in(values) { return { kind: "in", operand: this.__policyOperand, values: values.map((item) => literalOperand(item, "uuid")) }; } },
      kind: { __policyOperand: executionOperand("principal", ["kind"], "text"), equal(right) { return { kind: "equal", left: this.__policyOperand, right: operand(right, "text") }; }, notEqual(right) { return { kind: "notEqual", left: this.__policyOperand, right: operand(right, "text") }; }, in(values) { return { kind: "in", operand: this.__policyOperand, values: values.map((item) => literalOperand(item, "text")) }; } },
    },
    tenant: { id: { __policyOperand: executionOperand("tenant", ["id"], "uuid"), equal(right) { return { kind: "equal", left: this.__policyOperand, right: operand(right, "uuid") }; }, notEqual(right) { return { kind: "notEqual", left: this.__policyOperand, right: operand(right, "uuid") }; }, in(values) { return { kind: "in", operand: this.__policyOperand, values: values.map((item) => literalOperand(item, "uuid")) }; } } },
    authority: {
      isOrdinary: () => ({ kind: "equal", left: executionOperand("authority", ["kind"], "authority"), right: literalOperand("ordinary", "authority") }),
      isSystem: () => ({ kind: "equal", left: executionOperand("authority", ["kind"], "authority"), right: literalOperand("system", "authority") }),
    },
  });
  const fieldsFor = (collection, scope) => Object.fromEntries(Object.entries(collection.fields).map(([name, field]) => [name, makeOperand(scope, collection, name, field)]));
  const makeScope = (collection, bindings) => ({
    ...executionScope(),
    ...Object.fromEntries(Object.entries(bindings).map(([name, scope]) => [name, fieldsFor(collection, scope)])),
  });
  const expression = (candidate, parentScope) => {
    if (!candidate || typeof candidate !== "object") throw new Error("QP-POLICY invalid expression");
    if (candidate.kind !== "booleanExpression") return candidate;
    const operator = candidate.operator;
    const operands = candidate.operands ?? [];
    if (operator === "and" || operator === "or") return { kind: operator, items: operands.map((item) => expression(item, parentScope)) };
    if (operator === "not") return { kind: "not", expression: expression(operands[0], parentScope) };
    if (operator === "always") return { kind: "constant", value: true };
    if (operator === "exists") {
      const collection = operands[0];
      const predicate = operands[1];
      const scope = "evidence" + nextScope++;
      scopes.push({ scope, collection: collectionIdentity(collection), parentScope });
      return { kind: "exists", collection: collectionIdentity(collection), scope, semantics: "policyEvidenceBooleanOnly", targetDisclosurePolicy: "notApplied", predicate: expression(predicate(makeScope(collection, { row: scope })), scope) };
    }
    throw new Error("QP-DATA-005 unknownOperator " + String(operator));
  };
  const admission = (candidate) => {
    if (candidate?.operator === "authenticated") return { kind: "authenticated" };
    if (candidate?.operator === "public") return { kind: "public" };
    throw new Error("QP-POLICY unsupported admission");
  };
  const rootCollection = relationalCollections.get(value.target.slice("collection:".length));
  const operations = {};
  if (body.read) {
    ensureRootScope("row");
    const rows = body.read.rows;
    const rootRows = rows?.kind === "policyRows"
      ? expression(rows.predicate(makeScope(rows.collection, { row: "row" })), "row")
      : expression(typeof rows === "function" ? rows(makeScope(rootCollection, { row: "row" })) : rows, "row");
    operations.read = { admission: admission(body.read.admit), rows: rootRows };
  }
  if (body.create) {
    ensureRootScope("candidate");
    operations.create = {
      admission: admission(body.create.admit),
      candidate: expression(body.create.candidate(makeScope(rootCollection, { candidate: "candidate" })), "candidate"),
    };
  }
  if (body.update) {
    ensureRootScope("current");
    ensureRootScope("candidate");
    operations.update = {
      admission: admission(body.update.admit),
      current: expression(body.update.rows(makeScope(rootCollection, { current: "current" })), "current"),
      candidate: expression(body.update.candidate(makeScope(rootCollection, { current: "current", candidate: "candidate" })), "candidate"),
    };
  }
  if (body.delete) {
    ensureRootScope("current");
    operations.delete = {
      admission: admission(body.delete.admit),
      current: expression(body.delete.rows(makeScope(rootCollection, { current: "current" })), "current"),
    };
  }
  if (body.fields?.output) ensureRootScope("row");
  if (body.fields?.create) ensureRootScope("candidate");
  if (body.fields?.update) {
    ensureRootScope("current");
    ensureRootScope("candidate");
  }
  const selectedOutput = body.fields?.output
    ? Object.entries(body.fields.output(makeScope(rootCollection, { row: "row" })))
        .map(([name, when]) => ({ path: [name], when: expression(when, "row"), deniedEncoding: "omitProperty" }))
    : [];
  const callerInput = { suppliedPathsOnly: true };
  if (body.fields?.create) callerInput.create = Object.entries(body.fields.create(makeScope(rootCollection, { candidate: "candidate" })))
    .map(([name, when]) => ({ path: [name], when: expression(when, "candidate") }));
  if (body.fields?.update) callerInput.update = Object.entries(body.fields.update(makeScope(rootCollection, { current: "current", candidate: "candidate" })))
    .map(([name, when]) => ({ path: [name], when: expression(when, "candidate") }));
  return {
    program: {
      identity: value.identity,
      target: value.target,
      attachment: { kind: "default", requiredForNormalDataAccess: true },
      operations,
      ...((selectedOutput.length || callerInput.create || callerInput.update) ? { fields: { callerInput, selectedOutput } } : {}),
    },
    scopes,
  };
}

function compileDataQuery(value) {
  const template = value.template;
  const collection = relationalCollections.get(template.from);
  if (!collection) throw new Error("QP-DATA unknown Collection " + template.from);
  const parameterNames = new Map(Object.entries(template.parameters).map(([name, parameter]) => [parameter, name]));
  const parameterOperand = (parameter) => ({ kind: "parameter", parameter: parameterNames.get(parameter) });
  const makeFields = (owner) => Object.fromEntries(Object.entries(owner.fields).map(([name, field]) => {
      const identity = fieldIdentity(owner, name);
      const scalar = (kind, right) => ({ kind, field: identity, operand: parameterNames.has(right) ? parameterOperand(right) : { kind: "literal", codec: fieldCodec(field), value: right } });
      return [name, {
        __queryField: identity,
        kind: "field",
        equal: (right) => scalar("equal", right), notEqual: (right) => scalar("notEqual", right),
        in: (values) => ({ kind: "in", field: identity, set: { kind: "literal", codec: fieldCodec(field), values } }),
        notIn: (values) => ({ kind: "notIn", field: identity, set: { kind: "literal", codec: fieldCodec(field), values } }),
        isNull: () => ({ kind: "isNull", field: identity }), isNotNull: () => ({ kind: "isNotNull", field: identity }),
        lessThan: (right) => scalar("lessThan", right),
        ascending: (options) => ({ kind: "order", field: identity, direction: "asc", nulls: options.nulls }),
        descending: (options) => ({ kind: "order", field: identity, direction: "desc", nulls: options.nulls }),
      }];
    }));
  const fields = makeFields(collection);
  const relations = Object.fromEntries(Object.entries(collection.relations).flatMap(([name, relation]) => {
    if (relation.kind !== "toOne") return [];
    const target = relationalCollections.get(relation.target.slice("collection:".length));
    if (!target) throw new Error("QP-DATA unknown Relation target " + relation.target);
    return [[name, {
      select: (callback) => ({
        kind: "toOne",
        relation: collectionIdentity(collection) + "/relation:" + name,
        select: Object.entries(callback({ fields: makeFields(target) })).map(([key, field]) => ({ kind: "field", key, field: field.__queryField })),
      }),
    }]];
  }));
  const queryExpression = (candidate) => {
    if (candidate?.kind !== "booleanExpression") return candidate;
    if (candidate.operator === "and" || candidate.operator === "or") return { kind: candidate.operator, expressions: candidate.operands.map(queryExpression) };
    if (candidate.operator === "not") return { kind: "not", expression: queryExpression(candidate.operands[0]) };
    if (candidate.operator === "always") return { kind: "constant", value: true };
    throw new Error("QP-DATA-005 unknownOperator " + String(candidate.operator));
  };
  const parameters = Object.entries(template.parameters).map(([name, parameter]) => {
    if (parameter.parameterKind === "cursor") return { kind: "cursor", name, nullable: true };
    const codec = parameter.parameterKind === "integer" ? { kind: "integer", minimum: parameter.minimum ?? null, maximum: parameter.maximum ?? null } : { kind: parameter.parameterKind };
    return { kind: "scalar", name, codec, nullable: false };
  });
  const selection = template.select({ fields, relations });
  const order = template.orderBy({ fields });
  const unique = Object.entries(collection.constraints)
    .filter(([, constraint]) => constraint.kind === "primaryKey" || constraint.kind === "unique")
    .map(([name, constraint]) => ({ name, fields: constraint.fields.map((field) => typeof field === "string" ? field : field.field) }))
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    .find((constraint) => constraint.fields.every((field, index) => order[order.length - constraint.fields.length + index]?.field === fieldIdentity(collection, field)));
  if (!unique) throw new Error("QP-DATA no unique cursor constraint");
  const page = template.page({ parameters: template.parameters });
  return {
    from: collectionIdentity(collection),
    parameters,
    select: Object.entries(selection).map(([key, selected]) => selected.kind === "toOne"
      ? { ...selected, key }
      : { kind: "field", key, field: selected.__queryField }),
    filter: template.where === null ? null : queryExpression(template.where({ fields, parameters: template.parameters })),
    order: order.map(({ field, direction, nulls }) => ({ field, direction, nulls })),
    page: { kind: "forwardCursor", first: parameterOperand(page.first), after: parameterOperand(page.after), uniqueConstraint: collectionIdentity(collection) + "/constraint:" + unique.name },
  };
}

const projectRelationalValue = (value) => {
  if (value?.__questpie?.resourceKind === "policy") {
    const compiled = compilePolicy(value);
    return { __questpie: value.__questpie, kind: "policy", name: value.name, identity: value.identity, target: value.target, program: compiled.program, policyScopes: compiled.scopes };
  }
  if (value?.kind === "dataQuery") return { kind: "dataQuery", templateInput: compileDataQuery(value) };
  return value;
};
`;
