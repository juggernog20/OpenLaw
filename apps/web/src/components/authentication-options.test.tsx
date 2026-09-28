// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntlProvider } from "react-intl";
import { expect, it, vi } from "vitest";
import { AuthenticationOptionsFields } from "./authentication-options";

it("explains a pending save on hover and keyboard focus without changing a disabled method", async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(
    <IntlProvider locale="en" defaultLocale="en">
      <AuthenticationOptionsFields
        value={{ password: false, magicLink: false, sso: false, requireTwoFactor: false }}
        onChange={onChange}
        disabled
        ssoConfigured={false}
      />
    </IntlProvider>,
  );
  const target = screen.getByRole("group", { name: "Email and password" });
  const reason = "Wait for the current changes to finish saving.";
  expect(screen.getByRole("switch", { name: "Email and password" })).toHaveAccessibleDescription(
    reason,
  );
  await user.hover(target);
  expect(await screen.findByRole("tooltip")).toHaveTextContent(reason);
  await user.unhover(target);
  await user.tab();
  expect(target).toHaveFocus();
  expect(await screen.findByRole("tooltip")).toHaveTextContent(reason);
  await user.keyboard("{Enter} ");
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole("switch", { name: "Email and password" })).toBeDisabled();
  expect(screen.getByRole("switch", { name: "Single sign-on (SSO)" })).toHaveAccessibleDescription(
    "Configure an identity provider below to enable single sign-on.",
  );
});

it("explains missing SSO configuration and leaves other methods usable", async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(
    <IntlProvider locale="en" defaultLocale="en">
      <AuthenticationOptionsFields
        value={{ password: false, magicLink: false, sso: false, requireTwoFactor: false }}
        onChange={onChange}
        ssoConfigured={false}
      />
    </IntlProvider>,
  );
  await user.hover(screen.getByRole("group", { name: "Single sign-on (SSO)" }));
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "Configure an identity provider below to enable single sign-on.",
  );
  await user.click(screen.getByRole("switch", { name: "Email and password" }));
  expect(onChange).toHaveBeenCalledWith({
    password: true,
    magicLink: false,
    sso: false,
    requireTwoFactor: false,
  });
});
