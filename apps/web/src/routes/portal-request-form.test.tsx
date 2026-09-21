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
import { REQUEST_DISPOSITIONED_PROBLEM_TYPE, type FormNode } from "@openlaw/shared";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

const REQUESTER = {
  id: "u9",
  email: "tom.iwu@acme.com",
  displayName: "Tom Iwu",
  role: "business_user",
  departmentId: "dept-finance",
};

interface FormField {
  builtInKey?: string;
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

const DESCRIPTION: FormField = {
  fieldId: "description",
  slug: "description",
  builtInKey: "description",
  displayName: "Description",
  description: null,
  fieldType: "long_text",
  options: null,
  displayOrder: 0,
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
    formFieldOrder?: string[];
    form?: FormNode[];
    departments?: { id: string; displayName: string }[];
    entities?: { id: string; name: string }[];
    intakeLinks?: { id: string; label: string; url: string; displayOrder: number }[];
    submit?: (call: StubCall) => Response;
    /** How the attachment upload answers, by the file's name. Anything
     * not named here lands. */
    attach?: (filename: string) => Response;
  },
  submissions: Submissions,
) {
  return (call: StubCall) => {
    if (call.url.pathname === "/api/v1/portal/entities" && call.method === "GET") {
      return json(200, { entities: state.entities ?? [] });
    }
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
          formFieldOrder: state.formFieldOrder ?? [],
          id: "rt2",
          slug: "contract_review",
          displayName: "Contract review",
          description: "Review of a counterparty contract or redline.",
          displayOrder: 2,
        },
        fields: state.form
          ? state.fields
          : [DESCRIPTION, ...(state.fields ?? [COUNTERPARTY, PAPER_SIDE])],
        form:
          state.form ??
          [DESCRIPTION, ...(state.fields ?? [COUNTERPARTY, PAPER_SIDE])].map((field) => ({
            kind: "row",
            id: field.fieldId,
            rowRef: field.slug,
            fieldType: field.fieldType,
            isRequired: field.isRequired,
            onIntakeForm: true,
            visibleOnPortal: true,
          })),
        regions: [],
        intakeLinks: state.intakeLinks ?? [],
        departments: state.departments ?? [{ id: "dept-finance", displayName: "Finance" }],
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
  await user.type(await screen.findByLabelText(/^Title/), "MSA renewal with Orion Cloud");
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
    expect(await screen.findByLabelText(/^Title/)).toHaveAttribute(
      "placeholder",
      "Enter a descriptive title for your request",
    );
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
    for (const label of [/^Title/, /^Description/, /^Urgency/, /^Counterparty/]) {
      expect(await screen.findByLabelText(label)).toHaveAttribute("aria-required", "true");
    }
    expect(screen.getByLabelText(/^Paper side/)).not.toHaveAttribute("aria-required", "true");
    expect(screen.getAllByText("(required)")).toHaveLength(5);
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

  it("sends an unauthenticated visitor to Business Portal sign-in", async () => {
    stubApi({ signedIn: null });
    const { router } = renderAt("/portal/new/contract_review");
    expect(await screen.findByRole("heading", { name: "Business Portal sign-in" })).toBeVisible();
    expect(router.state.location.pathname).toBe("/portal/login");
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
  it("marks a missing Department and clears its error after selection", async () => {
    const submissions: Submissions = { bodies: [], uploads: [] };
    stubApi({
      signedIn: { ...REQUESTER, departmentId: null },
      extra: portalForm({ fields: [] }, submissions),
    });
    renderAt("/portal/new/contract_review");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Submit request" }));
    const department = screen.getByRole("combobox", { name: /^Department/ });
    expect(screen.getByText("Department is required.")).toBeVisible();
    expect(department).toHaveAttribute("aria-invalid", "true");
    expect(submissions.bodies).toEqual([]);
    await user.selectOptions(department, "dept-finance");
    expect(screen.queryByText("Department is required.")).not.toBeInTheDocument();
    expect(department).not.toHaveAttribute("aria-invalid");
  });

  it("sends the basics and the values keyed by field slug", async () => {
    const user = userEvent.setup();
    const submissions = openForm();
    await fillComplete(user);
    await user.selectOptions(screen.getByLabelText(/^Paper side/), "Theirs");
    await user.selectOptions(screen.getByRole("combobox", { name: /^Department/ }), "dept-finance");
    await user.click(screen.getByRole("button", { name: "Submit request" }));

    await screen.findByRole("heading", {
      name: "Thanks! Your request has been submitted to legal.",
    });
    expect(submissions.bodies[0]).toEqual({
      requestTypeId: "rt2",
      title: "MSA renewal with Orion Cloud",
      urgency: "high",
      customFields: {
        description: "They sent a redline on the cap.",
        counterparty: "Orion Cloud",
        paper_side: "Theirs",
      },
      departmentId: "dept-finance",
    });
  });

  it("shows a confirmation with a link to the submitted request", async () => {
    const user = userEvent.setup();
    openForm();
    await fillComplete(user);
    await user.click(screen.getByRole("button", { name: "Submit request" }));

    expect(
      await screen.findByRole("heading", {
        name: "Thanks! Your request has been submitted to legal.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("You can track your open requests through this portal"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open request" })).toHaveAttribute(
      "href",
      "/portal/requests/42",
    );
    // The form is gone: the Request exists, and the boxes are no longer
    // a thing to press.
    expect(screen.queryByRole("button", { name: "Submit request" })).not.toBeInTheDocument();
  });

  it("refuses an incomplete form and says so on the fields", async () => {
    const user = userEvent.setup();
    const submissions = openForm();
    await user.type(await screen.findByLabelText(/^Title/), "MSA renewal");
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
    expect(await screen.findByText("Title is required.")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^Title/), "MSA renewal");
    expect(screen.queryByText("Title is required.")).not.toBeInTheDocument();
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
    await user.type(await screen.findByLabelText(/^Title/), "A question");
    await user.type(screen.getByLabelText(/^Description/), "About the standard NDA.");
    await user.click(screen.getByRole("button", { name: "Submit request" }));

    await screen.findByRole("heading", {
      name: "Thanks! Your request has been submitted to legal.",
    });
    expect(Object.keys(submissions.bodies[0] as object).sort()).toEqual([
      "customFields",
      "departmentId",
      "requestTypeId",
      "title",
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
    await user.type(screen.getByLabelText(/^Title/), "MSA renewal");
    await user.type(screen.getByLabelText(/^Description/), "They sent a redline.");
    await user.click(screen.getByRole("button", { name: "Submit request" }));

    await screen.findByRole("heading", {
      name: "Thanks! Your request has been submitted to legal.",
    });
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
    await user.type(await screen.findByLabelText(/^Title/), "A question");
    await user.type(screen.getByLabelText(/^Description/), "About the standard NDA.");
    await user.click(screen.getByRole("button", { name: "Submit request" }));

    // Attachments are optional (INT-002): none is not a refusal.
    expect(
      await screen.findByRole("heading", {
        name: "Thanks! Your request has been submitted to legal.",
      }),
    ).toBeInTheDocument();
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
    await user.type(screen.getByLabelText(/^Title/), "MSA renewal");
    await user.type(screen.getByLabelText(/^Description/), "They sent a redline.");
    await user.click(screen.getByRole("button", { name: "Submit request" }));

    // The Request landed, and that is the first thing the page says.
    expect(
      await screen.findByRole("heading", {
        name: "Thanks! Your request has been submitted to legal.",
      }),
    ).toBeInTheDocument();
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
    await user.type(screen.getByLabelText(/^Title/), "MSA renewal");
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

    await screen.findByRole("heading", {
      name: "Thanks! Your request has been submitted to legal.",
    });
    expect((submissions.bodies[0] as { customFields: unknown }).customFields).toEqual({
      counterparty: "Orion Cloud",
      description: "They sent a redline on the cap.",
    });
  });
});

describe("Portal-listed Entity picker", () => {
  const SIGNER: FormField = {
    ...PAPER_SIDE,
    fieldId: "f-entity",
    slug: "signing_entity",
    displayName: "Signing Entity",
    fieldType: "entity",
    options: null,
    isRequired: true,
  };

  it("offers names and submits the selected id for a required Entity Field", async () => {
    const submissions = openForm({
      fields: [COUNTERPARTY, SIGNER],
      entities: [{ id: "e-operating", name: "Aldgate Operating Ltd" }],
    });
    const user = userEvent.setup();
    await fillComplete(user);
    const picker = screen.getByRole("combobox", { name: /Signing Entity/ });
    expect(picker).toHaveAttribute("aria-required", "true");
    await user.selectOptions(picker, "Aldgate Operating Ltd");
    await user.click(screen.getByRole("button", { name: "Submit request" }));
    expect(
      await screen.findByRole("heading", {
        name: "Thanks! Your request has been submitted to legal.",
      }),
    ).toBeInTheDocument();
    expect(submissions.bodies[0]).toMatchObject({
      customFields: { signing_entity: "e-operating" },
    });
  });

  it("keeps the entered form when the Entity becomes unavailable before Submit", async () => {
    const submissions = openForm({
      fields: [COUNTERPARTY, SIGNER],
      entities: [{ id: "e-stale", name: "Aldgate Operating Ltd" }],
      submit: () => problem(400, "Signing Entity: choose a Portal-listed Entity from the list."),
    });
    const user = userEvent.setup();
    await fillComplete(user);
    await user.selectOptions(screen.getByRole("combobox", { name: /Signing Entity/ }), "e-stale");
    await user.click(screen.getByRole("button", { name: "Submit request" }));
    expect(
      await screen.findByText("Signing Entity: choose a Portal-listed Entity from the list."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Title/)).toHaveValue("MSA renewal with Orion Cloud");
    expect(submissions.bodies).toHaveLength(1);
  });
});

it("submits without a Department when none exist and explains the empty list", async () => {
  const submissions: Submissions = { bodies: [], uploads: [] };
  stubApi({ signedIn: REQUESTER, extra: portalForm({ fields: [], departments: [] }, submissions) });
  renderAt("/portal/new/contract_review");
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(/^Title/), "Review the proposal");
  await user.type(screen.getByLabelText(/^Description/), "Please review the attached terms.");
  expect(screen.getByText(/No Departments are configured/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Submit request" }));
  expect(
    await screen.findByRole("heading", {
      name: "Thanks! Your request has been submitted to legal.",
    }),
  ).toBeInTheDocument();
  expect(submissions.bodies[0]).toMatchObject({ departmentId: null });
});

it("looks up counterparties, supports multiple selections and stages a new name", async () => {
  const submissions: Submissions = { bodies: [], uploads: [] };
  const field = {
    ...COUNTERPARTY,
    builtInKey: "counterparties",
    slug: "counterparties",
    fieldType: "multi_select",
    displayName: "Counterparties",
  };
  const base = portalForm({ fields: [field] }, submissions);
  stubApi({
    signedIn: REQUESTER,
    extra: (call) => {
      if (call.url.pathname === "/api/v1/portal/request-types/rt2/counterparties")
        return json(200, {
          counterparties: call.url.searchParams.get("query")?.includes("New")
            ? []
            : [{ id: "party-b", name: "Acme", jurisdiction: "Delaware" }],
        });
      return base(call);
    },
  });
  renderAt("/portal/new/contract_review");
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(/^Title/), "Services agreement");
  await user.type(screen.getByLabelText(/^Description/), "Please prepare the agreement.");
  const picker = screen.getByRole("combobox", { name: /^Counterparties/ });
  expect(picker).toHaveAttribute("aria-required", "true");
  await user.type(picker, "Acme");
  await user.click(await screen.findByRole("option", { name: /Acme.*Delaware/ }));
  expect(screen.getByText("Primary")).toBeInTheDocument();
  await user.type(picker, "New Vendor");
  await user.click(await screen.findByRole("option", { name: 'Add new "New Vendor"' }));
  expect(screen.getByRole("button", { name: "Remove New Vendor" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Submit request" }));
  await screen.findByRole("heading", { name: "Thanks! Your request has been submitted to legal." });
  expect(submissions.bodies[0]).toMatchObject({
    counterparties: [{ counterpartyId: "party-b" }, { name: "New Vendor" }],
    customFields: { counterparties: ["party-b", "New Vendor"] },
  });
});

it("does not offer adding a counterparty when lookup fails", async () => {
  const base = portalForm(
    {
      fields: [
        { ...COUNTERPARTY, builtInKey: "counterparties", fieldType: "long_text" } as FormField,
      ],
    },
    { bodies: [], uploads: [] },
  );
  stubApi({
    signedIn: REQUESTER,
    extra: (call) =>
      call.url.pathname.endsWith("/counterparties") ? problem(500, "Search failed") : base(call),
  });
  renderAt("/portal/new/contract_review");
  const user = userEvent.setup();
  await user.type(
    await screen.findByRole("combobox", { name: /^Counterparty/ }),
    "Unavailable vendor",
  );
  await screen.findByText("Could not load counterparties. Try searching again.");
  expect(screen.queryByRole("option", { name: /Add new/ })).toBeNull();
});

it("pins Title, Department and Urgency above Intake Rows and Attachments last", async () => {
  openForm({ fields: [COUNTERPARTY] });
  const controls = [
    await screen.findByLabelText(/^Title/),
    screen.getByLabelText(/^Department/),
    screen.getByLabelText(/^Urgency/),
    screen.getByLabelText(/^Description/),
    screen.getByLabelText(/^Counterparty/),
    screen.getByLabelText("Attachments"),
  ];
  for (let i = 1; i < controls.length; i++)
    expect(
      controls[i - 1]!.compareDocumentPosition(controls[i]!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
});

it("collects no Description when the destination has no Intake Rows", async () => {
  openForm({ fields: [], form: [] });
  await screen.findByLabelText(/^Title/);
  expect(screen.queryByLabelText(/^Description/)).not.toBeInTheDocument();
});

it("shows Branch children as answers change and submits only the visible set", async () => {
  const user = userEvent.setup();
  const choice = { ...PAPER_SIDE, isRequired: true };
  const child = { ...COUNTERPARTY, displayName: "Conditional answer" };
  const row = (f: FormField): FormNode => ({
    kind: "row",
    id: f.fieldId,
    rowRef: f.slug,
    fieldType: "text",
    isRequired: f.isRequired,
    onIntakeForm: true,
    visibleOnPortal: true,
  });
  const submissions = openForm({
    fields: [choice, child],
    form: [
      row(choice),
      {
        kind: "branch",
        id: "b",
        match: "all",
        conditions: [{ rowRef: choice.slug, operator: "equals", value: "Theirs" }],
        children: [row(child)],
      },
    ],
  });
  await user.type(await screen.findByLabelText(/^Title/), "NDA");
  expect(screen.queryByLabelText(/^Conditional answer/)).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText(/^Paper side/), "Theirs");
  expect(screen.getByLabelText(/^Conditional answer/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Submit request" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Conditional answer");
  await user.type(screen.getByLabelText(/^Conditional answer/), "Stale");
  await user.selectOptions(screen.getByLabelText(/^Paper side/), "Ours");
  expect(screen.queryByLabelText(/^Conditional answer/)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Submit request" }));
  await screen.findByRole("heading", { name: /Thanks! Your request/ });
  expect(submissions.bodies[0]).toMatchObject({ customFields: { paper_side: "Ours" } });
  expect((submissions.bodies[0] as { customFields: object }).customFields).not.toHaveProperty(
    "counterparty",
  );
});

it("keeps a user Row as an optional empty picker", async () => {
  const field = {
    ...COUNTERPARTY,
    slug: "request_contact",
    displayName: "Request contact",
    fieldType: "user",
    isRequired: false,
  };
  openForm({
    fields: [field],
    form: [
      {
        kind: "row",
        id: field.fieldId,
        rowRef: field.slug,
        fieldType: "user",
        onIntakeForm: true,
        isRequired: false,
        visibleOnPortal: true,
      },
    ],
  });
  const picker = await screen.findByRole("combobox", { name: /^Request contact/ });
  expect(picker).not.toHaveAttribute("aria-required", "true");
  expect(within(picker).getAllByRole("option")).toHaveLength(1);
});

it("collects Value as one Row and submits its three scalar parts", async () => {
  const fields: FormField[] = [
    {
      ...COUNTERPARTY,
      fieldId: "value_amount",
      slug: "value_amount",
      builtInKey: "value_amount",
      displayName: "Value amount",
      fieldType: "number",
      isRequired: true,
    },
    {
      ...COUNTERPARTY,
      fieldId: "value_currency",
      slug: "value_currency",
      builtInKey: "value_currency",
      displayName: "Value currency",
      fieldType: "currency",
      isRequired: true,
    },
    {
      ...COUNTERPARTY,
      fieldId: "value_cadence",
      slug: "value_cadence",
      builtInKey: "value_cadence",
      displayName: "Value frequency",
      fieldType: "single_select",
      options: ["one_time", "monthly", "annually"],
      isRequired: true,
    },
  ];
  const submissions = openForm({
    fields,
    form: [
      {
        kind: "row",
        id: "value",
        rowRef: "value",
        fieldType: "money",
        onIntakeForm: true,
        isRequired: true,
        visibleOnPortal: true,
      },
    ],
  });
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(/^Title/), "Value test");
  await user.type(screen.getByLabelText("Amount"), "123.45");
  await user.selectOptions(screen.getByLabelText("Currency"), "USD");
  await user.selectOptions(screen.getByLabelText("Frequency"), "monthly");
  await user.click(screen.getByRole("button", { name: "Submit request" }));
  await screen.findByRole("heading", { name: /Thanks! Your request/ });
  expect(submissions.bodies[0]).toMatchObject({
    customFields: { value_amount: 12345, value_currency: "USD", value_cadence: "monthly" },
  });
});
