// SPDX-License-Identifier: AGPL-3.0-only

import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { json, renderAt, stubApi } from "../testing/helpers";

it("manages currencies inside General and retains the list after reopening", async () => {
  let currencies = ["USD"];
  stubApi({
    signedIn: {
      id: "admin",
      email: "admin@example.com",
      displayName: "Administrator",
      role: "administrator",
    },
    extra: (call) => {
      if (call.url.pathname.startsWith("/api/v1/org/currencies")) {
        if (call.method === "POST")
          currencies = [...currencies, (call.body as { code: string }).code];
        if (call.method === "DELETE")
          currencies = currencies.filter((code) => !call.url.pathname.endsWith(code));
        return json(200, { currencies, canManage: true });
      }
      return undefined;
    },
  });
  const { router } = renderAt("/settings/general");
  const user = userEvent.setup();
  expect(await screen.findByRole("heading", { name: "Currencies in use" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Currencies in use" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Add new currency" }));
  const dialog = await screen.findByRole("dialog");
  await user.type(within(dialog).getByRole("searchbox"), "euro");
  await user.click(within(dialog).getByRole("button", { name: "EUR Euro" }));
  await screen.findByRole("button", { name: "Remove EUR" });
  await user.click(screen.getByRole("button", { name: "Remove USD" }));
  await waitFor(() => expect(currencies).toEqual(["EUR"]));
  await router.navigate("/settings/profile");
  await router.navigate("/settings/general");
  expect(await screen.findByRole("button", { name: "Remove EUR" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Remove USD" })).not.toBeInTheDocument();
});
