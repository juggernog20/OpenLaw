// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi } from "../testing/helpers";
import { MEMBER, dispositionApi, staffRequest } from "../testing/disposition";

const people = [
  { id: "u2", displayName: "Nadia Counsel", image: null },
  { id: "u3", displayName: "Priya Rao", image: null },
];
function setup(assignee: (typeof people)[number] | null = null, fail = false) {
  let row = staffRequest({ assignee });
  const writes: unknown[] = [];
  const shared = dispositionApi({ segment: "resolve", applied: (request) => request });
  stubApi({
    signedIn: MEMBER,
    extra: (call) => {
      if (call.url.pathname === "/api/v1/requests/assignees") return json(200, { people });
      if (call.url.pathname === "/api/v1/requests/45/assignee" && call.method === "PATCH") {
        writes.push(call.body);
        if (fail) return problem(400, "This person is no longer available to triage.");
        row = {
          ...row,
          assignee:
            people.find(
              (person) => person.id === (call.body as { assigneeId: string | null }).assigneeId,
            ) ?? null,
        };
        return json(200, { request: row });
      }
      if (call.url.pathname === "/api/v1/requests")
        return json(200, { requests: [row], total: 1, nextCursor: null });
      if (call.url.pathname === "/api/v1/requests/45")
        return json(200, {
          request: row,
          fields: [],
          customFieldRefs: { users: [], entities: [] },
          attachments: [],
        });
      return shared.handler(call);
    },
  });
  return writes;
}

it("Assign opens a searchable modal, saves, and replaces the button with the assignee avatar", async () => {
  const writes = setup();
  const user = userEvent.setup();
  renderAt("/inbox");
  await user.click(await screen.findByRole("button", { name: "Assign R-45" }));
  const dialog = await screen.findByRole("dialog", { name: "Assign R-45 for triage" });
  expect(
    screen.getByRole("heading", { name: "Inbox", level: 1, hidden: true }),
  ).toBeInTheDocument();
  await user.type(within(dialog).getByRole("textbox", { name: "Search people" }), "Nadia");
  await user.click(await within(dialog).findByRole("radio", { name: "Nadia Counsel" }));
  expect(within(dialog).queryByRole("radio", { name: "Priya Rao" })).toBeNull();
  await user.click(within(dialog).getByRole("button", { name: "Save assignment" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(writes).toEqual([{ assigneeId: "u2" }]);
  expect(screen.queryByRole("button", { name: "Assign R-45" })).toBeNull();
  expect(screen.getByRole("button", { name: "Reassign R-45: Nadia Counsel" })).toHaveTextContent(
    "NC",
  );
  expect(
    screen.getByRole("link", { name: "Orion Cloud MSA renewal — redline review" }),
  ).toHaveAttribute("href", "/inbox/45");
});

it("clicking the assigned avatar permits reassignment and clearing", async () => {
  const writes = setup(people[0]);
  const user = userEvent.setup();
  renderAt("/inbox");
  await user.click(await screen.findByRole("button", { name: "Reassign R-45: Nadia Counsel" }));
  await user.click(await screen.findByRole("radio", { name: "Priya Rao" }));
  await user.click(screen.getByRole("button", { name: "Save assignment" }));
  await user.click(await screen.findByRole("button", { name: "Reassign R-45: Priya Rao" }));
  await user.click(await screen.findByRole("radio", { name: "Unassigned" }));
  await user.click(screen.getByRole("button", { name: "Save assignment" }));
  expect(await screen.findByRole("button", { name: "Assign R-45" })).toBeInTheDocument();
  expect(writes).toEqual([{ assigneeId: "u3" }, { assigneeId: null }]);
});

it("reassigns from the intake page and displays the persisted person after rereading", async () => {
  const writes = setup(people[0]);
  const user = userEvent.setup();
  renderAt("/inbox/45");
  await user.click(await screen.findByRole("button", { name: "Reassign R-45: Nadia Counsel" }));
  await user.click(await screen.findByRole("radio", { name: "Priya Rao" }));
  await user.click(screen.getByRole("button", { name: "Save assignment" }));
  expect(await screen.findByRole("button", { name: "Reassign R-45: Priya Rao" })).toHaveTextContent(
    "Priya Rao",
  );
  expect(writes).toEqual([{ assigneeId: "u3" }]);
});

it("cancel discards the selection without writing", async () => {
  const writes = setup();
  const user = userEvent.setup();
  renderAt("/inbox");
  await user.click(await screen.findByRole("button", { name: "Assign R-45" }));
  await user.click(await screen.findByRole("radio", { name: "Priya Rao" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(writes).toEqual([]);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: "Assign R-45" })).toHaveFocus();
});

it("a failed assignment keeps the modal and original avatar", async () => {
  const writes = setup(people[0], true);
  const user = userEvent.setup();
  renderAt("/inbox");
  await user.click(await screen.findByRole("button", { name: "Reassign R-45: Nadia Counsel" }));
  await user.click(await screen.findByRole("radio", { name: "Priya Rao" }));
  await user.click(screen.getByRole("button", { name: "Save assignment" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This person is no longer available to triage.",
  );
  expect(writes).toEqual([{ assigneeId: "u3" }]);
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("button", { name: "Reassign R-45: Nadia Counsel" })).toBeInTheDocument();
});
