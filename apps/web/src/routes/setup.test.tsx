// SPDX-License-Identifier: AGPL-3.0-only

/**
 * First-run setup screen: creates the Administrator and lands signed
 * in; the 409 race (someone else finished setup first) is surfaced with
 * a path to sign-in. The server-side invariant is covered in apps/api.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi, type ApiState, type StubCall } from "../testing/helpers";
import { setupLoader } from "./setup";

function tokenCheck(call: StubCall) {
  if (call.url.pathname === "/api/v1/auth/setup/validate-token" && call.method === "POST") {
    return json(200, {
      valid: (call.body as { setupToken: string }).setupToken === "token-from-the-log",
    });
  }
  return undefined;
}

async function fillForm() {
  await userEvent.type(await screen.findByLabelText(/^Setup token\*?$/), "token-from-the-log");
  await userEvent.type(screen.getByLabelText("Name"), "Ada Admin");
  await userEvent.type(screen.getByLabelText("Email"), "admin@example.com");
  await userEvent.type(screen.getByLabelText("Password"), "a-long-password");
  await userEvent.type(screen.getByLabelText("Confirm password"), "a-long-password");
}

async function fillAndSubmit() {
  await fillForm();
  await userEvent.click(screen.getByRole("button", { name: "Create Administrator" }));
}

describe("first-run setup", () => {
  beforeEach(async () => {
    stubApi({ signedIn: null, needsSetup: false });
    await setupLoader();
  });

  it("keeps every field when visiting Help and returning with Back", async () => {
    stubApi({ signedIn: null, needsSetup: true, extra: tokenCheck });
    const { router } = renderAt("/auth/setup");
    await fillForm();

    await userEvent.click(screen.getByRole("link", { name: "Help with this page" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/documentation"));
    // The router state moves before the old route unmounts; wait for the
    // form to leave rather than asserting on the same tick.
    await waitFor(() =>
      expect(screen.queryByLabelText("Confirm password")).not.toBeInTheDocument(),
    );
    await act(async () => {
      await router.navigate(-1);
    });

    expect(await screen.findByLabelText(/^Setup token\*?$/)).toHaveValue("token-from-the-log");
    expect(screen.getByLabelText("Name")).toHaveValue("Ada Admin");
    expect(screen.getByLabelText("Email")).toHaveValue("admin@example.com");
    expect(screen.getByLabelText("Password")).toHaveValue("a-long-password");
    expect(screen.getByLabelText("Confirm password")).toHaveValue("a-long-password");
  });

  it("restores the Administrator draft when the application remounts", async () => {
    stubApi({ signedIn: null, needsSetup: true, extra: tokenCheck });
    const { view } = renderAt("/auth/setup");
    await fillForm();
    view.unmount();
    renderAt("/auth/setup");
    expect(await screen.findByLabelText(/^Setup token\*?$/)).toHaveValue("token-from-the-log");
    expect(screen.getByLabelText("Name")).toHaveValue("Ada Admin");
    expect(screen.getByLabelText("Email")).toHaveValue("admin@example.com");
    expect(screen.getByLabelText("Password")).toHaveValue("a-long-password");
    expect(screen.getByLabelText("Confirm password")).toHaveValue("a-long-password");
  });

  it("creates the Administrator and lands in the onboarding wizard", async () => {
    // Mutable state: the moment setup succeeds, the stubbed instance has
    // a user and a session — exactly what the real API's Set-Cookie does.
    const state: ApiState = {
      signedIn: null,
      needsSetup: true,
      onboarding: { completed: false },
    };
    state.extra = (call) => {
      if (call.url.pathname === "/api/v1/auth/setup" && call.method === "POST") {
        state.signedIn = {
          id: "u1",
          email: "admin@example.com",
          displayName: "Ada Admin",
          role: "administrator",
        };
        state.needsSetup = false;
        return json(201, { user: state.signedIn });
      }
      if (call.url.pathname === "/api/v1/auth/allowed-domains" && call.method === "GET") {
        return json(200, { domains: [] });
      }
      return tokenCheck(call);
    };
    stubApi(state);
    const { router } = renderAt("/auth/setup");

    await fillAndSubmit();
    // A fresh instance's Administrator lands in the SET-004 wizard.
    expect(await screen.findByRole("heading", { name: "Welcome to OpenLaw" })).toBeInTheDocument();

    state.needsSetup = true;
    state.signedIn = null;
    await act(async () => {
      await router.navigate("/auth/setup");
    });
    expect(await screen.findByLabelText(/^Setup token\*?$/)).toHaveValue("");
    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(screen.getByLabelText("Email")).toHaveValue("");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByLabelText("Confirm password")).toHaveValue("");
  });

  it("surfaces the lost setup race with a path to sign-in", async () => {
    stubApi({
      signedIn: null,
      needsSetup: true,
      extra: (call) =>
        call.url.pathname === "/api/v1/auth/setup" && call.method === "POST"
          ? problem(409, "Setup has already been completed.")
          : tokenCheck(call),
    });
    renderAt("/auth/setup");

    await fillAndSubmit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Setup has already been completed.");
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Setup token\*?$/)).toHaveValue("");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByLabelText("Confirm password")).toHaveValue("");
  });

  it("shows checks for valid values and clears confirmation when the password changes", async () => {
    stubApi({ signedIn: null, needsSetup: true, extra: tokenCheck });
    renderAt("/auth/setup");
    await fillForm();
    expect(await screen.findByText("Setup token verified")).toBeInTheDocument();
    expect(screen.getAllByText("Valid value")).toHaveLength(4);

    await userEvent.clear(screen.getByLabelText("Email"));
    await userEvent.type(screen.getByLabelText("Email"), "invalid-email");
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-describedby");
    await userEvent.type(screen.getByLabelText("Password"), "changed");
    expect(screen.getByLabelText("Password")).toHaveAccessibleDescription("Valid value");
    expect(screen.getByLabelText("Confirm password")).not.toHaveAttribute("aria-describedby");
  });

  it("only checks a server-verified token and ignores responses for an edited value", async () => {
    let resolveCheck: ((response: Response) => void) | undefined;
    stubApi({
      signedIn: null,
      needsSetup: true,
      extra: (call) => {
        if (call.url.pathname !== "/api/v1/auth/setup/validate-token") return undefined;
        const token = (call.body as { setupToken: string }).setupToken;
        if (token === "delayed-token")
          return new Promise<Response>((resolve) => {
            resolveCheck = resolve;
          });
        return tokenCheck(call);
      },
    });
    renderAt("/auth/setup");
    const input = await screen.findByLabelText(/^Setup token\*?$/);
    await userEvent.type(input, "wrong-token");
    expect(screen.queryByText("Setup token verified")).not.toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, "token-from-the-log");
    expect(await screen.findByText("Setup token verified")).toBeInTheDocument();

    await userEvent.clear(input);
    expect(screen.queryByText("Setup token verified")).not.toBeInTheDocument();
    await userEvent.type(input, "delayed-token");
    await waitFor(() => expect(resolveCheck).toBeDefined());
    await userEvent.clear(input);
    await userEvent.type(input, "wrong-token");
    await act(async () => {
      resolveCheck!(json(200, { valid: true }));
    });
    expect(screen.queryByText("Setup token verified")).not.toBeInTheDocument();
  });
});
