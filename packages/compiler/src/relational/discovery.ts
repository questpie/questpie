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
const queryParameterCodec = (codec) => {
  if (codec.kind === "text") return { kind: "text", minLength: codec.minLength ?? null, maxLength: codec.maxLength ?? null, collation: "questpie.binary" };
  if (codec.kind === "integer") return { kind: "integer", minimum: codec.minimum ?? null, maximum: codec.maximum ?? null };
  return { kind: codec.kind };
};
const operationFieldCodec = (field) => {
  const codec = field.scalar === "timestamp" ? { kind: "timestamp" } : { kind: field.scalar };
  return field.nullable === true ? { kind: "nullable", codec } : codec;
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
  const cloneQueryValue = (candidate) => {
    if (candidate instanceof Date) return new Date(candidate.getTime());
    if (Array.isArray(candidate)) return candidate.map(cloneQueryValue);
    if (candidate && typeof candidate === "object")
      return Object.fromEntries(Object.entries(candidate).map(([key, nested]) => [key, cloneQueryValue(nested)]));
    return candidate;
  };
  const sameQueryValue = (left, right) => {
    if (Object.is(left, right)) return true;
    if (left instanceof Date || right instanceof Date)
      return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
    if (Array.isArray(left) || Array.isArray(right))
      return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => sameQueryValue(item, right[index]));
    if (!left || typeof left !== "object" || !right || typeof right !== "object") return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && sameQueryValue(left[key], right[key]));
  };
  const queryScalarExpressions = new WeakMap();
  const scalarExpression = (owner, canonical) => {
    const stored = cloneQueryValue(canonical);
    const authored = cloneQueryValue(stored);
    queryScalarExpressions.set(authored, { owner: collectionIdentity(owner), canonical: stored });
    return authored;
  };
  const makeFields = (owner) => Object.fromEntries(Object.entries(owner.fields).map(([name, field]) => {
      const identity = fieldIdentity(owner, name);
      const scalar = (kind, right) => scalarExpression(owner, { kind, field: identity, operand: parameterNames.has(right) ? parameterOperand(right) : { kind: "literal", codec: fieldCodec(field), value: right } });
      return [name, {
        __queryField: identity,
        kind: "field",
        equal: (right) => scalar("equal", right), notEqual: (right) => scalar("notEqual", right),
        in: (values) => scalarExpression(owner, { kind: "in", field: identity, set: parameterNames.has(values) ? parameterOperand(values) : { kind: "literal", codec: fieldCodec(field), values } }),
        notIn: (values) => scalarExpression(owner, { kind: "notIn", field: identity, set: parameterNames.has(values) ? parameterOperand(values) : { kind: "literal", codec: fieldCodec(field), values } }),
        isNull: () => scalarExpression(owner, { kind: "isNull", field: identity }), isNotNull: () => scalarExpression(owner, { kind: "isNotNull", field: identity }),
        lessThan: (right) => scalar("lessThan", right),
        ascending: (options) => ({ kind: "order", field: identity, direction: "asc", nulls: options.nulls }),
        descending: (options) => ({ kind: "order", field: identity, direction: "desc", nulls: options.nulls }),
      }];
    }));
  function conditionallySelected(identity) {
    const target = identity.slice(0, identity.indexOf("/field:"));
    const field = identity.slice(identity.indexOf("/field:") + 7);
    for (const record of records) for (const candidate of Object.values(record.exports)) {
      if (candidate?.__questpie?.resourceKind !== "policy" || candidate.target !== target) continue;
      const program = compilePolicy(candidate).program;
      if (program.attachment?.kind !== "default") continue;
      if (program.fields?.selectedOutput?.some((rule) => rule.path.length === 1 && rule.path[0] === field)) return true;
    }
    return false;
  }
  const fail = (code, diagnosticClass, path) => {
    const safePath = /^(?:[A-Za-z_$][A-Za-z0-9_$]*)(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(path) ? path : "selection";
    throw new Error(code + " " + diagnosticClass + " QP-PATH " + safePath);
  };
  const compileSelection = (selection, owner, state) => Object.entries(selection).map(([key, selected]) => {
    if (selected?.kind === "toManyList") {
      const relation = owner.relations[key];
      if (relation?.kind !== "toMany") fail("QP-DATA-026", "invalidInverseList", key);
      if (Object.keys(selected).some((name) => !["kind", "source", "first", "where", "orderBy", "select"].includes(name)))
        fail("QP-DATA-026", "invalidInverseList", key);
      state.plural += 1;
      state.edges += 1;
      if (state.plural !== 1) fail("QP-DATA-026", "invalidInverseList", key);
      if (state.edges > 4) fail("QP-DATA-022", "relationDepthExceeded", key);
      const expectedSource = relation.inverseOf.slice(0, relation.inverseOf.indexOf("/relation:"));
      if (selected.source !== expectedSource) fail("QP-DATA-026", "invalidInverseList", key);
      if (!Number.isInteger(selected.first) || selected.first < 1 || selected.first > 50)
        fail("QP-DATA-026", "invalidInverseList", key);
      const child = relationalCollections.get(selected.source.slice("collection:".length));
      if (!child || !selected.select || typeof selected.select !== "object" || Array.isArray(selected.select))
        fail("QP-DATA-026", "invalidInverseList", key);
      const owningName = relation.inverseOf.slice(relation.inverseOf.indexOf("/relation:") + 10);
      const owning = child.relations[owningName];
      if (owning?.kind !== "toOne" || owning.target !== collectionIdentity(owner))
        fail("QP-DATA-026", "invalidInverseList", key);
      const selectedKeys = Object.keys(selected.select);
      if (selectedKeys.length === 0 || selectedKeys.some((name) => {
        if (child.fields[name]) return selected.select[name] !== true;
        return child.relations[name]?.kind !== "toOne" || !selected.select[name] || typeof selected.select[name] !== "object";
      }))
        fail("QP-DATA-026", "invalidInverseList", key);
      if (!selected.orderBy || typeof selected.orderBy !== "object" || Array.isArray(selected.orderBy))
        fail("QP-DATA-026", "invalidInverseList", key);
      const orderKeys = Object.keys(selected.orderBy);
      if (orderKeys.length === 0 || orderKeys.some((name) => !child.fields[name]))
        fail("QP-DATA-026", "invalidInverseList", key);
      if (orderKeys.some((name) => !selectedKeys.includes(name)))
        fail("QP-DATA-008", "orderFieldNotSelected", key + "." + orderKeys.find((name) => !selectedKeys.includes(name)));
      if (orderKeys.some((name) => {
        const term = selected.orderBy[name];
        return term !== "asc" && term !== "desc" &&
          (!term || typeof term !== "object" || !["asc", "desc"].includes(term.direction) || !["first", "last"].includes(term.nulls) || Object.keys(term).some((key) => key !== "direction" && key !== "nulls"));
      })) fail("QP-DATA-026", "invalidInverseList", key);
      const conditionalOrder = orderKeys.find((name) => conditionallySelected(fieldIdentity(child, name)));
      if (conditionalOrder) fail("QP-DATA-008", "orderFieldNotSelected", key + "." + conditionalOrder);
      const unique = Object.values(child.constraints).some((constraint) =>
        (constraint.kind === "primaryKey" || constraint.kind === "unique") &&
        constraint.fields.every((field) => child.fields[typeof field === "string" ? field : field.field]?.nullable !== true) &&
        constraint.fields.every((field, index) => {
          const name = typeof field === "string" ? field : field.field;
          return orderKeys[orderKeys.length - constraint.fields.length + index] === name;
        }));
      if (!unique) fail("QP-DATA-026", "invalidInverseList", key);
      const filter = selected.where === undefined ? null : queryExpression(selected.where({ row: makeFields(child) }), key, collectionIdentity(child));
      const compileNested = (nestedOwner, nestedSelection, path) => {
        const compiled = [];
        for (const [nestedKey, nestedValue] of Object.entries(nestedSelection)) {
          if (nestedOwner.fields[nestedKey]) {
            if (nestedValue !== true) fail("QP-DATA-026", "invalidInverseList", path + "." + nestedKey);
            compiled.push({ kind: "field", key: nestedKey, field: fieldIdentity(nestedOwner, nestedKey) });
            continue;
          }
          const nestedRelation = nestedOwner.relations[nestedKey];
          if (
            nestedRelation?.kind !== "toOne" ||
            !nestedValue ||
            typeof nestedValue !== "object" ||
            Array.isArray(nestedValue) ||
            !Object.prototype.hasOwnProperty.call(nestedValue, "select") ||
            Object.keys(nestedValue).some((name) => name !== "select") ||
            !nestedValue.select ||
            typeof nestedValue.select !== "object" ||
            Array.isArray(nestedValue.select) ||
            Object.keys(nestedValue.select).length === 0
          ) fail("QP-DATA-026", "invalidInverseList", path + "." + nestedKey);
          state.edges += 1;
          if (state.edges > 4) fail("QP-DATA-022", "relationDepthExceeded", path + "." + nestedKey);
          const nestedTarget = relationalCollections.get(nestedRelation.target.slice("collection:".length));
          if (!nestedTarget) fail("QP-DATA-026", "invalidInverseList", path + "." + nestedKey);
          compiled.push({ kind: "toOne", key: nestedKey, relation: collectionIdentity(nestedOwner) + "/relation:" + nestedKey, select: compileNested(nestedTarget, nestedValue.select, path + "." + nestedKey) });
        }
        return compiled.sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
      };
      return {
        kind: "inverseList", key, relation: relation.inverseOf, source: selected.source,
        first: selected.first, filter,
        order: orderKeys.map((name) => {
          const term = selected.orderBy[name];
          return { field: fieldIdentity(child, name), direction: typeof term === "string" ? term : term.direction, nulls: typeof term === "string" ? "last" : term.nulls };
        }),
        select: compileNested(child, selected.select, key),
      };
    }
    if (selected?.kind === "toOne") {
      state.edges += 1;
      if (state.edges > 4) fail("QP-DATA-022", "relationDepthExceeded", key);
      return { ...selected, key };
    }
    return { kind: "field", key, field: selected.__queryField };
  });
  const makeRelations = (owner, state) => Object.fromEntries(Object.entries(owner.relations).flatMap(([name, relation]) => {
    if (relation.kind !== "toOne") return [];
    const target = relationalCollections.get(relation.target.slice("collection:".length));
    if (!target) throw new Error("QP-DATA unknown Relation target " + relation.target);
    return [[name, {
      select: (callback) => ({
        kind: "toOne",
        relation: collectionIdentity(owner) + "/relation:" + name,
        select: compileSelection(callback({ fields: makeFields(target), relations: makeRelations(target, state) }), target, state),
      }),
    }]];
  }));
  const fields = makeFields(collection);
  const relationState = { plural: 0, edges: 0 };
  const relations = makeRelations(collection, relationState);
  const queryExpression = (candidate, inversePath = null, inverseOwner = null) => {
    const invalid = () => {
      if (inversePath !== null) fail("QP-DATA-026", "invalidInverseList", inversePath);
      throw new Error("QP-DATA-005 unknownOperator " + String(candidate?.operator ?? candidate?.kind));
    };
    if (candidate?.kind !== "booleanExpression") {
      if (inversePath === null) return candidate;
      const scalar = candidate && typeof candidate === "object" && !Array.isArray(candidate)
        ? queryScalarExpressions.get(candidate)
        : null;
      if (!scalar || scalar.owner !== inverseOwner || !sameQueryValue(candidate, scalar.canonical)) return invalid();
      return scalar.canonical;
    }
    if (Object.keys(candidate).sort().join("\0") !== ["kind", "operands", "operator"].join("\0")) return invalid();
    const operands = candidate.operands;
    if (!Array.isArray(operands)) return invalid();
    if (candidate.operator === "and" || candidate.operator === "or") {
      if (operands.length < 2) return invalid();
      return { kind: candidate.operator, expressions: operands.map((operand) => queryExpression(operand, inversePath, inverseOwner)) };
    }
    if (candidate.operator === "not") {
      if (operands.length !== 1) return invalid();
      return { kind: "not", expression: queryExpression(operands[0], inversePath, inverseOwner) };
    }
    if (candidate.operator === "always") {
      if (operands.length !== 0) return invalid();
      return { kind: "constant", value: true };
    }
	if (candidate.operator === "exists") {
	  if (inversePath !== null) return invalid();
	  throw new Error("QP-DATA-025 unsupportedExpressionCapability expr.exists is Policy-only");
	}
    return invalid();
  };
  const parameters = Object.entries(template.parameters).map(([name, parameter]) => {
    if (parameter.parameterKind === "cursor") return { kind: "cursor", name, nullable: true };
    if (parameter.parameterKind === "list") {
      const codec = queryParameterCodec(parameter.itemCodec ?? { kind: parameter.itemKind });
      return { kind: "list", name, codec, maximumItems: parameter.maximumItems, nullable: parameter.nullable === true, semantics: "set" };
    }
    const codec = queryParameterCodec(parameter.codec ?? {
      kind: parameter.parameterKind,
      minimum: parameter.minimum,
      maximum: parameter.maximum,
    });
    return { kind: "scalar", name, codec, nullable: parameter.nullable === true };
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
  const templateInput = {
    from: collectionIdentity(collection),
    parameters,
    select: compileSelection(selection, collection, relationState),
    filter: template.where === null ? null : queryExpression(template.where({ fields, parameters: template.parameters })),
    order: order.map(({ field, direction, nulls }) => ({ field, direction, nulls })),
    page: { kind: "forwardCursor", first: parameterOperand(page.first), after: parameterOperand(page.after), uniqueConstraint: collectionIdentity(collection) + "/constraint:" + unique.name },
  };
  const parameterCodec = (parameter) => {
    let codec = parameter.parameterKind === "list"
      ? { kind: "array", items: parameter.itemCodec ?? { kind: parameter.itemKind }, maximum: parameter.maximumItems }
      : parameter.parameterKind === "cursor"
        ? { kind: "cursor" }
        : parameter.codec ?? { kind: parameter.parameterKind, ...(parameter.minimum === undefined ? {} : { minimum: parameter.minimum }), ...(parameter.maximum === undefined ? {} : { maximum: parameter.maximum }) };
    return parameter.nullable === true ? { kind: "nullable", codec } : codec;
  };
  const fieldForIdentity = (identity) => {
    for (const candidate of relationalCollections.values())
      for (const [name, field] of Object.entries(candidate.fields))
        if (fieldIdentity(candidate, name) === identity) return field;
    throw new Error("QP-DATA unknown selected Field " + identity);
  };
  const selectedCodec = (selected, nested = false, outputKey = null) => {
    if (selected.kind === "toOne")
      return { kind: "nullable", codec: { kind: "object", properties: Object.fromEntries(selected.select.map((child) => [child.key, selectedCodec(child, true)])) } };
	if (selected.kind === "toManyList") {
	  const compiled = templateInput.select.find((candidate) => candidate.kind === "inverseList" && candidate.key === outputKey);
	  return { kind: "array", items: { kind: "object", properties: Object.fromEntries(compiled.select.map((child) => [child.key, selectedCodec(child, true)])) } };
	}
    const field = selected.field ?? selected.__queryField;
    const codec = operationFieldCodec(fieldForIdentity(field));
    return nested && conditionallySelected(field) ? { kind: "optional", codec } : codec;
  };
  return {
    templateInput,
    input: { kind: "object", properties: Object.fromEntries(Object.entries(template.parameters).map(([name, parameter]) => [name, parameterCodec(parameter)])) },
    output: { kind: "object", properties: {
      nodes: { kind: "array", items: { kind: "object", properties: Object.fromEntries(Object.entries(selection).map(([key, selected]) => [key, selectedCodec(selected, false, key)])) } },
      pageInfo: { kind: "object", properties: { endCursor: { kind: "nullable", codec: { kind: "text" } }, hasNextPage: { kind: "boolean" } } },
    } },
  };
}

const projectRelationalValue = (value) => {
  if (value?.__questpie?.resourceKind === "policy") {
    const compiled = compilePolicy(value);
    return { __questpie: value.__questpie, kind: "policy", name: value.name, identity: value.identity, target: value.target, program: compiled.program, policyScopes: compiled.scopes };
  }
  if (value?.kind === "dataQuery") {
    const compiled = compileDataQuery(value);
    return { kind: "dataQuery", templateInput: compiled.templateInput };
  }
  if (value?.__questpie?.resourceKind === "query" && value.query?.kind === "dataQuery") {
    const compiled = compileDataQuery(value.query);
    return { ...value, query: compiled.templateInput, input: compiled.input, output: compiled.output };
  }
  return value;
};
`;
