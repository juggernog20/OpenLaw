// SPDX-License-Identifier: AGPL-3.0-only

/** CTR-026's People card adds, reorders, and removes default people. */
import { expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderAt, stubApi, json, problem } from "../testing/helpers";

it("manages default people from the Contract Type editor", async () => {
  const user = userEvent.setup();
  const admin = {
    id: "admin",
    displayName: "Admin",
    email: "admin@example.com",
    role: "administrator",
    theme: "light",
  };
  const alice = {
    id: "alice",
    displayName: "Alice",
    role: "business_user",
    archived: false,
    displayOrder: 0,
  };
  const bob = {
    id: "bob",
    displayName: "Bob",
    role: "legal_team_member",
    archived: false,
    displayOrder: 1,
  };
  let people = [alice];
  const orders: unknown[] = [];
  let rejectAdd: false | "detail" | "network" = false;
  stubApi({
    signedIn: admin,
    extra: (call) => {
      const path = call.url.pathname;
      if (path === "/api/v1/me") return json(200, { user: admin });
      if (path === "/api/v1/users")
        return json(200, { users: [alice, bob].map((p) => ({ ...p, status: "active" })) });
      if (path === "/api/v1/contract-types/t1")
        return json(200, {
          contractType: {
            id: "t1",
            displayName: "NDA",
            slug: "nda",
            description: null,
            archivedAt: null,
            inUseCount: 0,
          },
        });
      if (path === "/api/v1/contract-types/t1/fields") return json(200, { attachedFields: [] });
      if (path === "/api/v1/contract-types/t1/approval-default")
        return json(200, { groupId: null });
      if (path === "/api/v1/approver-groups") return json(200, { approverGroups: [] });
      if (path === "/api/v1/fields") return json(200, { fields: [] });
      if (path === "/api/v1/contract-types/t1/people") {
        if (call.method === "POST" && rejectAdd === "network")
          throw new TypeError("Network unavailable");
        if (call.method === "POST" && rejectAdd)
          return problem(409, "Restore this Contract Type before changing its default people.");
        if (call.method === "POST") people = [alice, bob];
        return json(call.method === "POST" ? 201 : 200, { people });
      }
      if (path.endsWith("/people/order")) {
        orders.push(call.body);
        people = [bob, alice];
        return json(200, { people });
      }
      if (path.endsWith("/people/alice") && call.method === "DELETE") {
        people = [bob];
        return json(200, { people });
      }
      return undefined;
    },
  });
  renderAt("/settings/contracts/types/t1");
  await screen.findByRole("heading", { name: "People" });
  await user.selectOptions(screen.getByRole("combobox", { name: "Default person" }), "bob");
  await user.click(screen.getByRole("button", { name: "Add person" }));
  await screen.findByRole("button", { name: "Move Bob up" });
  await user.click(screen.getByRole("button", { name: "Move Bob up" }));
  await waitFor(() => expect(orders).toEqual([{ userIds: ["bob", "alice"] }]));
  expect(await screen.findByText("Default people reordered.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Remove Alice" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Remove Alice" })).not.toBeInTheDocument(),
  );
  rejectAdd = "detail";
  await user.selectOptions(screen.getByRole("combobox", { name: "Default person" }), "alice");
  await user.click(screen.getByRole("button", { name: "Add person" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Restore this Contract Type");
  expect(screen.queryByRole("button", { name: "Remove Alice" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Remove Bob" })).toBeVisible();
  rejectAdd = "network";
  await user.click(screen.getByRole("button", { name: "Add person" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not save default people. Please try again.",
  );
});
