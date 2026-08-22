// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Convert on the staff request detail (#420), through the real route
 * table with the standard fetch stub.
 *
 * The screen's own subjects — the envelope, the values, the paper, the
 * thread — are `inbox-request.test.tsx`'s, and the disposition
 * scaffold's is `inbox-request-decline.test.tsx`'s. This suite is
 * Convert's own shape: that the target is confirmed and not offered
 * where the Administrator bound one, that the picker appears for the
 * one choice the form deferred, that a re-target says so, that the
 * prefill is drawn and what will not carry is named, that a
 * hard-required gap is prompted before the seam is asked, and that a
 * lost race names the record the winner made.
 *
 * What the seam does with a conversion — the contract, the carry, the
 * narration, the row lock — is the API harness's subject
 * (`convert.test.ts`). What this suite asks of it is that the screen
 * sends what it drew and reads the Request again afterwards.
 */

import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { REQUEST_DISPOSITIONED_PROBLEM_TYPE } from "@openlaw/shared";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";
import {
  dispositionApi,
  MEMBER,
  openDisposition,
  staffDetail,
  staffRequest,
  subbar,
} from "../testing/disposition";

/** One attached catalog field, in the shape both the request form and a
 * contract type answer it in. */
function field(
  slug: string,
  displayName: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    fieldId: `f-${slug}`,
    slug,
    displayName,
    description: null,
    fieldType: "text",
    options: null,
    displayOrder: 1,
    isRequired: false,
    ...overrides,
  };
}

const COUNTERPARTY = field("counterparty", "Counterparty");
const DEAL_DESK = field("deal_desk_region", "Deal desk region");
const GOVERNING_LAW = field("governing_law", "Governing law", { isRequired: true });

/** The live contract taxonomy the dialog draws from. NDA carries the
 * counterparty and demands nothing; MSA demands a governing law no
 * request form collects, which is the gap. */
const CONTRACT_TYPES = [
  { id: "ct-nda", slug: "nda", displayName: "NDA", fields: [COUNTERPARTY] },
  { id: "ct-msa", slug: "msa", displayName: "MSA", fields: [COUNTERPARTY, GOVERNING_LAW] },
];

/** The Request the screen opens on: a Request whose form collected two
 * values, one of which the NDA type has no field for. */
const request = (overrides: Record<string, unknown> = {}) =>
  staffRequest({
    summary: "Northwind Labs mutual NDA",
    description: "Small vendor, standard terms.",
    customFields: { counterparty: "Northwind Labs", deal_desk_region: "EMEA" },
    ...overrides,
  });

/** The whole detail read, around one Request. The form collected both
 * values, so both are labelled here. */
const detail = (row: Record<string, unknown>) => staffDetail(row, [COUNTERPARTY, DEAL_DESK]);

/**
 * The Request seam behind the screen, with Convert's own outcome on it
 * and the live contract taxonomy the dialog draws from. Everything
 * else — the detail read, the thread, the counters — is the shared
 * scaffold's.
 */
function requestApi(
  initial = request(),
  answer: (call: StubCall) => Response | undefined = () => undefined,
) {
  const api = dispositionApi({
    segment: "convert",
    initial,
    answer,
    detail,
    applied: (row) => ({ ...row, status: "converted", convertedContract: { number: 51 } }),
    // The taxonomy read is on the page's loader for every suite, and
    // the shared scaffold lets `stubApi`'s empty default answer it.
    // Convert is the one that needs rows in it.
    extra: (call) =>
      call.url.pathname === "/api/v1/contracts/options" && call.method === "GET"
        ? json(200, {
            contractTypes: CONTRACT_TYPES,
            contractStatuses: [],
            users: [],
            approverGroups: [],
          })
        : undefined,
  });
  return {
    handler: api.handler,
    conversions: api.sent,
    get reads() {
      return api.reads;
    },
  };
}

const openConvert = (user: ReturnType<typeof userEvent.setup>) =>
  openDisposition(user, "Convert to contract");

function open(api: ReturnType<typeof requestApi>) {
  stubApi({ signedIn: MEMBER, extra: api.handler });
  return renderAt("/inbox/45");
}

