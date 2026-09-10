// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntlProvider } from "react-intl";
import { describe, expect, it } from "vitest";
import { json, problem, stubApi } from "../testing/helpers";
import { CurrencySelect } from "./currency-select";

function Example() {
  const [value, setValue] = useState("JPY");
  return (
    <IntlProvider locale="en-US" defaultLocale="en-US">
      <CurrencySelect aria-label="Currency" value={value} onValueChange={setValue} />
      <CurrencySelect aria-label="Other currency" value="" onValueChange={() => {}} />
      <output>{value}</output>
    </IntlProvider>
  );
}

describe("shared currency picker", () => {
  it("offers enabled currencies, preserves a saved code, and adds a currency for every mounted picker", async () => {
    let currencies = ["USD"];
    stubApi({
      extra: (call) => {
        if (call.url.pathname === "/api/v1/org/currencies") {
          if (call.method === "POST")
            currencies = [...currencies, (call.body as { code: string }).code];
          return json(200, { currencies, canManage: true });
        }
        return undefined;
      },
    });
    render(<Example />);
    const user = userEvent.setup();
    const picker = screen.getByRole("combobox", { name: "Currency" });
    await within(picker).findByRole("option", { name: /USD/ });
    expect(within(picker).getByRole("option", { name: /JPY/ })).toBeInTheDocument();
    expect(within(picker).queryByRole("option", { name: /EUR/ })).not.toBeInTheDocument();
    await user.selectOptions(picker, "__add_currency__");
    const dialog = await screen.findByRole("dialog", { name: "Add new currency" });
    await user.type(within(dialog).getByRole("searchbox"), "euro");
    await user.click(within(dialog).getByRole("button", { name: "EUR Euro" }));
    await waitFor(() => expect(picker).toHaveValue("EUR"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(picker).toHaveFocus();
    expect(
      within(screen.getByRole("combobox", { name: "Other currency" })).getByRole("option", {
        name: /EUR/,
      }),
    ).toBeInTheDocument();
  });

  it("keeps the current value on cancellation or a failed addition", async () => {
    stubApi({
      extra: (call) => {
        if (call.url.pathname === "/api/v1/org/currencies")
          return call.method === "GET"
            ? json(200, { currencies: ["USD"], canManage: true })
            : problem(500, "Could not add currency.");
        return undefined;
      },
    });
    render(<Example />);
    const user = userEvent.setup();
    const picker = screen.getByRole("combobox", { name: "Currency" });
    await within(picker).findByRole("option", { name: "Add new currency" });
    await user.selectOptions(picker, "__add_currency__");
    let dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(picker).toHaveValue("JPY");
    await user.selectOptions(picker, "__add_currency__");
    dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("searchbox"), "euro");
    await user.click(within(dialog).getByRole("button", { name: "EUR Euro" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Could not add currency.");
    expect(picker).toHaveValue("JPY");
  });

  it("does not offer settings changes to readers without permission", async () => {
    stubApi({
      extra: (call) =>
        call.url.pathname === "/api/v1/org/currencies"
          ? json(200, { currencies: ["USD"], canManage: false })
          : undefined,
    });
    render(<Example />);
    const picker = screen.getByRole("combobox", { name: "Currency" });
    await within(picker).findByRole("option", { name: /USD/ });
    expect(
      within(picker).queryByRole("option", { name: "Add new currency" }),
    ).not.toBeInTheDocument();
  });
});
