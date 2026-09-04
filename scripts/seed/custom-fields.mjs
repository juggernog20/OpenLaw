/* Filling custom Fields without guessing which ones a record can hold.
 *
 * A value is only accepted for a Field the record's Type actually
 * collects. The API refuses the rest, and rightly: a value stored under
 * an unattached Field is one no surface could ever show. The seed
 * attaches Fields to some Types and not others on purpose, so it has to
 * ask which before it writes.
 *
 * The answer is read back from the API rather than inferred from the
 * catalogue, so the two cannot drift.
 */

/** Every Type's attached Field slugs, keyed `module:typeSlug`. */
export async function readAttachments(admin, taxonomy) {
  const sources = [
    ["contract", "/api/v1/contract-types", taxonomy.contractTypes],
    ["matter", "/api/v1/matter-types", taxonomy.matterTypes],
    ["entity", "/api/v1/entity-types", taxonomy.entityTypes],
    ["request", "/api/v1/request-types", taxonomy.requestTypes],
  ];
  const attached = new Map();
  for (const [module, path, types] of sources) {
    for (const type of types.rows) {
      const { body } = await admin.get(`${path}/${type.id}/fields`);
      attached.set(
        `${module}:${type.slug}`,
        new Set((body.attachedFields ?? []).map((row) => row.slug)),
      );
    }
  }
  return attached;
}

/**
 * A collector for one record: `set` by the Field's display name, and
 * anything the Type does not collect is quietly dropped.
 */
export function customFields(fields, attached, module, typeSlug) {
  const allowed = attached.get(`${module}:${typeSlug}`) ?? new Set();
  const values = {};
  return {
    set(name, value) {
      const field = fields.byName.get(name);
      if (!field || value === undefined || value === null) return;
      if (!allowed.has(field.slug)) return;
      values[field.slug] = value;
    },
    /** Whether this Type collects the named Field at all. */
    collects(name) {
      const field = fields.byName.get(name);
      return Boolean(field && allowed.has(field.slug));
    },
    values,
  };
}
