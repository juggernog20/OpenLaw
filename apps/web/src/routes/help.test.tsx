// SPDX-License-Identifier: AGPL-3.0-only
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { json, renderAt, stubApi, stubFetch } from "../testing/helpers";

vi.mock("virtual:openlaw-documentation", async () => {
  const { compileWorkspace } = await import("../../../../scripts/documentation/build.mjs");
  return { default: compileWorkspace({ preview: true, fixture: true }).bundle };
});
vi.mock("virtual:openlaw-help-metadata", async () => {
  const { compileWorkspace } = await import("../../../../scripts/documentation/build.mjs");
  const bundle = compileWorkspace({ preview: true, fixture: true }).bundle;
  return {
    default: { contexts: bundle.contexts, bindings: bundle.bindings, articles: bundle.articles },
  };
});
const person = (role: string) => ({
  id: "fixture-user",
  displayName: "Jordan Example",
  email: "jordan@example.test",
  role,
});

describe("Help in the app shells", () => {
  it.each(["/help", "/portal/help"])(
    "keeps signed-out article and section links readable from %s",
    async (base) => {
      const fetch = stubApi({ signedIn: null });
      const { router } = renderAt(`${base}/old-validation?edition=fixture#before-you-start`);
      expect(await screen.findByText(/requested edition is not bundled/)).toBeVisible();
      expect(router.state.location.pathname).toBe("/documentation/old-validation");
      expect(router.state.location.hash).toBe("#before-you-start");
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["administrator", "legal_team_member", "contributor"])(
    "shows the staff Help index for %s",
    async (role) => {
      stubApi({ signedIn: person(role) });
      renderAt("/help");
      expect(await screen.findByRole("heading", { level: 1, name: "Help" })).toHaveFocus();
      expect(screen.getAllByRole("main")).toHaveLength(1);
      expect(screen.getByRole("link", { name: "Try the documentation reader" })).toBeVisible();
      expect(screen.queryByRole("combobox", { name: "Audience" })).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "All documentation" })).toHaveAttribute(
        "href",
        "/documentation",
      );
      if (role === "contributor")
        expect(
          screen.queryByRole("link", { name: "Recover a validation fixture" }),
        ).not.toBeInTheDocument();
    },
  );

  it("keeps Business Users in Portal Help and applies the portal audience to visiting staff", async () => {
    stubApi({ signedIn: person("business_user") });
    const { router } = renderAt("/help/validation-procedure#before-you-start");
    expect(await screen.findByRole("heading", { name: "Before you start" })).toHaveFocus();
    expect(router.state.location.pathname).toBe("/portal/help/validation-procedure");
    expect(screen.getByRole("link", { name: "Legal request portal" })).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "Search" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "the recovery fixture" })).toHaveAttribute(
      "href",
      "/documentation/validation-recovery#retry",
    );
    await act(() => router.navigate("/portal/help/validation-recovery"));
    expect(await screen.findByText(/Check its audience and prerequisites/)).toBeVisible();
    expect(screen.queryByRole("heading", { name: "No connection" })).not.toBeInTheDocument();
    stubApi({ signedIn: person("administrator") });
    await act(() => router.navigate("/portal/help"));
    expect(await screen.findByText("Guides for Business User")).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Recover a validation fixture" }),
    ).not.toBeInTheDocument();
  });

  it("searches only documentation, keeps the global shortcuts, and follows canonical links in the router", async () => {
    const calls: string[] = [];
    stubApi({
      signedIn: person("legal_team_member"),
      extra: ({ url }) => {
        calls.push(url.href);
        return undefined;
      },
    });
    const user = userEvent.setup();
    const { router } = renderAt("/help");
    const title = await screen.findByRole("heading", { name: "Help" });
    await user.keyboard("?");
    expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => title.focus());
    await user.keyboard("/");
    expect(screen.getByRole("combobox", { name: "Search" })).toHaveFocus();
    await user.type(
      screen.getByRole("searchbox", { name: "Search documentation" }),
      "fictional paper",
    );
    await act(async () => {
      await user.click(screen.getByRole("button", { name: "Search" }));
      await waitFor(() => {
        expect(router.state.location.search).toBe("?q=fictional+paper");
        expect(router.state.navigation.state).toBe("idle");
      });
    });
    expect(await screen.findByRole("link", { name: "Try the documentation reader" })).toBeVisible();
    expect(calls.every((url) => !url.includes("fictional") && !url.includes("/search"))).toBe(true);
    await user.click(screen.getByRole("link", { name: "Try the documentation reader" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Try the documentation reader" }),
    ).toHaveFocus();
    await user.click(screen.getByRole("link", { name: "the recovery fixture" }));
    expect(await screen.findByRole("heading", { name: "Retry" })).toHaveFocus();
    expect(router.state.location.pathname).toBe("/help/validation-recovery");
    await act(() => router.navigate(-1));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Try the documentation reader" }),
    ).toHaveFocus();
    expect(
      within(screen.getByRole("navigation", { name: "Documentation" })).getByRole("link", {
        name: "Read this article in the full documentation",
      }),
    ).toBeVisible();
  });

  it("offers the same public article when the session service fails", async () => {
    stubFetch(() => json(503, {}));
    const user = userEvent.setup();
    const { router } = renderAt("/portal/help/validation-procedure#before-you-start");
    expect(await screen.findByRole("heading", { name: "Help session unavailable" })).toHaveFocus();
    expect(document.title).toBe("Help session unavailable · OpenLaw");
    await user.click(screen.getByRole("link", { name: "All documentation" }));
    expect(await screen.findByRole("heading", { name: "Before you start" })).toHaveFocus();
    expect(router.state.location.pathname).toBe("/documentation/validation-procedure");
  });
});
