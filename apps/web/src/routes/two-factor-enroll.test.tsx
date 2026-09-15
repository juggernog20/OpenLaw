// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, renderAt, stubApi } from "../testing/helpers";

it("requires staff to enroll before opening app routes and shows backup codes after verification", async () => {
  const signedIn = {
    id: "u1",
    email: "staff@example.com",
    displayName: "Staff",
    role: "legal_team_member",
    twoFactorRequired: true,
    twoFactorSetupRequired: true,
    twoFactorEnabled: false,
  };
  stubApi({
    signedIn,
    extra: (call) => {
      if (call.url.pathname === "/api/auth/two-factor/enable")
        return json(200, {
          method: "totp",
          totpURI: "otpauth://totp/OpenLaw?secret=JBSWY3DPEHPK3PXP",
          backupCodes: ["backup-test-code"],
        });
      if (call.url.pathname === "/api/auth/two-factor/verify-totp") {
        signedIn.twoFactorEnabled = true;
        signedIn.twoFactorSetupRequired = false;
        return json(200, { status: true });
      }
      return undefined;
    },
  });
  const { router } = renderAt("/settings/profile");
  const user = userEvent.setup();
  expect(
    await screen.findByText(/Your organization requires two-factor authentication/),
  ).toBeVisible();
  expect(router.state.location.pathname).toBe("/auth/two-factor/enroll");
  expect(screen.queryByRole("button", { name: /Turn off/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign out" })).toBeVisible();
  await user.type(screen.getByLabelText("Password"), "staff-password");
  await user.click(screen.getByRole("button", { name: "Turn on two-factor" }));
  await user.type(await screen.findByLabelText(/code/i), "123456");
  await user.click(screen.getByRole("button", { name: "Confirm" }));
  expect(await screen.findByText("backup-test-code")).toBeVisible();
});
