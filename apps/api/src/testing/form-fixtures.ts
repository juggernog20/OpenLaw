// SPDX-License-Identifier: AGPL-3.0-only
/** Configure test Fields through the same Form write as the builder. */
import { expect } from "vitest";
import type { Form, FormNode, FormRow } from "@openlaw/shared";
import type { TestHarness } from "./harness.js";

export async function saveFieldRow(
  h: TestHarness,
  options: {
    typeUrl: string;
    cookies?: Record<string, string>;
    payload: { fieldId: string; isRequired?: boolean; visibleOnPortal?: boolean };
  },
) {
  let typeUrl = options.typeUrl;
  const intake = typeUrl.includes("request-types");
  if (intake) {
    const response = await h.app.inject({ method: "GET", url: typeUrl, cookies: options.cookies });
    expect(response.statusCode, response.body).toBe(200);
    const rt = response.json().requestType;
    const types = await h.app.inject({
      method: "GET",
      url: `/api/v1/${rt.targetModule}-types`,
      cookies: options.cookies,
    });
    const list = types.json()[`${rt.targetModule}Types`];
    const target = list.find((t: { id: string; isDefault: boolean }) =>
      rt.targetTypeId ? t.id === rt.targetTypeId : t.isDefault,
    );
    typeUrl = `/api/v1/${rt.targetModule}-types/${target.id}`;
  }
  const [read, catalog] = await Promise.all([
    h.app.inject({ method: "GET", url: `${typeUrl}/form`, cookies: options.cookies }),
    h.app.inject({
      method: "GET",
      url: "/api/v1/fields?includeArchived=true",
      cookies: options.cookies,
    }),
  ]);
  expect(read.statusCode, read.body).toBe(200);
  const field = catalog.json().fields.find((f: { id: string }) => f.id === options.payload.fieldId);
  const row: FormRow = {
    kind: "row",
    id: field.id,
    rowRef: field.slug,
    fieldType: field.fieldType,
    onIntakeForm: intake,
    isRequired: options.payload.isRequired ?? false,
    visibleOnPortal: options.payload.visibleOnPortal ?? true,
  };
  let found = false;
  const update = (form: Form): Form =>
    form.map((n): FormNode => {
      if (n.kind === "branch") return { ...n, children: update(n.children) };
      if (n.id !== field.id) return n;
      found = true;
      return { ...n, ...row, onIntakeForm: n.onIntakeForm || intake };
    });
  const updated = update(read.json().form);
  const form = found ? updated : [...updated, row];
  return h.app.inject({
    method: "PUT",
    url: `${typeUrl}/form`,
    cookies: options.cookies,
    payload: { form },
  });
}

export async function removeFieldRow(
  h: TestHarness,
  options: {
    typeUrl: string;
    fieldId: string;
    cookies?: Record<string, string>;
  },
) {
  let typeUrl = options.typeUrl;
  if (typeUrl.includes("request-types")) {
    const response = await h.app.inject({ method: "GET", url: typeUrl, cookies: options.cookies });
    const rt = response.json().requestType;
    const types = await h.app.inject({
      method: "GET",
      url: `/api/v1/${rt.targetModule}-types`,
      cookies: options.cookies,
    });
    const list = types.json()[`${rt.targetModule}Types`];
    const target = list.find((t: { id: string; isDefault: boolean }) =>
      rt.targetTypeId ? t.id === rt.targetTypeId : t.isDefault,
    );
    typeUrl = `/api/v1/${rt.targetModule}-types/${target.id}`;
  }
  const read = await h.app.inject({
    method: "GET",
    url: `${typeUrl}/form`,
    cookies: options.cookies,
  });
  const without = (form: Form): Form =>
    form
      .filter((n) => n.id !== options.fieldId)
      .map((n) => (n.kind === "branch" ? { ...n, children: without(n.children) } : n));
  return h.app.inject({
    method: "PUT",
    url: `${typeUrl}/form`,
    cookies: options.cookies,
    payload: { form: without(read.json().form) },
  });
}
