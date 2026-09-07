// SPDX-License-Identifier: AGPL-3.0-only
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderAt, stubFetch } from "../../testing/helpers";

vi.mock("virtual:openlaw-documentation", async () => {
  const { compileWorkspace } = await import("../../../../../scripts/documentation/build.mjs");
  return { default: compileWorkspace({ preview: true, fixture: true }).bundle };
});

describe("public documentation", () => {
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
  it("uses registered topics, keeps a full index fallback, and filters reader paths", async () => {
    const user = userEvent.setup();
    renderAt("/documentation?topic=unknown-record-123");
    expect(await screen.findByRole("link", { name: "Try the documentation reader" })).toBeVisible();
    await user.selectOptions(screen.getByRole("combobox", { name: "Audience" }), "operator");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText(/No matching articles/)).toBeVisible();
    await user.click(screen.getByRole("link", { name: "All documentation" }));
    expect(await screen.findByRole("link", { name: "Try the documentation reader" })).toBeVisible();
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
