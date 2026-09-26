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
};

function settingsApi(module: string, fixed = false) {
  let row = {
    id: "dt1",
    slug: fixed ? "executed" : "board_paper",
    displayName: fixed ? "Executed" : "Board paper",
    description: null,
    displayOrder: 1,
    isSystemDefault: fixed,
    archivedAt: null,
    inUseCount: 2,
    systemKind: fixed ? "executed" : null,
    color: null as string | null,
  };
  let fail = false;
  const writes: unknown[] = [];
  stubApi({
    signedIn: ADMIN,
    extra: (call) => {
      if (call.url.pathname === `/api/v1/documents/types/${module}` && call.method === "GET")
        return json(200, { documentTypes: [row] });
      if (
        call.url.pathname === `/api/v1/documents/types/${module}/dt1` &&
        call.method === "PATCH"
      ) {
        writes.push(call.body);
        if (fail) return problem(503, "Colour changes are temporarily unavailable.");
        row = { ...row, ...(call.body as { color: string | null }) };
        return json(200, { documentType: row });
      }
      return undefined;
    },
  });
  return {
    writes,
    fail: () => {
      fail = true;
    },
  };
}

describe.each([
  ["matter", "matters"],
  ["contract", "contracts"],
  ["entity", "entities"],
])("%s document type colours", (module, tab) => {
  it("saves a colour, retains the selection after a reload, and restores Automatic", async () => {
    const user = userEvent.setup();
    const api = settingsApi(module!);
    const first = renderAt(`/settings/documents/${tab}`);
    await user.click(await screen.findByRole("button", { name: "Colour for Board paper" }));
    await user.click(screen.getByRole("button", { name: "Purple" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.writes).toEqual([{ color: "purple" }]);
    first.view.unmount();

    renderAt(`/settings/documents/${tab}`);
    await user.click(await screen.findByRole("button", { name: "Colour for Board paper" }));
    expect(screen.getByRole("button", { name: "Purple" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Automatic" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.writes).toEqual([{ color: "purple" }, { color: null }]);
  });
});

it("allows a fixed type's colour to change while its name remains locked", async () => {
  const user = userEvent.setup();
  const api = settingsApi("contract", true);
  renderAt("/settings/documents/contracts");
  await user.click(await screen.findByRole("button", { name: "Colour for Executed" }));
  expect(screen.queryByLabelText("Rename Executed")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Blue" }));
  await waitFor(() => expect(api.writes).toEqual([{ color: "blue" }]));
});

it("keeps the previous colour selected and shows a failed save", async () => {
  const user = userEvent.setup();
  const api = settingsApi("matter");
  api.fail();
  renderAt("/settings/documents/matters");
  await user.click(await screen.findByRole("button", { name: "Colour for Board paper" }));
  await user.click(screen.getByRole("button", { name: "Red" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Colour changes are temporarily unavailable.",
  );
  const picker = within(screen.getByRole("dialog"));
  expect(picker.getByRole("button", { name: "Automatic" })).toHaveAttribute("aria-pressed", "true");
  expect(picker.getByRole("button", { name: "Red" })).toHaveAttribute("aria-pressed", "false");
});