describe("the sub-bar's third action (DES-058, INT-007)", () => {
  it("offers Convert beside Decline and Resolve while the Request is undecided", async () => {
    open(requestApi());
    const actions = within(await subbar()).getAllByRole("button");
    expect(actions.map((button) => button.textContent)).toEqual([
      "Decline",
      "Resolve",
      "Convert to contract",
    ]);
  });

  it("offers nothing on a Request somebody has already converted", async () => {
    open(requestApi(request({ status: "converted", convertedContract: { number: 51 } })));
    expect(
      within(await subbar()).queryByRole("button", { name: "Convert to contract" }),
    ).toBeNull();
    // What was decided is the Outcome card's to say, and it links to the
    // record the ask became.
    expect(await screen.findByRole("link", { name: "C-51" })).toBeInTheDocument();
  });
});

describe("the prefill (INT-002, MTR-012)", () => {
  it("seeds the title from the summary and says where it came from", async () => {
    const user = userEvent.setup();
    open(requestApi());
    const dialog = await openConvert(user);
    expect(within(dialog).getByLabelText(/^Title/)).toHaveValue("Northwind Labs mutual NDA");
    expect(within(dialog).getByText(/submitted by Tom Iwu/)).toBeInTheDocument();
    // I3's own note, and the promise the milestone is for.
    expect(within(dialog).getByText(/nothing is re-keyed/)).toBeInTheDocument();
  });

  it("states the priority the urgency maps to, and offers no risk", async () => {
    const user = userEvent.setup();
    open(requestApi());
    const dialog = await openConvert(user);
    expect(within(dialog).getByText("Priority")).toBeInTheDocument();
    expect(within(dialog).getByText("High")).toBeInTheDocument();
    expect(within(dialog).getByText(/Risk stays yours to set on the record/)).toBeInTheDocument();
  });

  it("names what carries, with the value it will land as", async () => {
    const user = userEvent.setup();
    open(requestApi());
    const dialog = await openConvert(user);
    expect(within(dialog).getByText("Carries into the contract")).toBeInTheDocument();
    expect(within(dialog).getByText("Counterparty")).toBeInTheDocument();
    expect(within(dialog).getByText("Northwind Labs")).toBeInTheDocument();
    // Stated, not re-typed: a carried value gets no box.
    expect(within(dialog).queryByLabelText(/^Counterparty/)).toBeNull();
  });

  it("says nothing about carrying until a target type is picked", async () => {
    // With no target there is nothing to compare a collected value
    // against, so a list claiming every value stays behind would be
    // answering a question nobody has asked yet.
    const user = userEvent.setup();
    open(
      requestApi(
        request({
          requestType: {
            id: "rt-review",
            displayName: "Contract review",
            targetModule: "contract",
            targetTypeId: null,
            targetTypeName: null,
          },
        }),
      ),
    );
    const dialog = await openConvert(user);
    expect(within(dialog).queryByText("Carries into the contract")).toBeNull();
    expect(within(dialog).queryByText("Does not carry into the contract")).toBeNull();

    await user.selectOptions(within(dialog).getByLabelText(/^Contract type/), "ct-nda");
    expect(within(dialog).getByText("Carries into the contract")).toBeInTheDocument();
    expect(within(dialog).getByText("Does not carry into the contract")).toBeInTheDocument();
  });

  it("names what does not carry, and says it stays on the request", async () => {
    // The INT-002 M19/7 addendum, paid where somebody can see it before
    // they press: the NDA contract type has no field for the deal desk
    // region, so it has nowhere to land.
    const user = userEvent.setup();
    open(requestApi());
    const dialog = await openConvert(user);
    expect(within(dialog).getByText("Does not carry into the contract")).toBeInTheDocument();
    expect(within(dialog).getByText("Deal desk region")).toBeInTheDocument();
    expect(within(dialog).getByText(/Nothing is deleted/)).toBeInTheDocument();
  });
});

