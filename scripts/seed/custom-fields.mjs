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
      let typePath = path;
      let destination = type;
      if (module === "request") {
        const targets =
          type.targetModule === "contract" ? taxonomy.contractTypes : taxonomy.matterTypes;
        destination = targets.rows.find((row) =>
          type.targetTypeId ? row.id === type.targetTypeId : row.isDefault,
        );
        typePath = `/api/v1/${type.targetModule}-types`;
      }
      const { body } = await admin.get(`${typePath}/${destination.id}/form`);
      const rows = body.form.flatMap(function flatten(node) {
        return node.kind === "row" ? [node] : node.children.flatMap(flatten);
      });
      attached.set(
        `${module}:${type.slug}`,
        new Set(
          rows
            .filter((row) => row.id !== row.rowRef && (module !== "request" || row.onIntakeForm))
            .map((row) => row.rowRef),
        ),
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
