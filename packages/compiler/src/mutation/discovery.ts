/*
 * This source executes only inside the compiler's controlled evaluator. It
 * invokes closed authoring callbacks with symbolic operands and serializes the
 * resulting programs; production compilation never inspects callback source.
 */
export const mutationDiscoverySource = String.raw`
const operationMemberOrder = ["list", "get", "create", "update", "delete"];

function compileCollectionOperationSet(value) {
  const collection = value.collection;
  const body = value.body;
  if (!collection || collection.__questpie?.resourceKind !== "collection")
    throw new Error("QP-COMPOSE-013 Collection Operation Set target is not a Collection");
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error("QP-COMPOSE-013 Collection Operation Set body is not an object");
  const allowed = new Set(["name", "policy", "network", ...operationMemberOrder]);
  const unexpected = Object.keys(body).filter((key) => !allowed.has(key)).sort();
  if (unexpected.length) throw new Error("QP-COMPOSE-013 Collection Operation Set has unknown member " + unexpected[0]);
  if (typeof body.name !== "string" || body.name.length === 0)
    throw new Error("QP-COMPOSE-013 Collection Operation Set name is invalid");
  if (body.network !== undefined && typeof body.network !== "boolean")
    throw new Error("QP-COMPOSE-013 Collection Operation Set network is invalid");
  const target = collectionIdentity(collection);
  const policyIdentity = body.policy?.identity;
  if (body.policy?.__questpie?.resourceKind !== "policy" || typeof policyIdentity !== "string" || body.policy.target !== target)
    throw new Error("QP-COMPOSE-013 Collection Operation Set Policy does not target " + target);

  const fields = collection.fields ?? {};
  const fieldNames = new Set(Object.keys(fields));
  const fieldPath = (path, label) => {
    if (!Array.isArray(path) || path.length !== 1 || typeof path[0] !== "string" || !fieldNames.has(path[0]))
      throw new Error("QP-COMPOSE-013 " + label + " references unknown Field " + String(path?.join?.(".")));
    return path;
  };
  const selectionPaths = (selection, prefix = []) => {
    if (!selection || typeof selection !== "object" || Array.isArray(selection))
      throw new Error("QP-COMPOSE-013 Collection Operation Set selection is invalid");
    return Object.entries(selection).flatMap(([name, selected]) => {
      if (prefix.length === 0 && !fieldNames.has(name))
        throw new Error("QP-COMPOSE-013 Collection Operation Set selection references unknown Field " + name);
      const path = [...prefix, name];
      if (selected === true) return [path];
      if (selected && typeof selected === "object" && !Array.isArray(selected)) return selectionPaths(selected, path);
      throw new Error("QP-COMPOSE-013 Collection Operation Set selection " + path.join(".") + " is invalid");
    });
  };
  const inputOperands = Object.freeze(Object.fromEntries(Object.keys(fields).map((name) => [name, Object.freeze({ kind: "valueOperand", source: "input", path: [name] })])));
  const valueScope = Object.freeze({
    input: inputOperands,
    principal: Object.freeze({
      id: Object.freeze({ kind: "valueOperand", source: "principal", path: ["principal", "id"] }),
      kind: Object.freeze({ kind: "valueOperand", source: "principal", path: ["principal", "kind"] }),
    }),
    tenant: Object.freeze({ id: Object.freeze({ kind: "valueOperand", source: "tenant", path: ["tenant", "id"] }) }),
    operationTime: Object.freeze({ kind: "valueOperand", source: "operationTime", path: ["operationTime"] }),
  });
  const normalizers = [];
  const serverValues = [];
  const members = [];
  for (const member of operationMemberOrder) {
    const definition = body[member];
    if (definition === undefined) continue;
    if (!definition || typeof definition !== "object" || Array.isArray(definition))
      throw new Error("QP-COMPOSE-013 Collection Operation Set " + member + " is invalid");
    const compiled = { member };
    if (member === "list") {
      if (definition.data?.kind !== "dataQuery")
        throw new Error("QP-COMPOSE-013 Collection Operation Set list requires dataQuery");
      const templateInput = compileDataQuery(definition.data);
      if (templateInput.from !== target)
        throw new Error("QP-COMPOSE-013 Collection Operation Set list dataQuery targets " + templateInput.from);
      compiled.templateInput = templateInput;
    } else {
      compiled.selectionPaths = selectionPaths(definition.select);
    }
    if (member === "create" || member === "update") {
      if (!Array.isArray(definition.input) || new Set(definition.input).size !== definition.input.length)
        throw new Error("QP-COMPOSE-013 Collection Operation Set " + member + " input is invalid");
      compiled.inputPaths = definition.input.map((name) => fieldPath([name], "Collection Operation Set " + member + " input"));
      if (definition.normalize !== undefined) {
        if (typeof definition.normalize !== "function")
          throw new Error("QP-COMPOSE-013 Collection Operation Set " + member + " normalizer is invalid");
        const output = definition.normalize(Object.freeze({ input: inputOperands }));
        if (!output || typeof output !== "object" || Array.isArray(output))
          throw new Error("QP-COMPOSE-013 Collection Operation Set " + member + " normalizer result is invalid");
        const steps = Object.entries(output).flatMap(([name, normalized]) => {
          fieldPath([name], "Collection Operation Set normalizer target");
          if (normalized?.kind === "valueOperand" && normalized.source === "input" && normalized.path?.[0] === name) return [];
          if (normalized?.kind !== "normalizedValue" || (normalized.transform !== "trim" && normalized.transform !== "trimIfPresent") || normalized.source?.kind !== "valueOperand" || normalized.source.source !== "input")
            throw new Error("QP-COMPOSE-013 Collection Operation Set normalizer is not a closed Value Program");
          fieldPath(normalized.source.path, "Collection Operation Set normalizer source");
          return [{ target: [name], expression: { kind: normalized.transform, source: normalized.source.path } }];
        });
        normalizers.push({ operation: member, steps });
      }
      if (definition.values !== undefined) {
        if (typeof definition.values !== "function")
          throw new Error("QP-COMPOSE-013 Collection Operation Set " + member + " values program is invalid");
        const output = definition.values(valueScope);
        if (!output || typeof output !== "object" || Array.isArray(output))
          throw new Error("QP-COMPOSE-013 Collection Operation Set " + member + " values result is invalid");
        const assignments = Object.entries(output).map(([name, assignment]) => {
          fieldPath([name], "Collection Operation Set server-value target");
          if (assignment?.kind !== "overwrite" || assignment.value?.kind !== "valueOperand" || !Array.isArray(assignment.value.path))
            throw new Error("QP-COMPOSE-013 Collection Operation Set values is not a closed Value Program");
          const source = assignment.value.path;
          if (assignment.value.source === "input") fieldPath(source, "Collection Operation Set server-value input source");
          else if (!["principal", "tenant", "operationTime"].includes(assignment.value.source))
            throw new Error("QP-COMPOSE-013 Collection Operation Set server-value source is invalid");
          return { target: [name], mode: "overwrite", source };
        });
        serverValues.push({ operation: member, assignments });
      }
    }
    members.push(compiled);
  }
  if (members.length === 0)
    throw new Error("QP-COMPOSE-013 Collection Operation Set has no members");
  return {
    kind: "collectionOperationSet",
    target,
    name: body.name,
    policy: policyIdentity,
    network: body.network === true,
    members,
    normalizers,
    serverValues,
  };
}

const projectMutationValue = (value) => value?.kind === "collectionOperationSet"
  ? compileCollectionOperationSet(value)
  : projectRelationalValue(value);
`;
