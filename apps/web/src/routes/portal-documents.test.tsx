// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { json, problem, renderAt, stubApi } from "../testing/helpers";
import type { PortalDocument, PortalDocumentVersion } from "../lib/portal-records";

const USER = {
  id: "business",
  email: "business@example.com",
  displayName: "Business colleague",
  role: "business_user",
};
function version(number: number): PortalDocumentVersion {
  return {
    id: `v${number}`,
    versionNumber: number,
    originalFilename: `agreement-v${number}.png`,
    mimeType: "image/png",
    byteSize: 40,
    renderFamily: "image",
    kind: "draft_theirs",
    note: `Round ${number}`,
    createdAt: "2026-09-12T12:00:00Z",
    uploadedBy: { id: "lawyer", displayName: "Legal colleague", image: null },
    isCurrent: number === 2,
    isExecuted: false,
  };
}
function setup(
  module: "contract" | "matter",
  documents: PortalDocument[],
  extra?: Parameters<typeof stubApi>[0]["extra"],
) {
  stubApi({
    signedIn: USER,
    extra: (call) => {
      const override = extra?.(call);
      if (override !== undefined) return override;
      if (call.url.pathname === `/api/v1/portal/${module}s/12`)
        return json(200, {
          [module]: {
            number: 12,
            title: "Shared work",
            type: "General",
            status: "Open",
            stage: "draft",
            counterparty: null,
            manager: null,
            businessOwner: null,
            legalOwner: null,
            termType: "fixed",
            effectiveDate: null,
            expiryDate: null,
            renewalPeriodMonths: null,
            noticeDeadline: null,
            renewalPendingConfirmation: false,
            value: null,
            unverifiedFields: [],
            primaryDocument: null,
          },
        });
      if (call.url.pathname === `/api/v1/portal/${module}s/12/documents`)
        return json(200, { documents, nextCursor: null });
      return undefined;
    },
  });
  renderAt(`/portal/${module}s/12`);
}
const single: PortalDocument = {
  id: "paper",
  title: "Agreement",
  isPrimary: true,
  versions: [{ ...version(1), isCurrent: true }],
};

describe.each(["contract", "matter"] as const)("Portal %s Documents", (module) => {
  it("shows a sole version once, with no empty history control", async () => {
    setup(module, [{ ...single, isPrimary: module === "contract" }]);
    const section = await screen.findByRole("region", { name: "Documents" });
    expect(within(section).getByText("Version 1")).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Agreement" })).toBeInTheDocument();
    expect(within(section).getAllByRole("listitem")).toHaveLength(1);
    expect(
      within(section).queryByRole("button", { name: /earlier version/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Supporting Documents")).not.toBeInTheDocument();
  });

  it("expands only earlier versions and previews the version selected", async () => {
    setup(module, [
      { ...single, isPrimary: module === "contract", versions: [version(2), version(1)] },
    ]);
    const section = await screen.findByRole("region", { name: "Documents" });
    const user = userEvent.setup();
    await user.click(within(section).getByRole("button", { name: "1 earlier version" }));
    expect(within(section).getByText("Version 2")).toBeInTheDocument();
    expect(within(section).getByText("Version 1")).toBeInTheDocument();
    const earlier = within(section).getByRole("button", { name: "agreement-v1.png" });
    await user.click(earlier);
    const panel = await screen.findByRole("complementary", { name: /Agreement/ });
    expect(within(panel).getByRole("img", { name: "agreement-v1.png" })).toHaveAttribute(
      "src",
      module === "contract"
        ? "/api/v1/portal/contracts/12/documents/paper/versions/v1/preview"
        : "/api/v1/documents/paper/versions/v1/preview",
    );
    await user.keyboard("{Escape}");
    await waitFor(() => expect(earlier).toHaveFocus());
  });

  it("accepts a dropped revision without changing the primary designation", async () => {
    const writes: string[] = [];
    setup(module, [{ ...single, isPrimary: module === "contract" }], (call) => {
      if (call.method !== "POST" || !call.url.pathname.endsWith("/versions")) return undefined;
      writes.push(call.url.pathname);
      const body = call.body as FormData;
      expect(body.get("note")).toBe("Updated scope");
      return json(201, { document: { id: "paper" } });
    });
    const section = await screen.findByRole("region", { name: "Documents" });
    const user = userEvent.setup();
    fireEvent.drop(section, {
      dataTransfer: {
        types: ["Files"],
        files: [new File(["revision"], "revision.pdf", { type: "application/pdf" })],
      },
    });
    const dialog = await screen.findByRole("dialog", { name: "Upload documents" });
    await user.selectOptions(within(dialog).getByLabelText("Add as"), "paper");
    await user.type(within(dialog).getByLabelText("Note (optional)"), "Updated scope");
    await user.click(within(dialog).getByRole("button", { name: "Upload" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(writes).toEqual(["/api/v1/documents/paper/versions"]);
  });

  it("retries only failed files after a partial multi-file upload", async () => {
    const writes: string[] = [];
    let attempt = 0;
    setup(module, [], (call) => {
      if (call.method !== "POST" || call.url.pathname !== `/api/v1/${module}s/12/documents`)
        return undefined;
      const body = call.body as FormData;
      const file = body.get("file") as File;
      writes.push(file.name);
      attempt++;
      return attempt === 2
        ? problem(503, "Try this file again.")
        : json(201, { document: { id: `new-${attempt}` } });
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Upload documents" }));
    const dialog = screen.getByRole("dialog");
    await user.upload(within(dialog).getByLabelText("Files to upload"), [
      new File(["one"], "one.txt"),
      new File(["two"], "two.txt"),
    ]);
    await user.click(within(dialog).getByRole("button", { name: "Upload" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Try this file again.");
    await user.click(within(dialog).getByRole("button", { name: "Retry failed uploads" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(writes).toEqual(["one.txt", "two.txt", "two.txt"]);
  });
});
