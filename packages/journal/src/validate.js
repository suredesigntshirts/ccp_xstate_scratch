// A small JSON Schema reader, enough for row.schema.json: type, required, properties, additionalProperties: false,
// minimum, minLength and pattern. The schema file stays the one definition of a row; this only reads it.

const typeOf = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
};

const typeMatches = (want, value) => {
  const got = typeOf(value);
  return got === want || (want === 'number' && got === 'integer');
};

export function check(schema, value, path = 'row') {
  const errors = [];
  if (schema.type !== undefined) {
    const types = [schema.type].flat();
    if (!types.some((t) => typeMatches(t, value))) {
      return [`${path} must be ${types.join(' or ')}, got ${typeOf(value)}`];
    }
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path} must not be empty`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) {
      errors.push(`${path} must match ${schema.pattern}`);
    }
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) {
    errors.push(`${path} must be at least ${schema.minimum}`);
  }
  if (typeOf(value) === 'object') {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) errors.push(`${path} is missing ${key}`);
    }
    for (const [key, sub] of Object.entries(value)) {
      const rule = schema.properties?.[key];
      if (rule) errors.push(...check(rule, sub, `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${path} has unknown field ${key}`);
    }
  }
  return errors;
}
