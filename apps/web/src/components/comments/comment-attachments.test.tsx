// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntlProvider } from "react-intl";
import { expect, it, vi } from "vitest";
import { json, stubApi } from "../../testing/helpers";
import type { Comment } from "../../lib/comments";
import { CommentAttachmentRows } from "./comment-attachments";

it.each(["matter", "contract"] as const)(
  "opens an attachment and files it to its %s from the preview",
  async (entityType) => {
    const comment: Comment = {
      id: "comment-1",
      entityType,
      entityId: "record-1",
      body: "Review this.",
      visibility: "full_thread",
      author: { id: "author-1", displayName: "Ada Admin", image: null, archived: false },
      mentions: [],
      attachments: [{ id: "attachment-1", filename: "advice.pdf" }],
      createdAt: "2026-09-10T08:00:00.000Z",
      editedAt: null,
      deletedAt: null,
      redactedAt: null,
    };
    const changed = vi.fn();
    const refresh = vi.fn(async () => {});
    const posts: unknown[] = [];
    stubApi({
      extra: (call) => {
        if (call.url.searchParams.get("preview") === "true")
          return new Response(null, { status: 415 });
        if (call.url.pathname.endsWith("/file") && call.method === "POST") {
          posts.push(call.body);
          return json(201, {
            comment: {
              ...comment,
              attachments: [
                {
                  ...comment.attachments![0],
                  filed: {
                    documentId: "filed-doc",
                    versionId: "filed-version",
                    documentTitle: "advice.pdf",
                    versionNumber: 1,
                  },
                },
              ],
            },
          });
        }
        return undefined;
      },
    });
    render(
      <IntlProvider locale="en">
        <CommentAttachmentRows
          comment={comment}
          entityType={entityType}
          entityId="record-1"
          onChanged={changed}
          filing={{
            documents: [],
            loadDocuments: async () => [],
            recordHref: `/${entityType}s/12/documents`,
            canFile: true,
            onOpen: () => false,
            onPaperFiled: refresh,
          }}
        />
      </IntlProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "advice.pdf" }));
    const preview = await screen.findByRole("dialog", { name: "advice.pdf" });
    expect(
      await within(preview).findByText("Preview unavailable. You can download the original file."),
    ).toBeVisible();
    expect(within(preview).getByRole("link", { name: "Download" })).toHaveAttribute(
      "download",
      "advice.pdf",
    );
    await user.click(
      within(preview).getByRole("button", {
        name: entityType === "matter" ? "File to Matter" : "File to Contract",
      }),
    );
    const filing = await screen.findByRole("dialog", { name: "File attachment" });
    expect(within(filing).getByLabelText("Document name")).toHaveValue("advice.pdf");
    if (entityType === "matter")
      expect(within(filing).queryByLabelText("Kind")).not.toBeInTheDocument();
    else expect(within(filing).getByLabelText("Kind")).toHaveValue("draft_ours");
    await user.click(within(filing).getByRole("button", { name: "File" }));
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    expect(posts).toEqual([
      {
        destination: "new_document",
        name: "advice.pdf",
        kind: entityType === "matter" ? "general" : "draft_ours",
        isConfidential: false,
      },
    ]);
    expect(refresh).toHaveBeenCalledWith("filed-doc");
  },
);
