// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi } from "../testing/helpers";

const ADMIN = {
  id: "u1",
  email: "admin@example.com",
  displayName: "Admin",
  role: "administrator",
  theme: "light",
};

describe("outbound email settings", () => {
  it("lets an administrator save a relay after onboarding is complete", async () => {
    const writes: unknown[] = [];
    stubApi({
      signedIn: ADMIN,
      onboarding: { completed: true },
      emailSettings: { source: "unset", fromAddress: null },
      extra: (call) => {
        if (call.url.pathname === "/api/v1/email-settings" && call.method === "PUT") {
          writes.push(call.body);
          return json(200, { source: "app", fromAddress: "Legal <legal@example.com>" });
        }
        return undefined;
      },
    });
    renderAt("/settings/email");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("SMTP server"), "smtp.example.com");
    await user.type(screen.getByLabelText("SMTP username"), "legal@example.com");
    await user.type(screen.getByLabelText("SMTP password"), "test-only-password");
    await user.type(screen.getByLabelText("Sender name (optional)"), "Legal");
    await user.type(screen.getByLabelText("Sender email"), "legal@example.com");
    await user.click(screen.getByRole("button", { name: "Save relay" }));
    expect(await screen.findByText(/Relay saved/)).toBeInTheDocument();
    expect(writes).toEqual([
      {
        host: "smtp.example.com",
        port: 587,
        security: "starttls",
        authentication: {
          type: "password",
          username: "legal@example.com",
          password: "test-only-password",
        },
        senderName: "Legal",
        senderEmail: "legal@example.com",
      },
    ]);
    expect(screen.queryByLabelText("SMTP password")).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("navigation", { name: "Settings sections" })).getByRole("link", {
        name: "Outbound email",
      }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("keeps the current relay on cancel and preserves the draft after a refused save", async () => {
    let puts = 0;
    stubApi({
      signedIn: ADMIN,
      emailSettings: { source: "app", fromAddress: "old@example.com" },
      extra: (call) => {
        if (call.url.pathname === "/api/v1/email-settings" && call.method === "PUT") {
          puts++;
          return problem(400, "The sender address was refused.");
        }
        return undefined;
      },
    });
    renderAt("/settings/email");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Replace relay" }));
    expect(screen.getByLabelText("SMTP password")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(puts).toBe(0);
    await user.click(screen.getByRole("button", { name: "Replace relay" }));
    await user.type(screen.getByLabelText("SMTP server"), "relay.internal");
    await user.selectOptions(screen.getByLabelText("Authentication"), "none");
    await user.type(screen.getByLabelText("Sender email"), "new@example.com");
    await user.click(screen.getByRole("button", { name: "Save relay" }));
    expect(await screen.findByText("The sender address was refused.")).toBeInTheDocument();
    expect(screen.getByLabelText("SMTP server")).toHaveValue("relay.internal");
    expect(screen.getByText("Sender: old@example.com")).toBeInTheDocument();
  });

  it.each([true, false])(
    "reports test delivery success=%s without sending automatically",
    async (success) => {
      let sends = 0;
      stubApi({
        signedIn: ADMIN,
        emailSettings: { source: "app", fromAddress: "legal@example.com" },
        extra: (call) => {
          if (call.url.pathname === "/api/v1/email-settings/test" && call.method === "POST") {
            sends++;
            return success
              ? json(200, { delivered: true, to: ADMIN.email })
              : problem(502, "The relay rejected the credentials.");
          }
          return undefined;
        },
      });
      renderAt("/settings/email");
      const user = userEvent.setup();
      const button = await screen.findByRole("button", { name: "Send test email" });
      expect(sends).toBe(0);
      await user.click(button);
      expect(
        await screen.findByText(
          success ? /Test email sent to admin@example.com/ : "The relay rejected the credentials.",
        ),
      ).toBeInTheDocument();
      expect(sends).toBe(1);
    },
  );

  it.each(["sender@example.com", null])(
    "keeps deployment-managed email read-only (sender=%s)",
    async (fromAddress) => {
      stubApi({ signedIn: ADMIN, emailSettings: { source: "env", fromAddress } });
      renderAt("/settings/email");
      expect(
        await screen.findByText(/Managed by your deployment configuration/),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Replace relay" })).not.toBeInTheDocument();
      expect(screen.queryByLabelText("SMTP server")).not.toBeInTheDocument();
      const button = screen.getByRole("button", { name: "Send test email" });
      if (fromAddress) expect(button).toBeEnabled();
      else expect(button).toBeDisabled();
    },
  );

  it("redirects non-administrators before reading email settings", async () => {
    let reads = 0;
    stubApi({
      signedIn: { ...ADMIN, role: "legal_team_member" },
      extra: (call) => {
        if (call.url.pathname === "/api/v1/email-settings") reads++;
        return undefined;
      },
    });
    const { router } = renderAt("/settings/email");
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/profile"));
    expect(reads).toBe(0);
  });
});
