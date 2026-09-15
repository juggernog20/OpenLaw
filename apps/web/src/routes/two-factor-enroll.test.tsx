// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi } from "../testing/helpers";

it.each(["legal_team_member", "business_user"])(
  "requires %s to enroll and offers the correct destination with backup codes",
  async (role) => {
    const signedIn = {
      id: "u1",
      email: "staff@example.com",
      displayName: "Staff",
      role,
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
    expect(screen.getByRole("link", { name: "Done" })).toHaveAttribute(
      "href",
      role === "business_user" ? "/portal" : "/",
    );
  },
);

it.each(["enable", "verify"])("keeps enrollment required when %s fails", async (stage) => {
  stubApi({
    signedIn: {
      id: "u1",
      email: "staff@example.com",
      displayName: "Staff",
      role: "legal_team_member",
      twoFactorRequired: true,
      twoFactorSetupRequired: true,
      twoFactorEnabled: false,
    },
    extra: (call) => {
      if (call.url.pathname === "/api/auth/two-factor/enable")
        return stage === "enable"
          ? problem(400, "Enrollment refused")
          : json(200, {
              method: "totp",
              totpURI: "otpauth://totp/OpenLaw?secret=JBSWY3DPEHPK3PXP",
              backupCodes: ["backup"],
            });
      if (call.url.pathname === "/api/auth/two-factor/verify-totp")
        return problem(401, "Invalid code");
      return undefined;
    },
  });
  const { router } = renderAt("/settings/profile");
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Password"), "staff-password");
  await user.click(screen.getByRole("button", { name: "Turn on two-factor" }));
  if (stage === "verify") {
    await user.type(await screen.findByLabelText(/code/i), "123456");
    await user.click(screen.getByRole("button", { name: "Confirm" }));
  }
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.getByLabelText(stage === "enable" ? "Password" : /code/i)).toBeVisible();
  expect(router.state.location.pathname).toBe("/auth/two-factor/enroll");
  await router.navigate("/settings/profile");
  expect(await screen.findByLabelText(stage === "enable" ? "Password" : /code/i)).toBeVisible();
  expect(router.state.location.pathname).toBe("/auth/two-factor/enroll");
});
