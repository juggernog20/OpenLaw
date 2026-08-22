// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Portal submission form (#378): what a requester at
 * `/portal/new/:slug` sees, and what pressing Submit does.
 *
 * The API's own behaviors — the required rule, the archived-type
 * refusal, the R-### sequence, the jsonb shape — are covered at the
 * HTTP seam in apps/api and are deliberately not re-tested here. What
 * this suite asserts is what a requester at a URL can see: which rows
 * the form draws, which of them are marked required, what a refusal
 * looks like on the boxes, and that a submission ends in a confirmation
 * carrying the number.
 */

import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { REQUEST_DISPOSITIONED_PROBLEM_TYPE } from "@openlaw/shared";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

const REQUESTER = {
  id: "u9",
  email: "tom.iwu@acme.com",
  displayName: "Tom Iwu",
  role: "business_user",
};

interface FormField {
  fieldId: string;
  slug: string;
  displayName: string;
  description: string | null;
  fieldType: string;
  options: string[] | null;
  displayOrder: number;
  isRequired: boolean;
}

const COUNTERPARTY: FormField = {
  fieldId: "f1",
  slug: "counterparty",
  displayName: "Counterparty",
  description: "Company on the other side of the contract.",
  fieldType: "text",
  options: null,
  displayOrder: 1,
  isRequired: true,
};

const PAPER_SIDE: FormField = {
  fieldId: "f2",
  slug: "paper_side",
  displayName: "Paper side",
  description: null,
  fieldType: "single_select",
  options: ["Ours", "Theirs"],
  displayOrder: 2,
  isRequired: false,
};

interface Submissions {
  bodies: unknown[];
  /** One entry per attachment upload: the address it went to and the
   * name of the file it carried (#380). */
  uploads: { path: string; filename: string }[];
}

/** The form read, answered from a fixture, plus whatever the test's own
 * POST answer is. */
function portalForm(
  state: {
    fields?: FormField[];
    intakeLinks?: { id: string; label: string; url: string; displayOrder: number }[];
    submit?: (call: StubCall) => Response;
    /** How the attachment upload answers, by the file's name. Anything
     * not named here lands. */
    attach?: (filename: string) => Response;
  },
  submissions: Submissions,
) {
  return (call: StubCall) => {
    if (
      /^\/api\/v1\/requests\/\d+\/attachments$/.test(call.url.pathname) &&
      call.method === "POST"
    ) {
      const file = call.body instanceof FormData ? call.body.get("file") : null;
      const filename = file instanceof File ? file.name : "";
      submissions.uploads.push({ path: call.url.pathname, filename });
      return state.attach?.(filename) ?? json(201, { attachment: { id: "att1", filename } });
    }
    if (
      call.url.pathname === "/api/v1/portal/request-types/contract_review" &&
      call.method === "GET"
    ) {
      return json(200, {
        requestType: {
          id: "rt2",
          slug: "contract_review",
          displayName: "Contract review",
          description: "Review of a counterparty contract or redline.",
          displayOrder: 2,
        },
        fields: state.fields ?? [COUNTERPARTY, PAPER_SIDE],
        intakeLinks: state.intakeLinks ?? [],
      });
    }
    if (call.url.pathname === "/api/v1/requests" && call.method === "POST") {
      submissions.bodies.push(call.body);
      return (
        state.submit?.(call) ?? json(201, { request: { id: "rq1", number: 42, status: "new" } })
      );
    }
    return undefined;
  };
}

function openForm(state: Parameters<typeof portalForm>[0] = {}): Submissions {
  const submissions: Submissions = { bodies: [], uploads: [] };
  stubApi({ signedIn: REQUESTER, extra: portalForm(state, submissions) });
  renderAt("/portal/new/contract_review");
  return submissions;
}

async function fillComplete(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText(/^Summary/), "MSA renewal with Orion Cloud");
  await user.type(screen.getByLabelText(/^Description/), "They sent a redline on the cap.");
  await user.selectOptions(screen.getByLabelText(/^Urgency/), "high");
  await user.type(screen.getByLabelText(/^Counterparty/), "Orion Cloud");
}