describe("the target is confirmed, never classified (DD-018)", () => {
  it("states the bound type and offers no picker", async () => {
    const user = userEvent.setup();
    open(requestApi());
    const dialog = await openConvert(user);
    expect(within(dialog).getByText("NDA")).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Triage confirms the routing rather than choosing it/),
    ).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/^Contract type/)).toBeNull();
  });

  it("sends no contract type on a confirmed target", async () => {
    const user = userEvent.setup();
    const api = requestApi();
    open(api);
    const dialog = await openConvert(user);
    await user.click(within(dialog).getByRole("button", { name: "Convert" }));
    await waitFor(() => expect(api.conversions).toHaveLength(1));
    // The seam reads its own configuration; a body naming the type would
    // be the client asserting the routing.
    expect(api.conversions[0]).toEqual({ title: "Northwind Labs mutual NDA" });
  });

  it("asks a module-only target for the type the form deferred", async () => {
    const user = userEvent.setup();
    const api = requestApi(
      request({
        customFields: {},
        requestType: {
          id: "rt-review",
          displayName: "Contract review",
          targetModule: "contract",
          targetTypeId: null,
          targetTypeName: null,
        },
      }),
    );
    open(api);
    const dialog = await openConvert(user);
    expect(
      within(dialog).getByText(/This request type left the contract type to conversion/),
    ).toBeInTheDocument();

    // Nothing is sent until the one choice is made.
    await user.click(within(dialog).getByRole("button", { name: "Convert" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Pick a contract type.");
    expect(api.conversions).toEqual([]);

    await user.selectOptions(within(dialog).getByLabelText(/^Contract type/), "ct-nda");
    await user.click(within(dialog).getByRole("button", { name: "Convert" }));
    await waitFor(() => expect(api.conversions).toHaveLength(1));
    expect(api.conversions[0]).toEqual({
      title: "Northwind Labs mutual NDA",
      contractTypeId: "ct-nda",
    });
  });

  it("never learns why a bound type is absent: a null target type always asks", async () => {
    // The screen cannot tell an archived target apart from a module-only
    // one, and that is the point: the API reads an archived type as no
    // type (INT-002), so both arrive here as the same two nulls. What
    // this pins is that the dialog asks whatever the reason was. The
    // archived rule itself is pinned where it lives, in the API suite's
    // "reads an archived target type as no type, on the read and at the
    // write".
    const user = userEvent.setup();
    open(
      requestApi(
        request({
          requestType: {
            id: "rt-retired",
            displayName: "Retired routing",
            targetModule: "contract",
            targetTypeId: null,
            targetTypeName: null,
          },
        }),
      ),
    );
    const dialog = await openConvert(user);
    expect(within(dialog).getByLabelText(/^Contract type/)).toBeInTheDocument();
  });

  it("names the re-target on a matter-targeting Request, and still converts", async () => {
    const user = userEvent.setup();
    const api = requestApi(
      request({
        customFields: {},
        requestType: {
          id: "rt-advice",
          displayName: "Advice request",
          targetModule: "matter",
          targetTypeId: "mt-advice",
          targetTypeName: "Advice",
        },
      }),
    );
    open(api);
    const dialog = await openConvert(user);
    expect(within(dialog).getByText(/is a re-target/)).toBeInTheDocument();
    // The matter type id is not a contract type id, so the picker is
    // drawn rather than a target confirmed off the wrong taxonomy.
    await user.selectOptions(within(dialog).getByLabelText(/^Contract type/), "ct-nda");
    await user.click(within(dialog).getByRole("button", { name: "Convert" }));
    await waitFor(() => expect(api.conversions).toHaveLength(1));
    expect(api.conversions[0]).toMatchObject({ contractTypeId: "ct-nda" });
  });

  it("draws no Matter option (M22 owns that arm)", async () => {
    const user = userEvent.setup();
    open(requestApi());
    const dialog = await openConvert(user);
    expect(within(dialog).queryByText(/matter instead/i)).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /matter/i })).toBeNull();
  });
});

