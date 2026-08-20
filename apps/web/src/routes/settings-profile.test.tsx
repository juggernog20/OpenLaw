// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Profile pane (SET-006, #67) at the route seam: self-service
 * mutations ride better-auth's mounted routes, the timezone rides the
 * widened preference endpoint, email and role render read-only, and the
 * password/two-factor cards only exist for accounts with a password
 * credential. The API-side semantics (audit entries, session survival)
 * are proven at the HTTP seam in apps/api.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, renderAt, stubApi, type StubCall } from "../testing/helpers";

const MEMBER = {
  id: "u2",
  email: "casey@example.com",
  displayName: "Casey Counsel",
  role: "legal_team_member",
};

const TOTP_URI =
  "otpauth://totp/OpenLaw:casey%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=OpenLaw";

describe("the Profile pane (SET-006, #67)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows email and role read-only, with the Users pointer", async () => {
    // The credential fixture is stamped 2026-05-02; the clock is frozen
    // in the same year so "May 2" (year elided) stays true after 2026.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-11T00:00:00Z"));
    stubApi({ signedIn: MEMBER });
    renderAt("/settings/profile");

    const email = await screen.findByLabelText("Email");
    expect(email).toHaveValue(MEMBER.email);
    expect(email).toHaveAttribute("readonly");
    expect(screen.getByText("Legal team member")).toBeVisible();
    expect(screen.getByText("Roles are managed in Organization → Users.")).toBeVisible();
    // The password credential's stamp, from the linked-accounts read.
    expect(screen.getByText("Last changed May 2.")).toBeVisible();
  });

  it("commits a display-name edit on blur through better-auth's update-user", async () => {
    const user = userEvent.setup();
    const updates: unknown[] = [];
    stubApi({
      signedIn: MEMBER,
      extra: (call: StubCall) => {
        if (call.url.pathname === "/api/auth/update-user" && call.method === "POST") {
          updates.push(call.body);
          return json(200, { status: true });
        }
        return undefined;
      },
    });
    renderAt("/settings/profile");

    const name = await screen.findByLabelText("Full name");
    await user.clear(name);
    await user.type(name, "Casey Q. Counsel");
    await user.tab();

    await waitFor(() => expect(updates).toEqual([{ name: "Casey Q. Counsel" }]));
    expect(await screen.findByText("Saved")).toBeVisible();
  });

  it("commits a timezone pick, and clears back to the browser default", async () => {
    const user = userEvent.setup();
    const patches: unknown[] = [];
    stubApi({
      signedIn: { ...MEMBER, timezone: null },
      extra: (call: StubCall) => {
        if (call.url.pathname === "/api/v1/me/preferences" && call.method === "PATCH") {
          patches.push(call.body);
          const timezone = (call.body as { timezone: string | null }).timezone;
          return json(200, { user: { ...MEMBER, theme: "light", image: null, timezone } });
        }
        return undefined;
      },
    });
    renderAt("/settings/profile");

    // The unset override reads as the DES-014 default.
    const picker = await screen.findByLabelText("Timezone");
    expect(picker).toHaveValue("Use browser timezone");

    await user.click(picker);
    await user.keyboard("Dubai");
    await user.click(await screen.findByRole("option", { name: /Asia\/Dubai/ }));
    await waitFor(() => expect(patches).toEqual([{ timezone: "Asia/Dubai" }]));
    expect(picker).toHaveValue("Asia/Dubai");

    // "Use browser timezone" is itself an option, committing null.
    await user.click(picker);
    await user.click(await screen.findByRole("option", { name: "Use browser timezone" }));
    await waitFor(() => expect(patches).toEqual([{ timezone: "Asia/Dubai" }, { timezone: null }]));
  });

  it("signs out other devices through better-auth's revoke endpoint", async () => {
    const user = userEvent.setup();
    let revoked = 0;
    stubApi({
      signedIn: MEMBER,
      extra: (call: StubCall) => {
        if (call.url.pathname === "/api/auth/revoke-other-sessions" && call.method === "POST") {
          revoked += 1;
          return json(200, { status: true });
        }
        return undefined;
      },
    });
    renderAt("/settings/profile");

    await user.click(await screen.findByRole("button", { name: "Sign out other devices" }));

    await waitFor(() => expect(revoked).toBe(1));
    expect(await screen.findByText("Saved")).toBeVisible();
  });

  it("walks the TOTP enrolment: password, QR + code, then backup codes", async () => {
    const user = userEvent.setup();
    stubApi({
      signedIn: MEMBER,
      extra: (call: StubCall) => {
        if (call.url.pathname === "/api/auth/two-factor/enable" && call.method === "POST") {
          return json(200, {
            // 1.7 says which factor it enrolled; the screen narrows on it.
            method: "totp",
            totpURI: TOTP_URI,
            backupCodes: ["AAAAA-11111", "BBBBB-22222"],
          });
        }
        if (call.url.pathname === "/api/auth/two-factor/verify-totp" && call.method === "POST") {
          return json(200, { token: "tok", user: {} });
        }
        return undefined;
      },
    });
    renderAt("/settings/profile");

    // Off state: the single enable affordance.
    await user.click(await screen.findByRole("button", { name: "Turn on two-factor" }));

    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Password"), "correct-horse-battery");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));

    // The QR step surfaces the manual-entry secret from the URI.
    expect(await within(dialog).findByText("JBSWY3DPEHPK3PXP")).toBeVisible();
    await user.type(within(dialog).getByLabelText("Code"), "000000");
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));

    // Backup codes are shown once; Done dismisses.
    expect(await within(dialog).findByText("AAAAA-11111")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // The card now reads as on, with re-enrol and disable affordances.
    expect(screen.getByRole("button", { name: "Re-enroll" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Turn off two-factor" })).toBeVisible();
  });

  it("changes the password through better-auth's change-password", async () => {
    const user = userEvent.setup();
    const changes: unknown[] = [];
    stubApi({
      signedIn: MEMBER,
      extra: (call: StubCall) => {
        if (call.url.pathname === "/api/auth/change-password" && call.method === "POST") {
          changes.push(call.body);
          return json(200, { token: null, user: {} });
        }
        return undefined;
      },
    });
    renderAt("/settings/profile");

    await user.click(await screen.findByRole("button", { name: "Change password" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Current password"), "old-pass-123");
    await user.type(within(dialog).getByLabelText("New password"), "new-pass-456");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(changes).toEqual([
        {
          currentPassword: "old-pass-123",
          newPassword: "new-pass-456",
          // The other-device sign-out rides every password change.
          revokeOtherSessions: true,
        },
      ]),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("keeps the dialog open with an error when the current password is wrong", async () => {
    const user = userEvent.setup();
    stubApi({
      signedIn: MEMBER,
      extra: (call: StubCall) => {
        if (call.url.pathname === "/api/auth/change-password" && call.method === "POST") {
          return json(400, { code: "INVALID_PASSWORD", message: "Invalid password" });
        }
        return undefined;
      },
    });
    renderAt("/settings/profile");

    await user.click(await screen.findByRole("button", { name: "Change password" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Current password"), "wrong-pass-123");
    await user.type(within(dialog).getByLabelText("New password"), "new-pass-456");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(
      await within(dialog).findByText(
        "The password could not be changed. Check your current password and use at least 8 characters.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("stays on the QR step with an error when the code is wrong", async () => {
    const user = userEvent.setup();
    stubApi({
      signedIn: MEMBER,
      extra: (call: StubCall) => {
        if (call.url.pathname === "/api/auth/two-factor/enable" && call.method === "POST") {
          return json(200, { method: "totp", totpURI: TOTP_URI, backupCodes: ["AAAAA-11111"] });
        }
        if (call.url.pathname === "/api/auth/two-factor/verify-totp" && call.method === "POST") {
          return json(401, { code: "INVALID_CODE", message: "Invalid code" });
        }
        return undefined;
      },
    });
    renderAt("/settings/profile");

    await user.click(await screen.findByRole("button", { name: "Turn on two-factor" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Password"), "correct-horse-battery");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));

    await user.type(await within(dialog).findByLabelText("Code"), "999999");
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));

    expect(
      await within(dialog).findByText("Wrong code. Scan the QR code again and retry."),
    ).toBeVisible();
    // Still on the verify step — the secret stays on screen for a rescan.
    expect(within(dialog).getByText("JBSWY3DPEHPK3PXP")).toBeVisible();
  });

  it("refuses to walk an enrolment that is not TOTP", async () => {
    const user = userEvent.setup();
    stubApi({
      signedIn: MEMBER,
      extra: (call: StubCall) => {
        if (call.url.pathname === "/api/auth/two-factor/enable" && call.method === "POST") {
          // The other factor better-auth 1.7 can answer with. This
          // install configures no sendOTP, so reaching it means the
          // server is set up differently from what this screen draws —
          // there is no QR code and no backup codes to show.
          return json(200, { method: "otp" });
        }
        return undefined;
      },
    });
    renderAt("/settings/profile");

    await user.click(await screen.findByRole("button", { name: "Turn on two-factor" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Password"), "correct-horse-battery");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));

    expect(
      await within(dialog).findByText("The server could not be reached. Try again."),
    ).toBeVisible();
    // It stopped at the password step rather than drawing an empty QR.
    expect(within(dialog).queryByLabelText("Code")).not.toBeInTheDocument();
  });

  it("rejects an oversized avatar client-side without calling the API", async () => {
    const user = userEvent.setup();
    stubApi({ signedIn: MEMBER });
    renderAt("/settings/profile");

    await screen.findByLabelText("Full name");
    const oversized = new File([new Uint8Array(1024 * 1024 + 1)], "big.png", {
      type: "image/png",
    });
    await user.upload(screen.getByLabelText("Upload a profile photo"), oversized);

    // The error micro-state, with no update-user call — the stub would
    // have thrown on an unstubbed POST.
    expect(await screen.findByText("The change could not be saved. Try again.")).toBeVisible();
  });

  it("hides the password & two-factor card for an account without a password", async () => {
    stubApi({ signedIn: { ...MEMBER, hasPassword: false } });
    renderAt("/settings/profile");

    await screen.findByLabelText("Full name");
    expect(screen.queryByText("Password & two-factor")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change password" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Turn on two-factor" })).not.toBeInTheDocument();
    // The rest of the pane stands: sessions and timezone are universal.
    expect(screen.getByRole("button", { name: "Sign out other devices" })).toBeVisible();
    expect(screen.getByLabelText("Timezone")).toBeVisible();
  });
});
