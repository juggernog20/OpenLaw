// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { setupForm } from "../testing/type-form";

describe("the contract type editor", () => {
  it("keeps identity on Details and opens the routed Form tab", async () => {
    const { user } = setupForm("contract");
    await user.click(await screen.findByRole("link", { name: "Details" }));
    expect(await screen.findByLabelText("Display name")).toHaveValue("Test type");
    expect(screen.queryByLabelText("Slug")).not.toBeInTheDocument();
    expect(screen.getByText("0 contracts use this type.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All types" })).toHaveAttribute(
      "href",
      "/settings/contracts/types",
    );
    expect(screen.queryByRole("heading", { name: "Form" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Form" }));
    expect(await screen.findByRole("heading", { name: "Form" })).toBeInTheDocument();
  });
  it("commits identity on Enter and description on blur", async () => {
    const { user, patches } = setupForm("contract");
    await user.click(await screen.findByRole("link", { name: "Details" }));
    const name = await screen.findByLabelText("Display name");
    await user.clear(name);
    await user.type(name, "Updated type{Enter}");
    await waitFor(() => expect(patches).toContainEqual({ displayName: "Updated type" }));
    await user.type(screen.getByLabelText("Description"), "Updated description");
    await user.tab();
    await waitFor(() => expect(patches).toContainEqual({ description: "Updated description" }));
  });
  it("writes Required for creation and detaches through the whole Form", async () => {
    const { user, writes } = setupForm("contract");
    await user.click(
      await screen.findByRole("switch", { name: "Business justification: Required for creation" }),
    );
    await waitFor(() => expect(writes.at(-1)?.at(-1)).toMatchObject({ isRequired: true }));
    await user.click(screen.getByRole("button", { name: "Detach Business justification" }));
    await waitFor(() => expect(writes.at(-1)?.some((n) => n.id === "f1")).toBe(false));
    await user.click(screen.getByRole("button", { name: "Attach Field" }));
    expect(
      await screen.findByRole("menuitem", { name: /Business justification/ }),
    ).toBeInTheDocument();
  });
});
