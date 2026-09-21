// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi } from "../testing/helpers";

const ADMIN = {
  id: "u1",
  email: "admin@example.com",
  displayName: "Administrator",
  role: "administrator",
  theme: "light",
};

describe.each(["contract", "matter", "entity"] as const)(
  "create a field from a %s type",
  (module) => {
    function setup(failure?: "create" | "attach") {
      const creates: Record<string, unknown>[] = [];
      const attaches: unknown[] = [];
      const path = `/api/v1/${module}-types/t1`;
      stubApi({
        signedIn: ADMIN,
        extra: (call) => {
          if (call.method === "GET") {
            if (call.url.pathname === path)
              return json(200, {
                [`${module}Type`]: {
                  id: "t1",
                  slug: "test",
                  displayName: "Test type",
                  description: null,
                  archivedAt: null,
                  inUseCount: 0,
                  isSystemDefault: false,
                  displayOrder: 1,
                },
              });
            if (call.url.pathname === `${path}/form`) return json(200, { form: [] });
            if (call.url.pathname === "/api/v1/fields") return json(200, { fields: [] });
            if (call.url.pathname === `${path}/people`) return json(200, { people: [] });
            if (call.url.pathname === "/api/v1/users") return json(200, { users: [] });
          }
          if (call.method === "POST" && call.url.pathname === "/api/v1/fields") {
            creates.push(call.body as Record<string, unknown>);
            if (failure === "create") return problem(400, "This field could not be created.");
            return json(201, {
              field: {
                ...(call.body as object),
                id: "f1",
                slug: "review_notes",
                options: null,
                aiPrompt: null,
                archivedAt: null,
                inUseCount: 0,
              },
            });
          }
          if (call.method === "PUT" && call.url.pathname === `${path}/form`) {
            attaches.push(call.body);
            if (failure === "attach" && attaches.length === 1) return problem(409, "Please retry.");
            return json(200, call.body);
          }
          return undefined;
        },
      });
      renderAt(`/settings/${module === "entity" ? "entities" : `${module}s`}/types/t1/form`);
      return { creates, attaches, user: userEvent.setup() };
    }

    async function open(user: ReturnType<typeof userEvent.setup>) {
      await user.click(await screen.findByRole("button", { name: "Create Field" }));
      return within(await screen.findByRole("dialog", { name: "Add field" }));
    }

    async function fill(user: ReturnType<typeof userEvent.setup>) {
      const dialog = await open(user);
      expect(dialog.queryByRole("combobox", { name: "Scope" })).not.toBeInTheDocument();
      expect(dialog.queryByRole("combobox", { name: "Tag" })).not.toBeInTheDocument();
      await user.type(dialog.getByRole("textbox", { name: "Name" }), "Review notes");
      await user.type(
        dialog.getByRole("textbox", { name: "Description" }),
        "Decisions and outstanding questions.",
      );
      await user.selectOptions(dialog.getByRole("combobox", { name: "Type" }), "long_text");
      if (module === "contract") {
        await user.type(
          dialog.getByRole("textbox", { name: "AI prompt" }),
          "Summarize the review provisions.",
        );
      } else {
        expect(dialog.queryByRole("textbox", { name: "AI prompt" })).not.toBeInTheDocument();
      }
      await user.click(dialog.getByRole("button", { name: "Add field" }));
    }

    it("creates in the correct scope and attaches an optional field without leaving the editor", async () => {
      const { user, creates, attaches } = setup();
      await fill(user);
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(creates).toEqual([
        expect.objectContaining({
          displayName: "Review notes",
          moduleScope: module,
          fieldType: "long_text",
          description: "Decisions and outstanding questions.",
          ...(module === "contract" ? { aiPrompt: "Summarize the review provisions." } : {}),
        }),
      ]);
      expect(attaches).toEqual([
        {
          form: [
            expect.objectContaining({
              id: "f1",
              kind: "row",
              isRequired: false,
              visibleOnPortal: false,
            }),
          ],
        },
      ]);
      expect(
        screen.getByRole("switch", { name: "Review notes: Required for creation" }),
      ).not.toBeChecked();

      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Create Field" })).toHaveFocus(),
      );
    });

    it("keeps the draft when creation fails and does not attempt attachment", async () => {
      const { user, creates, attaches } = setup("create");
      await fill(user);
      expect(await screen.findByText("This field could not be created.")).toBeInTheDocument();
      const dialog = within(screen.getByRole("dialog"));
      expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue("Review notes");
      expect(creates).toHaveLength(1);
      expect(attaches).toHaveLength(0);
    });

    it("offers a created field for attachment retry without creating a duplicate", async () => {
      const { user, creates, attaches } = setup("attach");
      await fill(user);
      expect(
        await screen.findByText(/Review notes was created but could not be attached/),
      ).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Retry attaching Review notes" }));
      expect(
        await screen.findByRole("switch", { name: "Review notes: Required for creation" }),
      ).not.toBeChecked();
      expect(creates).toHaveLength(1);
      expect(attaches).toHaveLength(2);
    });

    it("cancels without creating or attaching a field", async () => {
      const { user, creates, attaches } = setup();
      const dialog = await open(user);
      await user.click(dialog.getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(creates).toHaveLength(0);
      expect(attaches).toHaveLength(0);
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Create Field" })).toHaveFocus(),
      );
    });
  },
);
