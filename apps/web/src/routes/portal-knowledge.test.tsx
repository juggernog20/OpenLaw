// SPDX-License-Identifier: AGPL-3.0-only

import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

const REQUESTER = {
  id: "requester-1",
  email: "requester@example.com",
  displayName: "Rina Requester",
  role: "business_user",
};

function portalKnowledge(call: StubCall) {
  if (call.method !== "GET" || call.url.pathname !== "/api/v1/portal/knowledge/knowledge-1") {
    return undefined;
  }
  return json(200, {
    knowledgeItem: {
      id: "knowledge-1",
      title: "When an NDA is not needed",
      body: "## Before you start\n\nUse the template below.",
      // Administrative fields the portal contract does not carry. They
      // ride the stub anyway so the no-metadata test below pins that
      // the screen drops them even when a payload holds them.
      knowledgeTypeName: "Playbook",
      createdBy: { id: "author-1", displayName: "Nadia Counsel", image: null, archived: false },
      primaryDocument: { id: "primary-document", title: "NDA guide" },
      documents: [
        {
          id: "primary-document",
          title: "NDA guide",
          currentVersion: {
            id: "primary-version",
            originalFilename: "nda-guide.pdf",
            mimeType: "application/pdf",
            byteSize: 120,
            downloadUrl: "/api/v1/portal/knowledge/knowledge-1/documents/primary-document/download",
          },
        },
        {
          id: "appendix-document",
          title: "Appendix",
          currentVersion: {
            id: "appendix-version",
            originalFilename: "appendix.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            byteSize: 240,
            downloadUrl:
              "/api/v1/portal/knowledge/knowledge-1/documents/appendix-document/download",
          },
        },
      ],
    },
  });
}

describe("the portal Knowledge Item", () => {
  it("shows the portal shell, the back link, primary paper first, other files, and guidance last", async () => {
    stubApi({ signedIn: REQUESTER, extra: portalKnowledge });
    renderAt("/portal/knowledge/knowledge-1");

    expect(
      await screen.findByRole("heading", { level: 1, name: "When an NDA is not needed" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Your requests" })).toHaveAttribute("href", "/portal");
    const files = screen.getByRole("list");
    const rows = within(files).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("nda-guide.pdf");
    expect(rows[1]).toHaveTextContent("appendix.docx");
    expect(within(rows[0]!).getByRole("link", { name: "Download nda-guide.pdf" })).toHaveAttribute(
      "href",
      "/api/v1/portal/knowledge/knowledge-1/documents/primary-document/download",
    );
    expect(screen.getByRole("heading", { name: "Guidance" })).toBeInTheDocument();
    expect(screen.getByText("Use the template below.")).toBeInTheDocument();
  });

  it("does not expose administration metadata or edit affordances", async () => {
    stubApi({ signedIn: REQUESTER, extra: portalKnowledge });
    renderAt("/portal/knowledge/knowledge-1");
    await screen.findByRole("heading", { level: 1, name: "When an NDA is not needed" });

    expect(screen.queryByText("Playbook")).not.toBeInTheDocument();
    expect(screen.queryByText("Nadia Counsel")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit|publish|archive/i })).not.toBeInTheDocument();
  });

  it("lands a link whose item is no longer on the portal back on the home", async () => {
    stubApi({
      signedIn: REQUESTER,
      extra: (call) =>
        call.url.pathname === "/api/v1/portal/knowledge/gone" && call.method === "GET"
          ? problem(404, "No portal Knowledge Item exists with this id.")
          : undefined,
    });
    renderAt("/portal/knowledge/gone");
    expect(
      await screen.findByRole("heading", { name: "What do you need from Legal?" }),
    ).toBeInTheDocument();
  });
});
