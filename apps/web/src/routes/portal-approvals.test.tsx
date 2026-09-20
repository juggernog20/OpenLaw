// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi } from "../testing/helpers";

const BUSINESS = {
  id: "b1",
  email: "finance@example.com",
  displayName: "Finance Reviewer",
  role: "business_user",
};
const approval = {
  id: "a1",
  contractNumber: 42,
  contractTitle: "Facilities services",
  requestedBy: "Legal Counsel",
  requestedAt: "2026-09-17T09:00:00Z",
  status: "pending",
  note: null,
  decidedAt: null,
};
const document = {
  filename: "services.docx",
  byteSize: 2048,
  downloadUrl: "/api/v1/portal/approvals/a1/document",
  previewUrl: "/api/v1/portal/approvals/a1/preview",
  preview: "unavailable",
};

describe("Portal approvals", () => {
  it("uses the shared table and carries search and completed filters to the server", async () => {
    const queries: URL[] = [];
    stubApi({
      signedIn: BUSINESS,
      extra: (call) => {
        if (call.url.pathname !== "/api/v1/portal/approvals") return undefined;
        queries.push(call.url);
        return json(200, { approvals: [approval], nextCursor: null });
      },
    });
    renderAt("/portal/approvals");
    await screen.findByRole("heading", { name: "Your approvals" });
    expect(screen.getByRole("table")).toBeVisible();
    expect(
      within(screen.getByRole("table")).getByRole("link", { name: /Facilities services/ }),
    ).toHaveAttribute("href", "/portal/approvals/a1");
    const user = userEvent.setup();
    await user.type(
      screen.getByRole("searchbox", { name: "Search approvals" }),
      "Facilities{Enter}",
    );
    await waitFor(() => expect(queries.at(-1)?.searchParams.get("q")).toBe("Facilities"));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Completed" })).toHaveAttribute(
        "href",
        expect.stringContaining("q=Facilities"),
      ),
    );
    await user.click(screen.getByRole("link", { name: "Completed" }));
    await waitFor(() => expect(queries.at(-1)?.searchParams.get("status")).toBe("completed"));
    expect(queries.at(-1)?.searchParams.get("q")).toBe("Facilities");
  });
  for (const action of ["Approve", "Reject"] as const) {
    it(`saves ${action.toLowerCase()} with a note and replaces decision controls with the outcome`, async () => {
      const decision = action === "Approve" ? "approved" : "rejected";
      let current = { ...approval };
      const writes: unknown[] = [];
      stubApi({
        signedIn: BUSINESS,
        extra: (call) => {
          if (call.url.pathname === "/api/v1/portal/approvals/a1")
            return json(200, { approval: current, document });
          if (call.url.pathname === "/api/v1/portal/approvals/a1/decision") {
            writes.push(call.body);
            current = { ...current, ...(call.body as object), status: decision };
            return json(200, { approval: current });
          }
          return undefined;
        },
      });
      renderAt("/portal/approvals/a1");
      await screen.findByRole("heading", { name: "Facilities services" });
      expect(screen.getAllByRole("link", { name: "Download" })[0]).toHaveAttribute(
        "href",
        document.downloadUrl,
      );
      expect(screen.queryByText("Contract team")).not.toBeInTheDocument();
      const user = userEvent.setup();
      await user.type(screen.getByLabelText("Note (optional)"), "Finance reviewed.");
      await user.click(screen.getByRole("button", { name: action }));
      await waitFor(() => expect(writes).toEqual([{ decision, note: "Finance reviewed." }]));
      await waitFor(() =>
        expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument(),
      );
      expect(await screen.findByText("Finance reviewed.")).toBeVisible();
    });
  }
  it("preserves a note and displays a server refusal without claiming success", async () => {
    stubApi({
      signedIn: BUSINESS,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/portal/approvals/a1")
          return json(200, { approval, document: null });
        if (call.url.pathname.endsWith("/decision"))
          return problem(409, "The request was withdrawn.");
        return undefined;
      },
    });
    renderAt("/portal/approvals/a1");
    await screen.findByRole("heading", { name: "Facilities services" });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Note (optional)"), "Keep my note");
    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The request was withdrawn.");
    expect(screen.getByLabelText("Note (optional)")).toHaveValue("Keep my note");
  });
});