describe("the gaps the form did not collect (CTR-016, MTR-014)", () => {
  it("prompts a hard-required field, refuses an empty one, and sends what was filled", async () => {
    const user = userEvent.setup();
    const api = requestApi(
      request({
        requestType: {
          id: "rt-review",
          displayName: "Contract review",
          targetModule: "contract",
          targetTypeId: "ct-msa",
          targetTypeName: "MSA",
        },
      }),
    );
    open(api);
    const dialog = await openConvert(user);
    const gap = within(dialog).getByLabelText(/^Governing law/);
    expect(gap).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Required on this contract type. The form did not collect it./),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Convert" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Fill Governing law — this contract type requires it.",
    );
    expect(api.conversions).toEqual([]);

    await user.type(gap, "England and Wales");
    await user.click(within(dialog).getByRole("button", { name: "Convert" }));
    await waitFor(() => expect(api.conversions).toHaveLength(1));
    expect(api.conversions[0]).toEqual({
      title: "Northwind Labs mutual NDA",
      customFields: { governing_law: "England and Wales" },
    });
  });

  it("refuses an empty title by name, on the box", async () => {
    const user = userEvent.setup();
    const api = requestApi();
    open(api);
    const dialog = await openConvert(user);
    await user.clear(within(dialog).getByLabelText(/^Title/));
    await user.click(within(dialog).getByRole("button", { name: "Convert" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Name the contract.");
    expect(within(dialog).getByLabelText(/^Title/)).toHaveAttribute("aria-invalid", "true");
    expect(api.conversions).toEqual([]);
  });
});

describe("what happens after the press (INT-007)", () => {
  it("repaints the page as converted, with the record it became", async () => {
    const user = userEvent.setup();
    const api = requestApi();
    open(api);
    const dialog = await openConvert(user);
    await user.click(within(dialog).getByRole("button", { name: "Convert" }));

    // The write answers the whole envelope and the page still re-reads:
    // the Outcome card, the status pill, and the thread's watermark all
    // hang off the loader.
    expect(await screen.findByRole("link", { name: "C-51" })).toBeInTheDocument();
    await waitFor(() => expect(api.reads).toBeGreaterThan(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("writes nothing when the dialog is cancelled", async () => {
    // INT-007 has no claim step, so opening the dialog is not an act and
    // closing it returns the Request to the queue untouched.
    const user = userEvent.setup();
    const api = requestApi();
    open(api);
    const dialog = await openConvert(user);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.conversions).toEqual([]);
    expect(
      within(await subbar()).getByRole("button", { name: "Convert to contract" }),
    ).toBeInTheDocument();
  });

  it("prints the seam's own sentence on an ordinary refusal", async () => {
    const user = userEvent.setup();
    const api = requestApi(request(), () =>
      problem(400, "Fill Governing law first — the type requires it."),
    );
    open(api);
    const dialog = await openConvert(user);
    await user.click(within(dialog).getByRole("button", { name: "Convert" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Fill Governing law first — the type requires it.",
    );
  });
});

describe("a lost race (INT-007, TECH-020)", () => {
  it("ends the dialog in a statement naming the record the winner made", async () => {
    const user = userEvent.setup();
    const api = requestApi(request(), () => {
      const body = {
        type: REQUEST_DISPOSITIONED_PROBLEM_TYPE,
        title: "Conflict",
        status: 409,
        detail: "This request has already been converted.",
        outcome: "converted",
        convertedContract: { number: 51 },
      };
      return new Response(JSON.stringify(body), {
        status: 409,
        headers: { "content-type": "application/problem+json" },
      });
    });
    open(api);
    const dialog = await openConvert(user);
    await user.click(within(dialog).getByRole("button", { name: "Convert" }));

    expect(
      await within(dialog).findByText("Somebody else already converted this request."),
    ).toBeInTheDocument();
    // The one thing a plain outcome cannot say.
    expect(within(dialog).getByText("It became C-51.")).toBeInTheDocument();
    // Nothing left to decide, so the form is gone rather than pressable.
    expect(within(dialog).queryByRole("button", { name: "Convert" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("says what was decided without a record when the outcome made none", async () => {
    const user = userEvent.setup();
    const api = requestApi(request(), () => {
      const body = {
        type: REQUEST_DISPOSITIONED_PROBLEM_TYPE,
        title: "Conflict",
        status: 409,
        detail: "This request has already been declined.",
        outcome: "declined",
        convertedContract: null,
      };
      return new Response(JSON.stringify(body), {
        status: 409,
        headers: { "content-type": "application/problem+json" },
      });
    });
    open(api);
    const dialog = await openConvert(user);
    await user.click(within(dialog).getByRole("button", { name: "Convert" }));

    expect(
      await within(dialog).findByText("Somebody else already declined this request."),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/^It became/)).toBeNull();
  });
});
