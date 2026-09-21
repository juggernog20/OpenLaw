// SPDX-License-Identifier: AGPL-3.0-only

/** Destination Form fixtures for Portal journeys, restored after each run (DD-028, INT-002, TECH-018). */

import { expect, type APIRequestContext } from "@playwright/test";
import { z } from "zod";

type Node = Record<string, unknown> & {
  kind: "row" | "branch";
  rowRef?: string;
  children?: Node[];
};
const NodeSchema: z.ZodType<Node> = z.looseObject({
  kind: z.enum(["row", "branch"]),
  rowRef: z.string().optional(),
  get children(): z.ZodOptional<z.ZodArray<typeof NodeSchema>> {
    return z.array(NodeSchema).optional();
  },
});

/** Configure the destination Form and return a restoration of its complete tree. */
export async function configureRequestIntake(
  request: APIRequestContext,
  requestTypeId: string,
  fieldId: string,
): Promise<() => Promise<void>> {
  const readType = await request.get(`/api/v1/request-types/${requestTypeId}`);
  expect(readType.status(), await readType.text()).toBe(200);
  const { targetModule, targetTypeId } = z
    .object({
      requestType: z.object({ targetModule: z.string(), targetTypeId: z.string().nullable() }),
    })
    .parse(await readType.json()).requestType;
  expect(targetModule).toBe("contract");
  let destinationId = targetTypeId;
  if (!destinationId) {
    const types = await request.get("/api/v1/contract-types");
    expect(types.status(), await types.text()).toBe(200);
    destinationId = z
      .object({ contractTypes: z.array(z.object({ id: z.string(), isDefault: z.boolean() })) })
      .parse(await types.json())
      .contractTypes.find((type) => type.isDefault)!.id;
  }
  const definitions = await request.get("/api/v1/fields");
  expect(definitions.status(), await definitions.text()).toBe(200);
  const field = z
    .object({
      fields: z.array(z.object({ id: z.string(), slug: z.string(), fieldType: z.string() })),
    })
    .parse(await definitions.json())
    .fields.find((field) => field.id === fieldId)!;
  expect(field).toBeDefined();
  const path = `/api/v1/contract-types/${destinationId}/form`;
  const read = await request.get(path);
  expect(read.status(), await read.text()).toBe(200);
  const original = z.object({ form: z.array(NodeSchema) }).parse(await read.json());
  let found = false;
  const configure = (nodes: Node[]): Node[] =>
    nodes.map((node) => {
      if (node.kind === "branch") return { ...node, children: configure(node.children!) };
      if (node.rowRef === field.slug) found = true;
      return node.rowRef === field.slug || node.rowRef === "description"
        ? { ...node, onIntakeForm: true, visibleOnPortal: true, isRequired: true }
        : node;
    });
  const form = configure(original.form);
  if (!found)
    form.push({
      kind: "row",
      id: field.id,
      rowRef: field.slug,
      fieldType: field.fieldType,
      onIntakeForm: true,
      visibleOnPortal: true,
      isRequired: true,
    });
  const written = await request.put(path, { data: { form } });
  expect(written.status(), await written.text()).toBe(200);
  return async () => {
    const restored = await request.put(path, { data: original });
    expect(restored.status(), await restored.text()).toBe(200);
  };
}
