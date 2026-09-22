// SPDX-License-Identifier: AGPL-3.0-only
import userEvent from "@testing-library/user-event";
import {
  FORM_BUILTINS,
  pinnedFormRows,
  type Form,
  type FormModule,
  type FormRow,
} from "@openlaw/shared";
import { json, problem, renderAt, stubApi, type StubCall, type StubAnswer } from "./helpers";
const ADMIN = {
  id: "u1",
  email: "admin@example.com",
  displayName: "Admin",
  role: "administrator",
  theme: "light",
};
export function setupForm(
  module: FormModule = "contract",
  fail = false,
  transform?: (form: Form) => Form,
  role = "administrator",
  extra?: (call: StubCall) => StubAnswer,
) {
  const fields = [
    {
      id: "f1",
      slug: "justification",
      displayName: "Business justification",
      fieldType: "text",
      moduleScope: module,
    },
    {
      id: "f2",
      slug: "reviewer",
      displayName: "Finance reviewer",
      fieldType: "user",
      moduleScope: module,
    },
    {
      id: "f3",
      slug: "other",
      displayName: "Other scope",
      fieldType: "text",
      moduleScope: module === "matter" ? "contract" : "matter",
    },
    {
      id: "f4",
      slug: "archived",
      displayName: "Archived Field",
      fieldType: "text",
      moduleScope: module,
      archivedAt: "2026-01-01",
    },
  ].map((f) => ({
    description: null,
    options: null,
    aiPrompt: null,
    archivedAt: null,
    inUseCount: 0,
    ...f,
  }));
  let form: Form = [
    ...pinnedFormRows(module),
    ...Object.entries(FORM_BUILTINS[module]).map(
      ([key, fieldType]) =>
        ({
          kind: "row",
          id: key,
          rowRef: key,
          fieldType,
          onIntakeForm: false,
          isRequired: false,
          visibleOnPortal: true,
        }) as FormRow,
    ),
    {
      kind: "row",
      id: "f1",
      rowRef: "justification",
      fieldType: "text",
      ...(module === "entity" ? {} : { onIntakeForm: false }),
      isRequired: false,
      visibleOnPortal: false,
    },
  ];
  if (transform) form = transform(form);
  let release: (() => void) | undefined;
  let hold = false;
  const writes: Form[] = [];
  const creates: unknown[] = [];
  const patches: unknown[] = [];
  const path = `/api/v1/${module}-types/t1`;
  stubApi({
    signedIn: { ...ADMIN, role },
    extra(call) {
      const override = extra?.(call);
      if (override !== undefined) return override;
      if (call.url.pathname === path && call.method === "PATCH") patches.push(call.body);
      if (call.url.pathname === path)
        return json(200, {
          [`${module}Type`]: {
            id: "t1",
            slug: "test",
            displayName: "Test type",
            description: null,
            archivedAt: null,
            inUseCount: 0,
            ...(call.body as object),
          },
        });
      if (call.url.pathname === `${path}/form`) {
        if (call.method === "PUT") {
          writes.push((call.body as { form: Form }).form);
          if (fail) return problem(409, "The Form changed. Try again.");
          form = (call.body as { form: Form }).form;
          if (hold)
            return new Promise<Response>((resolve) => {
              release = () => resolve(json(200, { form }));
            });
        }
        return json(200, { form });
      }
      if (call.url.pathname === "/api/v1/fields") {
        if (call.method === "POST") {
          creates.push(call.body);
          return json(201, {
            field: { ...fields[0], ...(call.body as object), id: "created", slug: "new_field" },
          });
        }
        return json(200, { fields });
      }
      if (call.url.pathname === "/api/v1/portal/entities") return json(200, { entities: [] });
      if (call.url.pathname === "/api/v1/departments/options")
        return json(200, { departments: [] });
      if (call.url.pathname === "/api/v1/regions") return json(200, { regions: [] });
      if (call.url.pathname.endsWith("/people")) return json(200, { people: [] });
      if (call.url.pathname === "/api/v1/users") return json(200, { users: [] });
      return undefined;
    },
  });
  const section = module === "entity" ? "entities" : `${module}s`;
  const route = `/settings/${section}/types/t1/form`;
  const rendered = renderAt(route);
  return {
    ...rendered,
    route,
    writes,
    creates,
    patches,
    hold: () => {
      hold = true;
    },
    release: () => release?.(),
    read: () => form,
    user: userEvent.setup(),
  };
}
