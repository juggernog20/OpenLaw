// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Set-password activation: token handling and the local validation the
 * server never sees (the confirm field). Token lifecycle itself is
 * covered at the HTTP seam in apps/api.
 */

import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, renderAt, stubFetch } from "../testing/helpers";

describe("set-password activation", () => {
  it("refuses to submit without a token in the link", async () => {
    stubFetch(() => undefined);
    renderAt("/auth/set-password");
    expect(await screen.findByRole("alert")).toHaveTextContent("This link is not valid.");
    expect(screen.getByRole("button", { name: "Set password" })).toBeDisabled();
  });

  it("catches a mismatched confirmation before any request", async () => {
    const fetchStub = stubFetch(() => undefined);
    renderAt("/auth/set-password?token=tok-123");

    await userEvent.type(await screen.findByLabelText("New password"), "long-enough-1");
    await userEvent.type(screen.getByLabelText("Confirm password"), "long-enough-2");
    await userEvent.click(screen.getByRole("button", { name: "Set password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The passwords do not match.");
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("sets the password and hands off to sign-in", async () => {
    stubFetch((call) =>
      call.url.pathname === "/api/auth/reset-password" && call.method === "POST"
        ? json(200, { status: true })
        : undefined,
    );
    renderAt("/auth/set-password?token=tok-123");

    await userEvent.type(await screen.findByLabelText("New password"), "long-enough-1");
    await userEvent.type(screen.getByLabelText("Confirm password"), "long-enough-1");
    await userEvent.click(screen.getByRole("button", { name: "Set password" }));

    expect(await screen.findByRole("heading", { name: "Password set" })).toBeInTheDocument();
  });

  it("explains an expired or used token", async () => {
    stubFetch((call) =>
      call.url.pathname === "/api/auth/reset-password" && call.method === "POST"
        ? json(400, { code: "INVALID_TOKEN", message: "invalid token" })
        : undefined,
    );
    renderAt("/auth/set-password?token=tok-stale");

    await userEvent.type(await screen.findByLabelText("New password"), "long-enough-1");
    await userEvent.type(screen.getByLabelText("Confirm password"), "long-enough-1");
    await userEvent.click(screen.getByRole("button", { name: "Set password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This link has expired or was already used.",
    );
  });
});
