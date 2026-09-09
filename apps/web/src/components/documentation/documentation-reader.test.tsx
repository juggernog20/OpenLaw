// SPDX-License-Identifier: AGPL-3.0-only
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { IntlProvider } from "react-intl";
import { createMemoryRouter, RouterProvider } from "react-router";
import { DocumentationReader } from "./documentation-reader";
import generated from "virtual:openlaw-documentation";
import { renderAt, stubFetch } from "../../testing/helpers";

vi.mock("virtual:openlaw-documentation", async () => {
  const { compileWorkspace } = await import("../../../../../scripts/documentation/build.mjs");
  return { default: compileWorkspace({ preview: true, fixture: true }).bundle };
});

describe("public documentation", () => {
  const renderPublished = (path: string) => {
    const element = (
      <DocumentationReader bundle={{ ...generated, preview: false, validationPending: true }} />
    );
    const router = createMemoryRouter(
      [
        { path: "/", element },
        { path: "/:articleId", element },
      ],
      { initialEntries: [path] },
    );
    return render(
      <IntlProvider locale="en-US" defaultLocale="en-US">
        <RouterProvider router={router} />
      </IntlProvider>,
    );
  };

  it("shows published guides with validation pending instead of a development preview", () => {
    const overview = renderPublished("/");
    expect(
      screen.getByText("Guide validation is in progress. Some instructions may change."),
    ).toBeVisible();
    expect(screen.queryByText(/Development preview/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Validation fixtures.*2 guides/ })).toBeVisible();
    overview.unmount();

    renderPublished("/validation-recovery");
    expect(screen.getByRole("heading", { name: "Recover a validation fixture" })).toBeVisible();
    expect(
      screen.getByText("Guide validation is in progress. Some instructions may change."),
    ).toBeVisible();
    expect(screen.getByText("Validation in progress")).toBeVisible();
    expect(screen.queryByText("Unverified article")).not.toBeInTheDocument();
  });

  it("offers no adjacent guides when the current article is outside the audience filter", async () => {
    renderAt("/documentation/validation-recovery?audience=business_user");
    expect(
      await screen.findByRole("heading", { name: "Recover a validation fixture" }),
    ).toBeVisible();
    const adjacent = within(screen.getByRole("navigation", { name: "Article navigation" }));
    expect(adjacent.queryAllByRole("link")).toHaveLength(0);
  });
  it("browses a collection, keeps the article selected, and offers adjacent guides", async () => {
    const user = userEvent.setup();
    const { router } = renderAt("/documentation");
    await user.click(await screen.findByRole("link", { name: /Validation fixtures.*2 guides/ }));
    expect(router.state.location.search).toContain("section=validation");
    await user.click(screen.getByRole("link", { name: "Try the documentation reader" }));
    const navigation = within(screen.getByRole("navigation", { name: "Guide navigation" }));
    expect(navigation.getByRole("link", { name: "Try the documentation reader" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("navigation", { name: "Article navigation" })).toHaveTextContent(
      "Recover a validation fixture",
    );
    await user.click(
      screen.getByRole("link", { name: /Next guide.*Recover a validation fixture/ }),
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: "Recover a validation fixture" }),
    ).toHaveFocus();
  });
  it("changes the public reader theme without a session or preference write", async () => {
    const calls: string[] = [];
    stubFetch((call) => {
      calls.push(call.url.pathname);
      throw new Error("No API expected");
    });
    const user = userEvent.setup();
    renderAt("/documentation");
    await user.selectOptions(
      await screen.findByRole("combobox", { name: "Documentation theme" }),
      "dark",
    );
    expect(document.documentElement.dataset.theme).toBe("dark");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Documentation theme" }),
      "light",
    );
    expect(calls).toEqual([]);
  });
  it("reads and searches without setup, session, or any API request", async () => {
    const calls: string[] = [];
    stubFetch((call) => {
      calls.push(call.url.pathname);
      throw new Error("Documentation must not use an API");
    });
    const user = userEvent.setup();
    const { router } = renderAt("/documentation");
    expect(await screen.findByRole("heading", { level: 1, name: "Documentation" })).toBeVisible();
    await user.type(
      screen.getByRole("searchbox", { name: "Search documentation" }),
      "fictional paper",
    );
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(
      await screen.findByRole("heading", { name: "Try the documentation reader" }),
    ).toBeVisible();
    expect(router.state.location.search).toContain("q=fictional+paper");
    expect(screen.getByRole("heading", { level: 1, name: "Documentation" })).toHaveFocus();
    expect(
      screen.queryByRole("link", { name: "Recover a validation fixture" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Try the documentation reader" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Try the documentation reader" }),
    ).toHaveFocus();
    expect(screen.getByText("Unverified article")).toBeVisible();
    expect(calls).toEqual([]);
    expect(document.title).toBe("Try the documentation reader · OpenLaw");
  });
  it("preserves browser navigation and shows useful missing states", async () => {
    stubFetch(() => {
      throw new Error("No API expected");
    });
    const { router } = renderAt("/documentation/old-validation#before-you-start");
    expect(await screen.findByRole("heading", { name: "Before you start" })).toHaveFocus();
    expect(router.state.location.pathname).toBe("/documentation/validation-procedure");
    expect(router.state.location.hash).toBe("#before-you-start");
    await act(() => router.navigate("/documentation/validation-procedure#missing"));
    expect(await screen.findByText(/requested section is unavailable/)).toBeVisible();
    await act(() => router.navigate("/documentation/missing"));
    expect(await screen.findByRole("heading", { name: "Article unavailable" })).toBeVisible();
    await act(() => router.navigate("/documentation?edition=older-release"));
    expect(await screen.findByText(/requested edition is not bundled/)).toBeVisible();
    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe("/documentation/missing");
  });
  it("moves focus again when the outline link names the section already in the address", async () => {
    stubFetch(() => {
      throw new Error("No API expected");
    });
    const user = userEvent.setup();
    renderAt("/documentation/validation-procedure");
    const title = await screen.findByRole("heading", { level: 1 });
    const outline = within(screen.getByRole("navigation", { name: "On this page" }));
    await user.click(outline.getByRole("link", { name: "Before you start" }));
    expect(await screen.findByRole("heading", { name: "Before you start" })).toHaveFocus();
    act(() => title.focus());
    await user.click(outline.getByRole("link", { name: "Before you start" }));
    expect(await screen.findByRole("heading", { name: "Before you start" })).toHaveFocus();
  });
  it("uses registered topics, keeps a full index fallback, and filters reader paths", async () => {
    const user = userEvent.setup();
    renderAt("/documentation?topic=unknown-record-123");
    expect(
      await screen.findByRole("link", { name: /Validation fixtures.*2 guides/ }),
    ).toBeVisible();
    await user.selectOptions(screen.getByRole("combobox", { name: "Audience" }), "operator");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText(/No matching articles/)).toBeVisible();
    await user.click(screen.getByRole("link", { name: "All documentation" }));
    expect(
      await screen.findByRole("link", { name: /Validation fixtures.*2 guides/ }),
    ).toBeVisible();
  });
  it("renders code as text, tables as scrollable regions, and local export links", async () => {
    renderAt("/documentation/validation-procedure");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Try the documentation reader" }),
    ).toBeVisible();
    const table = screen.getByRole("region", { name: "Table" });
    expect(within(table).getByRole("columnheader", { name: "Expected result" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Code example" })).toHaveTextContent(
      "<script>literal example</script>",
    );
    expect(document.querySelector("article script")).toBeNull();
    await userEvent.setup().click(screen.getByText("Edition details", { selector: "summary" }));
    expect(screen.getByRole("link", { name: "Download standalone edition" })).toHaveAttribute(
      "href",
      "/documentation-export/openlaw-documentation.tar.gz",
    );
  });
});
