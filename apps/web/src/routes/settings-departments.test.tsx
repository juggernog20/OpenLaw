// SPDX-License-Identifier: AGPL-3.0-only

import { z } from "zod";
import { expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi } from "../testing/helpers";

const ADMIN = {
  id: "u1",
  email: "admin@example.com",
  displayName: "Admin",
  role: "administrator",
  theme: "light",
};
const SALES = {
  id: "sales",
  slug: "sales",
  displayName: "Sales",
  description: null,
  displayOrder: 1,
  isSystemDefault: false,
  archivedAt: null,
  inUseCount: 3,
};

it("archives an in-use Department without reassignment and restores it", async () => {
  const writes: string[] = [];
  stubApi({
    signedIn: ADMIN,
    extra: (call) => {
      const path = call.url.pathname;
      if (path === "/api/v1/departments" && call.method === "GET")
        return json(200, { departments: [SALES] });
      if (path === "/api/v1/departments/sales/archive" && call.method === "POST") {
        writes.push("archive");
        expect(call.body).toEqual({});
        return json(200, { department: { ...SALES, archivedAt: "2026-09-13T00:00:00Z" } });
      }
      if (path === "/api/v1/departments/sales/restore" && call.method === "POST") {
        writes.push("restore");
        return json(200, { department: SALES });
      }
      return undefined;
    },
  });
  renderAt("/settings/departments");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Archive Sales" }));
  const dialog = await screen.findByRole("dialog", { name: "Archive Sales" });
  expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();
  expect(
    within(dialog).getByText(/Existing user and Contract references keep this Department/),
  ).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Archive Department" }));
  await waitFor(() => expect(writes).toEqual(["archive"]));
  expect(await screen.findByText(/No live Departments are configured/)).toBeVisible();
  await user.click(screen.getByRole("switch", { name: /archived/i }));
  await user.click(await screen.findByRole("button", { name: "Restore Sales" }));
  await waitFor(() => expect(writes).toEqual(["archive", "restore"]));
  await waitFor(() =>
    expect(screen.queryByText(/No live Departments are configured/)).not.toBeInTheDocument(),
  );
});

it("edits a person's Department through Users and keeps an archived current name visible", async () => {
  const bodies: unknown[] = [];
  const person = { ...ADMIN, status: "active", lastActiveAt: null, departmentId: "retired" };
  stubApi({
    signedIn: ADMIN,
    extra: (call) => {
      if (call.url.pathname === "/api/v1/departments")
        return json(200, {
          departments: [
            SALES,
            {
              ...SALES,
              id: "retired",
              displayName: "Former team",
              archivedAt: "2026-09-01T00:00:00Z",
            },
          ],
        });
      if (call.url.pathname === "/api/v1/users") return json(200, { users: [person] });
      if (call.url.pathname === "/api/v1/users/u1/department" && call.method === "PATCH") {
        bodies.push(call.body);
        const body = call.body;
        if (
          !body ||
          typeof body !== "object" ||
          !("departmentId" in body) ||
          (body.departmentId !== null && typeof body.departmentId !== "string")
        ) {
          throw new Error("Invalid Department request.");
        }
        return json(200, {
          user: { ...person, departmentId: body.departmentId },
        });
      }
      return undefined;
    },
  });
  renderAt("/settings/users");
  const user = userEvent.setup();
  const picker = await screen.findByRole("combobox", { name: "Department of admin@example.com" });
  expect(within(picker).getByRole("option", { name: "Former team (archived)" })).toBeDisabled();
  await user.selectOptions(picker, "sales");
  await waitFor(() => expect(picker).toHaveValue("sales"));
  expect(
    within(picker).queryByRole("option", { name: "Former team (archived)" }),
  ).not.toBeInTheDocument();
  await user.selectOptions(picker, "");
  await waitFor(() => expect(bodies).toEqual([{ departmentId: "sales" }, { departmentId: null }]));
});

it("keeps the saved Department and displays a refused change", async () => {
  stubApi({
    signedIn: ADMIN,
    extra: (call) => {
      if (call.url.pathname === "/api/v1/departments") return json(200, { departments: [SALES] });
      if (call.url.pathname === "/api/v1/users")
        return json(200, {
          users: [{ ...ADMIN, status: "active", lastActiveAt: null, departmentId: "sales" }],
        });
      if (call.url.pathname === "/api/v1/users/u1/department" && call.method === "PATCH") {
        expect(call.body).toEqual({ departmentId: null });
        return problem(400, "The Department change was refused.");
      }
      return undefined;
    },
  });
  renderAt("/settings/users");
  const user = userEvent.setup();
  const picker = await screen.findByRole("combobox", { name: "Department of admin@example.com" });
  expect(picker).toHaveValue("sales");
  await user.selectOptions(picker, "");
  expect(await screen.findByText("The Department change was refused.")).toBeInTheDocument();
  expect(picker).toHaveValue("sales");
});

it("redirects a Member out of Department settings", async () => {
  stubApi({ signedIn: { ...ADMIN, role: "legal_team_member" } });
  renderAt("/settings/departments");
  expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
});

it("keeps Departments alphabetical after creating and renaming, without reorder controls", async () => {
  let departments = [SALES, { ...SALES, id: "legal", displayName: "legal", displayOrder: 2 }];
  stubApi({
    signedIn: ADMIN,
    extra: (call) => {
      if (call.url.pathname === "/api/v1/departments") {
        if (call.method === "POST") {
          const body = z.object({ displayName: z.string() }).parse(call.body);
          const department = {
            ...SALES,
            id: "new",
            displayName: body.displayName,
            displayOrder: 3,
          };
          departments.push(department);
          return json(201, { department });
        }
        return json(200, { departments });
      }
      if (call.url.pathname === "/api/v1/departments/sales" && call.method === "PATCH") {
        const body = z.object({ displayName: z.string() }).parse(call.body);
        const department = { ...SALES, displayName: body.displayName };
        departments = departments.map((row) => (row.id === "sales" ? department : row));
        return json(200, { department });
      }
      return undefined;
    },
  });
  const user = userEvent.setup();
  renderAt("/settings/departments");
  await screen.findByRole("button", { name: "Rename Sales" });
  const names = () =>
    screen.getAllByRole("button", { name: /^Rename / }).map((button) => button.textContent);
  expect(names()).toEqual(["legal", "Sales"]);
  expect(screen.queryByRole("button", { name: /^Reorder / })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Add Department" }));
  await user.type(screen.getByRole("textbox", { name: "New Department name" }), "Marketing{Enter}");
  await waitFor(() => expect(names()).toEqual(["legal", "Marketing", "Sales"]));
  await user.click(screen.getByRole("button", { name: "Rename Sales" }));
  const input = screen.getByRole("textbox", { name: "Rename Sales" });
  await user.clear(input);
  await user.type(input, "Accounting{Enter}");
  await waitFor(() => expect(names()).toEqual(["Accounting", "legal", "Marketing"]));
});