describe("the request type's form", () => {
  it("draws the type's name and its requester-facing description", async () => {
    openForm();
    expect(await screen.findByRole("heading", { name: "Contract review" })).toBeInTheDocument();
    expect(screen.getByText("Review of a counterparty contract or redline.")).toBeInTheDocument();
  });

  it("draws the four fixed basics on every form", async () => {
    openForm({ fields: [] });
    // INT-002's basics: three that carry a value, and Attachments,
    // which is on the form whatever the Administrator configured.
    expect(await screen.findByLabelText(/^Summary/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Description/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Urgency/)).toBeInTheDocument();
    expect(screen.getByText("Attachments")).toBeInTheDocument();
  });

  it("offers Urgency as the four severity levels", async () => {
    openForm({ fields: [] });
    const urgency = await screen.findByLabelText(/^Urgency/);
    expect(
      within(urgency)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Low", "Medium", "High", "Critical"]);
  });

  it("draws the attached fields in the Administrator's display order", async () => {
    openForm();
    expect(await screen.findByLabelText(/^Counterparty/)).toBeInTheDocument();
    const paperSide = screen.getByLabelText(/^Paper side/);
    // "Not set" leads an optional select: an empty answer is a real one
    // there, and the only way to clear it.
    expect(
      within(paperSide)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Not set", "Ours", "Theirs"]);
    // The catalog's help text rides with the control it explains.
    expect(screen.getByText("Company on the other side of the contract.")).toBeInTheDocument();
  });

  it("marks the required fields and leaves the optional ones unmarked", async () => {
    openForm();
    // The three required basics plus the one attached field the
    // Administrator marked; Attachments and Paper side are not marked.
    for (const label of [/^Summary/, /^Description/, /^Urgency/, /^Counterparty/]) {
      expect(await screen.findByLabelText(label)).toHaveAttribute("aria-required", "true");
    }
    expect(screen.getByLabelText(/^Paper side/)).not.toHaveAttribute("aria-required", "true");
    expect(screen.getAllByText("(required)")).toHaveLength(4);
  });

  it("shows this request type's own deflection links", async () => {
    openForm({
      intakeLinks: [
        {
          id: "il1",
          label: "When does a contract need legal review?",
          url: "https://wiki.acme.com/review",
          displayOrder: 1,
        },
      ],
    });
    const link = await screen.findByRole("link", {
      name: /When does a contract need legal review\?/,
    });
    expect(link).toHaveAttribute("href", "https://wiki.acme.com/review");
  });

  it("sends an unauthenticated visitor to the entry screen", async () => {
    stubApi({ signedIn: null });
    renderAt("/portal/new/contract_review");
    expect(
      await screen.findByRole("heading", { name: "Legal request portal" }),
    ).toBeInTheDocument();
  });

  it("sends a requester after an archived type back to the picker", async () => {
    // An archived form takes no submissions (the INT-004 addendum), so
    // a stale link lands where the open types are.
    stubApi({
      signedIn: REQUESTER,
      extra: (call) =>
        call.url.pathname === "/api/v1/portal/request-types/gone" && call.method === "GET"
          ? problem(404, "That request type is not taking submissions.")
          : undefined,
    });
    renderAt("/portal/new/gone");
    expect(
      await screen.findByRole("heading", { name: "What do you need from Legal?" }),
    ).toBeInTheDocument();
  });
});

describe("submitting the form", () => {
  it("sends the basics and the values keyed by field slug", async () => {
    const user = userEvent.setup();
    const submissions = openForm();
    await fillComplete(user);
    await user.selectOptions(screen.getByLabelText(/^Paper side/), "Theirs");
    await user.click(screen.getByRole("button", { name: "Submit request" }));

    await screen.findByRole("heading", { name: /R-42/ });
    expect(submissions.bodies[0]).toEqual({
      requestTypeId: "rt2",
      summary: "MSA renewal with Orion Cloud",
      description: "They sent a redline on the cap.",
      urgency: "high",
      customFields: { counterparty: "Orion Cloud", paper_side: "Theirs" },
    });
  });

  it("shows a confirmation carrying the R-### number", async () => {
    const user = userEvent.setup();
    openForm();
    await fillComplete(user);
    await user.click(screen.getByRole("button", { name: "Submit request" }));

    expect(await screen.findByRole("heading", { name: /R-42 is with Legal/ })).toBeInTheDocument();
    // The form is gone: the Request exists, and the boxes are no longer
    // a thing to press.
    expect(screen.queryByRole("button", { name: "Submit request" })).not.toBeInTheDocument();
  });

  it("refuses an incomplete form and says so on the fields", async () => {
    const user = userEvent.setup();
    const submissions = openForm();
    await user.type(await screen.findByLabelText(/^Summary/), "MSA renewal");
    await user.click(screen.getByRole("button", { name: "Submit request" }));

    // The sentence names every gap…
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Description and Counterparty/);
    // …and each box says it too, because a sentence cannot point.
    expect(screen.getByText("Description is required.")).toBeInTheDocument();
    expect(screen.getByText("Counterparty is required.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Description/)).toHaveAttribute("aria-invalid", "true");
    expect(submissions.bodies).toEqual([]);
  });

  it("clears a field's mark the moment it is answered", async () => {
    const user = userEvent.setup();
    openForm({ fields: [] });
    await user.click(await screen.findByRole("button", { name: "Submit request" }));
    expect(await screen.findByText("Summary is required.")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^Summary/), "MSA renewal");
    expect(screen.queryByText("Summary is required.")).not.toBeInTheDocument();
    expect(screen.getByText("Description is required.")).toBeInTheDocument();
  });

  it("shows the API's refusal when the seam turns the submission down", async () => {
    const user = userEvent.setup();
    openForm({
      submit: () => problem(400, "That request type is not taking submissions."),
    });
    await fillComplete(user);
    await user.click(screen.getByRole("button", { name: "Submit request" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That request type is not taking submissions.",
    );
    expect(screen.getByRole("button", { name: "Submit request" })).toBeInTheDocument();
  });

  it("sends no requester — the Requester is the session", async () => {
    const user = userEvent.setup();
    const submissions = openForm({ fields: [] });
    await user.type(await screen.findByLabelText(/^Summary/), "A question");
    await user.type(screen.getByLabelText(/^Description/), "About the standard NDA.");
    await user.click(screen.getByRole("button", { name: "Submit request" }));

    await screen.findByRole("heading", { name: /R-42/ });
    expect(Object.keys(submissions.bodies[0] as object).sort()).toEqual([
      "customFields",
      "description",
      "requestTypeId",
      "summary",
      "urgency",
    ]);
  });
});

describe("the Attachments basic", () => {
  function file(name: string) {
    return new File(["the redline"], name, { type: "application/pdf" });
  }

  it("lists the files a requester picks, and lets one be taken back", async () => {
    const user = userEvent.setup();
    openForm({ fields: [] });
    const picker = await screen.findByLabelText("Attachments");
    await user.upload(picker, [file("redline.pdf"), file("term-sheet.pdf")]);

    expect(screen.getByText("redline.pdf")).toBeInTheDocument();
    expect(screen.getByText("term-sheet.pdf")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove redline.pdf" }));
    expect(screen.queryByText("redline.pdf")).not.toBeInTheDocument();
    expect(screen.getByText("term-sheet.pdf")).toBeInTheDocument();
  });

  it("sends each picked file to the Request the submission created", async () => {
    const user = userEvent.setup();
    const submissions = openForm({ fields: [] });
    await user.upload(await screen.findByLabelText("Attachments"), [
      file("redline.pdf"),
      file("term-sheet.pdf"),
    ]);
    await user.type(screen.getByLabelText(/^Summary/), "MSA renewal");
    await user.type(screen.getByLabelText(/^Description/), "They sent a redline.");
    await user.click(screen.getByRole("button", { name: "Submit request" }));

    await screen.findByRole("heading", { name: /R-42 is with Legal/ });
    // Addressed by the R-### the submission answered with, one call per
    // file, in the order they were picked.
    expect(submissions.uploads).toEqual([
      { path: "/api/v1/requests/42/attachments", filename: "redline.pdf" },
      { path: "/api/v1/requests/42/attachments", filename: "term-sheet.pdf" },
    ]);
  });

  it("submits with no attachments at all, and uploads nothing", async () => {
    const user = userEvent.setup();
    const submissions = openForm({ fields: [] });
    await user.type(await screen.findByLabelText(/^Summary/), "A question");
    await user.type(screen.getByLabelText(/^Description/), "About the standard NDA.");
    await user.click(screen.getByRole("button", { name: "Submit request" }));

    // Attachments are optional (INT-002): none is not a refusal.
    expect(await screen.findByRole("heading", { name: /R-42 is with Legal/ })).toBeInTheDocument();
    expect(submissions.uploads).toEqual([]);
  });

  it("names a file that did not attach, without taking the Request back", async () => {
    const user = userEvent.setup();
    openForm({
      fields: [],
      attach: (filename) =>
        filename === "term-sheet.pdf"
          ? problem(413, "That file is over the 100 MB upload limit.")
          : json(201, { attachment: { id: "att1", filename } }),
    });
    await user.upload(await screen.findByLabelText("Attachments"), [
      file("redline.pdf"),
      file("term-sheet.pdf"),
    ]);
    await user.type(screen.getByLabelText(/^Summary/), "MSA renewal");
    await user.type(screen.getByLabelText(/^Description/), "They sent a redline.");
    await user.click(screen.getByRole("button", { name: "Submit request" }));

    // The Request landed, and that is the first thing the page says.
    expect(await screen.findByRole("heading", { name: /R-42 is with Legal/ })).toBeInTheDocument();
    // The paper that did not follow it is named, with the seam's own
    // reason beside it — a requester can act on a limit and cannot act
    // on "did not attach".
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/This file did not attach\./);
    expect(alert).toHaveTextContent(
      /term-sheet\.pdf — That file is over the 100 MB upload limit\./,
    );
    // The one that did land is not named: the card says what went
    // wrong, and nothing went wrong with that file.
    expect(within(alert).queryByText(/redline\.pdf/)).not.toBeInTheDocument();
  });

  it("routes a disposition-raced upload to the Request's conversation", async () => {
    const user = userEvent.setup();
    openForm({
      fields: [],
      attach: () =>
        json(409, {
          type: REQUEST_DISPOSITIONED_PROBLEM_TYPE,
          title: "This Request has already been dispositioned.",
          status: 409,
          detail: "Attach new paper to a reply in its thread.",
          outcome: "converted",
          // Not the submission's own R-42, so a link built from the
          // wrong number source fails here rather than passing by luck.
          request: { number: 57 },
          convertedContract: { number: 91 },
        }),
    });
    await user.upload(await screen.findByLabelText("Attachments"), file("markup.pdf"));
    await user.type(screen.getByLabelText(/^Summary/), "MSA renewal");
    await user.type(screen.getByLabelText(/^Description/), "They sent a redline.");
    await user.click(screen.getByRole("button", { name: "Submit request" }));

    const thread = await screen.findByRole("link", { name: "Add it to a reply on R-57" });
    expect(thread).toHaveAttribute("href", "/portal/requests/57#portal-request-composer");
  });

  it("stops a requester queueing more files than a Request carries", async () => {
    const user = userEvent.setup();
    openForm({ fields: [] });
    const picker = await screen.findByLabelText("Attachments");
    await user.upload(
      picker,
      Array.from({ length: 21 }, (_ignored, index) => file(`paper-${String(index)}.pdf`)),
    );

    // The seam refuses the twenty-first, so the picker says so first.
    expect(await screen.findByText("A request carries at most 20 files.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(20);
  });
});

describe("an out-of-scope attached field", () => {
  it("renders and collects like any other", async () => {
    // The INT-002 M19/7 addendum: an attachment can outlive the scope
    // that admitted it. The portal meets that state — the field is
    // drawn, its required flag still applies, and its value is sent.
    const user = userEvent.setup();
    const submissions = openForm({ fields: [COUNTERPARTY] });
    await fillComplete(user);
    await user.click(screen.getByRole("button", { name: "Submit request" }));

    await screen.findByRole("heading", { name: /R-42/ });
    expect((submissions.bodies[0] as { customFields: unknown }).customFields).toEqual({
      counterparty: "Orion Cloud",
    });
  });
});
