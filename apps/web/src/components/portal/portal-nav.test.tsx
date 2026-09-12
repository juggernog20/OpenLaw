// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntlProvider } from "react-intl";
import { MemoryRouter } from "react-router";
import { expect, it } from "vitest";
import { PortalNav } from "./portal-nav";

function renderNav(path: string) {
  render(
    <IntlProvider locale="en-US">
      <MemoryRouter initialEntries={[path]}>
        <PortalNav />
      </MemoryRouter>
    </IntlProvider>,
  );
  return within(screen.getByRole("navigation", { name: "Portal" }));
}

it.each([
  ["/portal", "Requests"],
  ["/portal/new/nda", "Requests"],
  ["/portal/requests/42", "Requests"],
  ["/portal/contracts?q=supply", "Contracts"],
  ["/portal/contracts/42", "Contracts"],
  ["/portal/matters", "Matters"],
  ["/portal/matters/42", "Matters"],
])("marks the current destination at %s", (path, name) => {
  const nav = renderNav(path);
  expect(nav.getByRole("link", { current: "page" })).toHaveAccessibleName(name);
});

it("leaves every destination available on settings without marking one current", async () => {
  const nav = renderNav("/portal/settings");
  expect(nav.queryByRole("link", { current: "page" })).not.toBeInTheDocument();
  const user = userEvent.setup();
  await user.tab();
  expect(nav.getByRole("link", { name: "Requests" })).toHaveFocus();
  await user.tab();
  await user.keyboard("{Enter}");
  expect(nav.getByRole("link", { current: "page" })).toHaveAccessibleName("Contracts");
  await user.click(nav.getByRole("link", { name: "Matters" }));
  expect(nav.getByRole("link", { current: "page" })).toHaveAccessibleName("Matters");
  await user.click(nav.getByRole("link", { name: "Requests" }));
  expect(nav.getByRole("link", { current: "page" })).toHaveAccessibleName("Requests");
});
