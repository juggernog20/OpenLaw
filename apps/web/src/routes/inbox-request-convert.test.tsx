// SPDX-License-Identifier: AGPL-3.0-only

/** Conversion prefills, editable values, validation and disposition outcomes. */

import { beforeEach, describe, expect, it, vi } from "vitest";
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

const PDF_PAGE_TEXT = vi.hoisted(() => [
  ["The first termination right is on this page."],
  ["A second termi", "nation right appears here. The final termination right follows."],
]);

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: PDF_PAGE_TEXT.length,
      loadingTask: { destroy: () => Promise.resolve() },
      getPage: (pageNumber: number) => {
        const items = (PDF_PAGE_TEXT[pageNumber - 1] ?? []).flatMap((str) =>
          str.split("\n").map((line, index, lines) => ({
            str: line,
            hasEOL: index < lines.length - 1,
          })),
        );
        return Promise.resolve({
          getViewport: ({ scale }: { scale: number }) => ({
            width: 600 * scale,
            height: 800 * scale,
          }),
          getTextContent: () => Promise.resolve({ items }),
          render: () => ({ promise: Promise.resolve() }),
        });
      },
    }),
  }),
  TextLayer: class MockTextLayer {
    readonly options: {
      textContentSource: { items: Array<{ str?: string; hasEOL?: boolean }> };
      container: HTMLElement;
    };

    constructor(options: {
      textContentSource: { items: Array<{ str?: string; hasEOL?: boolean }> };
      container: HTMLElement;
    }) {
      this.options = options;
    }

    render() {
      for (const item of this.options.textContentSource.items) {
        const span = document.createElement("span");
        span.textContent = item.str ?? "";
        this.options.container.append(span);
        if (item.hasEOL) this.options.container.append(document.createElement("br"));
      }
      return Promise.resolve();
    }
  },
}));

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class MockIntersectionObserver {
      readonly callback: IntersectionObserverCallback;

      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
      }

      observe(target: Element) {
        queueMicrotask(() => {
          this.callback(
            [{ target, isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          );
        });
      }

      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
      readonly root = null;
      readonly rootMargin = "0px";
      readonly thresholds = [0];
    },
  );
});

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

const OPPOSING_PARTY = field("opposing_party", "Opposing party");
/** The two seeded request fields the dialog lands through its own
 * boxes rather than as Fields (INT-002, 2026-09-09 addendum). */
const COUNTERPARTY_NAME = field("counterparty_name", "Counterparty name");
const NEEDED_BY = field("needed_by", "Needed by", { fieldType: "date" });
const DEAL_DESK = field("deal_desk_region", "Deal desk region");
const GOVERNING_LAW = field("governing_law", "Governing law", { isRequired: true });
const REQUESTING_MANAGER = field("requesting_manager", "Requesting manager", {
  fieldType: "user",
});
const CONTRACTING_ENTITY = field("contracting_entity", "Contracting entity", {
  fieldType: "entity",
});

const EMPLOYMENT_TEMPLATE = {
  id: "tpl-employment",
  name: "Employment response",
  description: "The standard employment checklist.",
  defaultPriority: "low",
  defaultRisk: "high",
  defaultCustomFields: {
    opposing_party: "Template employer",
    governing_law: "Template forum",
  },
  titlePrefix: "EMP —",
  taskCount: 2,
  keyDateCount: 1,
};

/** The live contract taxonomy the dialog draws from. NDA carries the
 * opposing party and demands nothing; MSA demands a governing law no
 * request form collects, which is the gap. */
const CONTRACT_TYPES = [
  {
    id: "ct-nda",
    slug: "nda",
    displayName: "NDA",
    fields: [OPPOSING_PARTY, REQUESTING_MANAGER, CONTRACTING_ENTITY],
  },
  { id: "ct-msa", slug: "msa", displayName: "MSA", fields: [OPPOSING_PARTY, GOVERNING_LAW] },
  // SOW attaches the two seeded slugs as Fields of its own, so the
  // dialog lands them through the ordinary carry and draws no box.
  {
    id: "ct-sow",
    slug: "sow",
    displayName: "SOW",
    fields: [OPPOSING_PARTY, COUNTERPARTY_NAME, NEEDED_BY],
  },
];

const MATTER_TYPES = [
  {
    id: "mt-dispute",
    slug: "dispute",
    displayName: "Dispute",
    fields: [OPPOSING_PARTY, GOVERNING_LAW],
    templates: [],
  },
  {
    id: "mt-employment",
    slug: "employment",
    displayName: "Employment",
    fields: [OPPOSING_PARTY, GOVERNING_LAW],
    templates: [EMPLOYMENT_TEMPLATE],
  },
];

/** The Request the screen opens on: a Request whose form collected two
 * values, one of which the NDA type has no field for. */
const request = (overrides: Record<string, unknown> = {}) =>
  staffRequest({
    summary: "Northwind Labs mutual NDA",
    description: "Small vendor, standard terms.",
    customFields: { opposing_party: "Northwind Labs", deal_desk_region: "EMEA" },
    ...overrides,
  });

/** The whole detail read, around one Request. The form collected both
 * values, so both are labelled here. */
const detail = (
  row: Record<string, unknown>,
  customFieldRefs: unknown = { users: [], entities: [] },
) => ({
  ...(staffDetail(row, [
    OPPOSING_PARTY,
    DEAL_DESK,
    REQUESTING_MANAGER,
    CONTRACTING_ENTITY,
    COUNTERPARTY_NAME,
    NEEDED_BY,
  ]) as Record<string, unknown>),
  customFieldRefs,
});

/**
 * The Request seam behind the screen, with Convert's own outcome on it
 * and the live contract taxonomy the dialog draws from. Everything
 * else — the detail read, the thread, the counters — is the shared
 * scaffold's.
 */
function requestApi(
  initial = request(),
  answer: (call: StubCall) => Response | undefined = () => undefined,
  customFieldRefs: unknown = { users: [], entities: [] },
) {
  const api = dispositionApi({
    segment: "convert",
    initial,
    answer,
    detail: (row) => detail(row, customFieldRefs),
    applied: (row, body) => {
      const sent = body as Record<string, unknown>;
      const requestType = row.requestType as { targetModule?: unknown };
      const explicitModule =
        "matterTypeId" in sent ? "matter" : "contractTypeId" in sent ? "contract" : null;
      if (explicitModule === "matter") expect(sent).not.toHaveProperty("contractTypeId");
      if (explicitModule === "contract") expect(sent).not.toHaveProperty("matterTypeId");
      const targetModule = explicitModule ?? requestType.targetModule;
      if (targetModule !== "contract" && targetModule !== "matter") {
        throw new Error("The conversion stub needs an explicit or configured target module.");
      }
      const toMatter = targetModule === "matter";
      return {
        ...row,
        status: "converted",
        convertedContract: toMatter ? null : { number: 51 },
        convertedRecord: toMatter
          ? { module: "matter", number: 12 }
          : { module: "contract", number: 51 },
      };
    },
    // The taxonomy read is on the page's loader for every suite, and
    // the shared scaffold lets `stubApi`'s empty default answer it.
    // Convert is the one that needs rows in it.
    extra: (call) =>
      call.url.pathname === "/api/v1/contracts/options" && call.method === "GET"
        ? json(200, {
            contractTypes: CONTRACT_TYPES,
            contractStatuses: [],
            users: [
              {
                id: "u2",
                displayName: "Nadia Counsel",
                image: null,
                archived: false,
                role: "legal_team_member",
              },
            ],
            approverGroups: [],
          })
        : call.url.pathname === "/api/v1/entities" && call.method === "GET"
          ? json(200, {
              entities: [{ id: "e2", legalName: "Orion Holdings Ltd", archivedAt: null }],
            })
          : call.url.pathname === "/api/v1/matters/options" && call.method === "GET"
            ? json(200, { matterTypes: MATTER_TYPES, matterStatuses: [], users: [] })
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

describe("the Triage menu (INT-007)", () => {
  it("offers both conversion targets and resolution from one Triage button", async () => {
    const user = userEvent.setup();
    open(requestApi());
    const actions = within(await subbar()).getAllByRole("button");
    expect(actions.map((button) => button.textContent)).toEqual(["Assign", "Triage"]);
    await user.click(actions[1]!);
    expect((await screen.findAllByRole("menuitem")).map((item) => item.textContent)).toEqual([
      "Convert to contract",
      "Convert to matter",
      "Resolve request without converting",
    ]);
  });

  it("opens the chosen module even when the request is routed to the other module", async () => {
    const user = userEvent.setup();
    open(requestApi());
    const dialog = await openDisposition(user, "Convert to matter");
    expect(within(dialog).getByRole("button", { name: "Convert to matter" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Convert to contract" })).toBeNull();
  });

  it("offers nothing on a Request somebody has already converted", async () => {
    open(
      requestApi(
        request({
          status: "converted",
          convertedContract: { number: 51 },
          convertedRecord: { module: "contract", number: 51 },
        }),
      ),
    );
    expect(within(await subbar()).queryByRole("button", { name: "Triage" })).toBeNull();
    // What was decided is the Status card's to say, and it links to the
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
    expect(within(dialog).queryByText(/nothing is re-keyed/)).toBeNull();
  });

  it("prefills editable priority from urgency", async () => {
    const user = userEvent.setup();
    open(requestApi());
    const dialog = await openConvert(user);
    expect(within(dialog).getByText("Priority")).toBeInTheDocument();
    expect(within(dialog).getByText("High")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Priority\*?$/)).toHaveValue("high");
  });

  it("prefills editable carried values", async () => {
    const user = userEvent.setup();
    open(requestApi());
    const dialog = await openConvert(user);
    expect(within(dialog).getByLabelText(/^Opposing party/)).toHaveValue("Northwind Labs");
    expect(within(dialog).getByText("Opposing party")).toBeInTheDocument();
  });

  it("prefills editable live references with their names", async () => {
    const user = userEvent.setup();
    open(
      requestApi(
        request({
          customFields: { requesting_manager: "u7", contracting_entity: "e1" },
        }),
        () => undefined,
        {
          users: [{ id: "u7", displayName: "Tom Iwu", archived: false }],
          entities: [
            {
              restricted: false,
              id: "e1",
              legalName: "Northwind GmbH",
              archived: false,
            },
          ],
        },
      ),
    );
    const dialog = await openConvert(user);
    expect(within(dialog).getByText("Tom Iwu")).toBeInTheDocument();
    expect(within(dialog).getByText("Northwind GmbH")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Requesting manager/)).toHaveValue("u7");
    expect(within(dialog).getByLabelText(/^Contracting entity/)).toHaveValue("e1");
  });

  it("saves an edited type, title and priority, and explicitly clears a carried value", async () => {
    const user = userEvent.setup();
    const api = requestApi();
    open(api);
    const dialog = await openConvert(user);
    await user.clear(within(dialog).getByLabelText(/^Opposing party/));
    await user.selectOptions(within(dialog).getByLabelText(/^Contract type/), "ct-msa");
    await user.type(within(dialog).getByLabelText(/^Governing law/), "England");
    await user.selectOptions(within(dialog).getByLabelText(/^Contract type/), "ct-nda");
    expect(within(dialog).getByLabelText(/^Opposing party/)).toHaveValue("");
    await user.selectOptions(within(dialog).getByLabelText(/^Contract type/), "ct-msa");
    expect(within(dialog).getByLabelText(/^Governing law/)).toHaveValue("England");
    await user.clear(within(dialog).getByLabelText(/^Title/));
    await user.type(within(dialog).getByLabelText(/^Title/), "Revised MSA");
    await user.selectOptions(within(dialog).getByLabelText(/^Priority\*?$/), "low");
    await user.click(within(dialog).getByRole("button", { name: "Convert to contract" }));
    await waitFor(() =>
      expect(api.conversions).toEqual([
        {
          title: "Revised MSA",
          contractTypeId: "ct-msa",
          priority: "low",
          customFields: { opposing_party: null, governing_law: "England" },
        },
      ]),
    );
  });

  it("draws a box for each archived carry and posts both live overrides", async () => {
    const user = userEvent.setup();
    const api = requestApi(
      request({
        customFields: { requesting_manager: "u7", contracting_entity: "e1" },
      }),
      () => undefined,
      {
        users: [{ id: "u7", displayName: "Tom Iwu", archived: true }],
        entities: [
          {
            restricted: false,
            id: "e1",
            legalName: "Wound Down GmbH",
            archived: true,
          },
        ],
      },
    );
    open(api);
    const dialog = await openConvert(user);
    const manager = within(dialog).getByLabelText(/^Requesting manager/);
    const entity = within(dialog).getByLabelText(/^Contracting entity/);
    expect(within(dialog).getByText(/Tom Iwu is archived/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Wound Down GmbH is archived/)).toBeInTheDocument();

    await user.selectOptions(manager, "u2");
    await user.selectOptions(entity, "e2");
    await user.click(within(dialog).getByRole("button", { name: "Convert to contract" }));
    await waitFor(() => expect(api.conversions).toHaveLength(1));
    expect(api.conversions[0]).toEqual({
      contractTypeId: "ct-nda",
      priority: "high",
      title: "Northwind Labs mutual NDA",
      customFields: { requesting_manager: "u2", contracting_entity: "e2" },
    });
  });

  it("does not submit until every archived carry has a live replacement", async () => {
    const user = userEvent.setup();
    const api = requestApi(
      request({ customFields: { requesting_manager: "u7" } }),
      () => undefined,
      { users: [{ id: "u7", displayName: "Tom Iwu", archived: true }], entities: [] },
    );
    open(api);
    const dialog = await openConvert(user);

    await user.click(within(dialog).getByRole("button", { name: "Convert to contract" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Pick a live value for Requesting manager.",
    );
    expect(api.conversions).toEqual([]);
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
    expect(within(dialog).getByLabelText(/^Opposing party/)).toHaveValue("Northwind Labs");
    expect(within(dialog).getByText("Does not carry into the contract")).toBeInTheDocument();
  });

  it("names fields that do not carry without explanatory copy", async () => {
    // The INT-002 M19/7 addendum, paid where somebody can see it before
    // they press: the NDA contract type has no field for the deal desk
    // region, so it has nowhere to land.
    const user = userEvent.setup();
    open(requestApi());
    const dialog = await openConvert(user);
    expect(within(dialog).getByText("Does not carry into the contract")).toBeInTheDocument();
    expect(within(dialog).getByText("Deal desk region")).toBeInTheDocument();
    expect(within(dialog).queryByText(/Nothing is deleted/)).toBeNull();
  });
});

describe("the facts that are not Fields (INT-002, focus group 2026-09-07)", () => {
  /** A Request whose form collected the two seeded fields the dialog
   * lands through its own boxes, plus one with nowhere to go. */
  const collected = () =>
    request({
      customFields: {
        counterparty_name: "Helix Labs GmbH",
        needed_by: "2026-10-01",
        deal_desk_region: "EMEA",
      },
    });

  it("draws Counterparty and Needed by prefilled, sends both, and lists neither as staying behind", async () => {
    const user = userEvent.setup();
    const api = requestApi(collected());
    open(api);
    const dialog = await openConvert(user);
    expect(within(dialog).getByLabelText(/^Counterparty$/)).toHaveValue("Helix Labs GmbH");
    expect(within(dialog).getByLabelText(/^Needed by/)).toHaveValue("2026-10-01");

    // The third value still has nowhere to land, and is the only one named.
    expect(within(dialog).getByText("Does not carry into the contract")).toBeInTheDocument();
    expect(within(dialog).getByText("Deal desk region")).toBeInTheDocument();
    expect(within(dialog).queryByText("Counterparty name")).toBeNull();
    expect(within(dialog).queryByText(/Needed by,|, Needed by/)).toBeNull();

    await user.click(within(dialog).getByRole("button", { name: "Convert to contract" }));
    await waitFor(() => expect(api.conversions).toHaveLength(1));
    expect(api.conversions[0]).toEqual({
      title: "Northwind Labs mutual NDA",
      contractTypeId: "ct-nda",
      priority: "high",
      counterpartyName: "Helix Labs GmbH",
      neededBy: "2026-10-01",
    });
  });

  it("sends what the boxes hold after an edit, and nothing for an emptied box", async () => {
    const user = userEvent.setup();
    const api = requestApi(collected());
    open(api);
    const dialog = await openConvert(user);
    await user.clear(within(dialog).getByLabelText(/^Counterparty$/));
    await user.type(within(dialog).getByLabelText(/^Counterparty$/), "Helix Labs AG");
    await user.clear(within(dialog).getByLabelText(/^Needed by/));
    // A cleared box carries nothing, so the collected date is named as
    // staying behind again, after the value that never had a box.
    expect(within(dialog).getByText("Deal desk region and Needed by")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Convert to contract" }));
    await waitFor(() => expect(api.conversions).toHaveLength(1));
    expect(api.conversions[0]).toEqual({
      title: "Northwind Labs mutual NDA",
      contractTypeId: "ct-nda",
      priority: "high",
      counterpartyName: "Helix Labs AG",
    });
  });

  it("names both collected values as staying behind once both boxes are cleared", async () => {
    const user = userEvent.setup();
    const api = requestApi(collected());
    open(api);
    const dialog = await openConvert(user);
    expect(within(dialog).getByText("Deal desk region")).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText(/^Counterparty$/));
    expect(within(dialog).getByText("Deal desk region and Counterparty name")).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText(/^Needed by/));
    expect(
      within(dialog).getByText("Deal desk region, Counterparty name, and Needed by"),
    ).toBeInTheDocument();
    // Typing the name back takes it off the list again.
    await user.type(within(dialog).getByLabelText(/^Counterparty$/), "Helix Labs AG");
    expect(within(dialog).getByText("Deal desk region and Needed by")).toBeInTheDocument();
  });

  it("draws no box for a slug the target type attaches as a Field, and lands it as that Field", async () => {
    const user = userEvent.setup();
    const api = requestApi(collected());
    open(api);
    const dialog = await openConvert(user);
    await user.selectOptions(within(dialog).getByLabelText(/^Contract type/), "ct-sow");

    // The dialog's own boxes are gone; the type's Fields stand in their
    // place, prefilled from what the form collected.
    expect(dialog.querySelector("#convert-needed-by")).toBeNull();
    expect(dialog.querySelector("#convert-counterparty")).toBeNull();
    const neededBy = within(dialog).getByLabelText(/^Needed by/);
    expect(neededBy).toHaveAttribute("id", "convert-needed_by");
    expect(neededBy).toHaveValue("2026-10-01");
    const counterparty = within(dialog).getByLabelText(/^Counterparty name/);
    expect(counterparty).toHaveAttribute("id", "convert-counterparty_name");
    expect(counterparty).toHaveValue("Helix Labs GmbH");
    // Neither is listed as staying behind: the Field carries it.
    expect(within(dialog).getByText("Deal desk region")).toBeInTheDocument();
    expect(within(dialog).queryByText(/Needed by,|, Needed by|and Needed by/)).toBeNull();
    expect(within(dialog).queryByText(/Counterparty name,|, Counterparty name/)).toBeNull();

    // An edit rides the Field, not a dedicated member of the body.
    await user.clear(neededBy);
    await user.type(neededBy, "2026-11-15");
    await user.click(within(dialog).getByRole("button", { name: "Convert to contract" }));
    await waitFor(() => expect(api.conversions).toHaveLength(1));
    expect(api.conversions[0]).toEqual({
      title: "Northwind Labs mutual NDA",
      contractTypeId: "ct-sow",
      priority: "high",
      customFields: { needed_by: "2026-11-15" },
    });
    expect(api.conversions[0]).not.toHaveProperty("neededBy");
    expect(api.conversions[0]).not.toHaveProperty("counterpartyName");
  });

  it("draws no Counterparty box on the matter arm, so the name is named as staying behind", async () => {
    const user = userEvent.setup();
    const api = requestApi(collected());
    open(api);
    const dialog = await openDisposition(user, "Convert to matter");
    await user.selectOptions(within(dialog).getByLabelText(/^Matter type/), "mt-dispute");
    expect(within(dialog).queryByLabelText(/^Counterparty$/)).toBeNull();
    expect(within(dialog).getByLabelText(/^Needed by/)).toHaveValue("2026-10-01");
    expect(within(dialog).getByText("Does not carry into the matter")).toBeInTheDocument();
    expect(within(dialog).getByText(/Counterparty name/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Deal desk region/)).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/^Governing law/), "DIFC Courts");
    await user.click(within(dialog).getByRole("button", { name: "Convert to matter" }));
    await waitFor(() => expect(api.conversions).toHaveLength(1));
    expect(api.conversions[0]).toEqual({
      title: "Northwind Labs mutual NDA",
      matterTypeId: "mt-dispute",
      priority: "high",
      customFields: { governing_law: "DIFC Courts" },
      neededBy: "2026-10-01",
    });
  });

  it("draws both boxes empty when the form collected neither, and sends neither", async () => {
    const user = userEvent.setup();
    const api = requestApi();
    open(api);
    const dialog = await openConvert(user);
    expect(within(dialog).getByLabelText(/^Counterparty$/)).toHaveValue("");
    expect(within(dialog).getByLabelText(/^Needed by/)).toHaveValue("");
    await user.click(within(dialog).getByRole("button", { name: "Convert to contract" }));
    await waitFor(() => expect(api.conversions).toHaveLength(1));
    expect(api.conversions[0]).not.toHaveProperty("counterpartyName");
    expect(api.conversions[0]).not.toHaveProperty("neededBy");
  });
});

describe("editable conversion targets", () => {
  it("prefills the configured type in an editable picker", async () => {
    const user = userEvent.setup();
    open(requestApi());
    const dialog = await openConvert(user);
    expect(within(dialog).getByText("NDA")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Contract type/)).toHaveValue("ct-nda");
  });

  it("sends the selected type and priority", async () => {
    const user = userEvent.setup();
    const api = requestApi();
    open(api);
    const dialog = await openConvert(user);
    await user.click(within(dialog).getByRole("button", { name: "Convert to contract" }));
    await waitFor(() => expect(api.conversions).toHaveLength(1));
    expect(api.conversions[0]).toEqual({
      title: "Northwind Labs mutual NDA",
      contractTypeId: "ct-nda",
      priority: "high",
    });
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

    // Nothing is sent until the one choice is made.
    await user.click(within(dialog).getByRole("button", { name: "Convert to contract" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Pick a contract type.");
    expect(api.conversions).toEqual([]);

    await user.selectOptions(within(dialog).getByLabelText(/^Contract type/), "ct-nda");
    await user.click(within(dialog).getByRole("button", { name: "Convert to contract" }));
    await waitFor(() => expect(api.conversions).toHaveLength(1));
    expect(api.conversions[0]).toEqual({
      priority: "high",
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

  it("opens a matter target on its bound matter type and module-named CTA", async () => {
    const user = userEvent.setup();
    const api = requestApi(
      request({
        customFields: {},
        requestType: {
          id: "rt-advice",
          displayName: "Advice request",
          targetModule: "matter",
          targetTypeId: "mt-dispute",
          targetTypeName: "Dispute",
        },
      }),
    );
    open(api);
    const dialog = await openDisposition(user, "Convert to matter");
    expect(within(dialog).getByRole("heading")).toHaveTextContent("Convert R-45 to a matter");
    expect(within(dialog).getByLabelText(/^Title/)).toHaveAttribute("maxlength", "500");
    expect(within(dialog).getByText("Dispute")).toBeInTheDocument();
    expect(within(dialog).queryByText(/is a re-target/)).toBeNull();
    await user.type(within(dialog).getByLabelText(/^Governing law/), "DIFC Courts");
    await user.click(within(dialog).getByRole("button", { name: "Convert to matter" }));
    await waitFor(() => expect(api.conversions).toHaveLength(1));
    expect(api.conversions[0]).toEqual({
      matterTypeId: "mt-dispute",
      priority: "high",
      title: "Northwind Labs mutual NDA",
      customFields: { governing_law: "DIFC Courts" },
    });
  });

  it("offers the confirmed type's optional template and sends an overridable pre-fill", async () => {
    const user = userEvent.setup();
    const api = requestApi(
      request({
        requestType: {
          id: "rt-employment",
          displayName: "Employment request",
          targetModule: "matter",
          targetTypeId: "mt-employment",
          targetTypeName: "Employment",
        },
      }),
    );
    open(api);
    const dialog = await openDisposition(user, "Convert to matter");
    const template = within(dialog).getByLabelText(/^Matter template/);
    expect(template).toHaveValue("");
    expect(
      within(template)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["No template", "Employment response"]);
    expect(within(dialog).queryByText(/Template adds/)).toBeNull();
    expect(within(dialog).getByLabelText(/^Title/)).toHaveValue("Northwind Labs mutual NDA");
    expect(within(dialog).getByLabelText(/^Opposing party/)).toHaveValue("Northwind Labs");

    const forum = within(dialog).getByLabelText(/^Governing law/);
    expect(forum).toHaveValue("");
    await user.selectOptions(template, "tpl-employment");
    expect(forum).toHaveValue("Template forum");
    await user.selectOptions(template, "");
    expect(forum).toHaveValue("");
    await user.click(within(dialog).getByRole("button", { name: "Convert to matter" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Fill Governing law — this matter type requires it.",
    );
    expect(api.conversions).toEqual([]);

    await user.selectOptions(template, "tpl-employment");
    expect(forum).toHaveValue("Template forum");
    await user.clear(forum);
    await user.type(forum, "DIFC Courts");
    await user.selectOptions(template, "");
    expect(forum).toHaveValue("DIFC Courts");
    await user.selectOptions(template, "tpl-employment");
    expect(forum).toHaveValue("DIFC Courts");
    await user.click(within(dialog).getByRole("button", { name: "Convert to matter" }));
    await waitFor(() => expect(api.conversions).toHaveLength(1));
    expect(api.conversions[0]).toEqual({
      matterTypeId: "mt-employment",
      priority: "high",
      title: "Northwind Labs mutual NDA",
      templateId: "tpl-employment",
      customFields: { governing_law: "DIFC Courts" },
    });
  });

  it("drops a template pre-fill when the picked type changes to one without that template", async () => {
    const user = userEvent.setup();
    const api = requestApi(request({ customFields: {} }));
    open(api);
    const dialog = await openConvert(user);
    await user.click(within(dialog).getByRole("button", { name: "Convert to matter instead" }));
    const typePicker = within(dialog).getByLabelText(/^Matter type/);
    await user.selectOptions(typePicker, "mt-employment");
    expect(within(dialog).getByLabelText(/^Matter template/)).toHaveValue("");
    expect(within(dialog).getByLabelText(/^Governing law/)).toHaveValue("");
    await user.selectOptions(within(dialog).getByLabelText(/^Matter template/), "tpl-employment");
    expect(within(dialog).getByLabelText(/^Matter template/)).toHaveValue("tpl-employment");
    expect(within(dialog).getByLabelText(/^Governing law/)).toHaveValue("Template forum");

    await user.selectOptions(typePicker, "mt-dispute");
    await user.selectOptions(typePicker, "mt-employment");
    expect(within(dialog).getByLabelText(/^Matter template/)).toHaveValue("");
    expect(within(dialog).getByLabelText(/^Governing law/)).toHaveValue("");
    await user.type(within(dialog).getByLabelText(/^Governing law/), "DIFC Courts");
    await user.click(within(dialog).getByRole("button", { name: "Convert to matter" }));
    await waitFor(() => expect(api.conversions).toHaveLength(1));
    expect(api.conversions[0]).toEqual({
      priority: "high",
      title: "Northwind Labs mutual NDA",
      matterTypeId: "mt-employment",
      customFields: { governing_law: "DIFC Courts" },
    });
  });

  it("submits a template-satisfied required field without making triage re-enter it", async () => {
    const user = userEvent.setup();
    const api = requestApi(
      request({
        requestType: {
          id: "rt-employment",
          displayName: "Employment request",
          targetModule: "matter",
          targetTypeId: "mt-employment",
          targetTypeName: "Employment",
        },
      }),
    );
    open(api);
    const dialog = await openDisposition(user, "Convert to matter");
    await user.selectOptions(within(dialog).getByLabelText(/^Matter template/), "tpl-employment");
    expect(within(dialog).getByLabelText(/^Governing law/)).toHaveValue("Template forum");
    await user.click(within(dialog).getByRole("button", { name: "Convert to matter" }));
    await waitFor(() => expect(api.conversions).toHaveLength(1));
    expect(api.conversions[0]).toEqual({
      matterTypeId: "mt-employment",
      priority: "high",
      title: "Northwind Labs mutual NDA",
      templateId: "tpl-employment",
    });
  });

  it("draws both Re-target directions and sends only the chosen module's type", async () => {
    const user = userEvent.setup();
    const contractApi = requestApi();
    const contractView = open(contractApi);
    const contractDialog = await openConvert(user);
    await user.click(
      within(contractDialog).getByRole("button", { name: "Convert to matter instead" }),
    );

    await user.selectOptions(within(contractDialog).getByLabelText(/^Matter type/), "mt-dispute");
    await user.type(within(contractDialog).getByLabelText(/^Governing law/), "DIFC Courts");
    await user.click(within(contractDialog).getByRole("button", { name: "Convert to matter" }));
    await waitFor(() => expect(contractApi.conversions).toHaveLength(1));
    expect(contractApi.conversions[0]).toMatchObject({ matterTypeId: "mt-dispute" });
    contractView.view.unmount();

    const matterApi = requestApi(
      request({
        customFields: {},
        requestType: {
          id: "rt-advice",
          displayName: "Advice request",
          targetModule: "matter",
          targetTypeId: "mt-dispute",
          targetTypeName: "Dispute",
        },
      }),
    );
    open(matterApi);
    const matterDialog = await openDisposition(user, "Convert to matter");
    await user.click(
      within(matterDialog).getByRole("button", { name: "Convert to contract instead" }),
    );

    await user.selectOptions(within(matterDialog).getByLabelText(/^Contract type/), "ct-nda");
    await user.click(within(matterDialog).getByRole("button", { name: "Convert to contract" }));
    await waitFor(() => expect(matterApi.conversions).toHaveLength(1));
    expect(matterApi.conversions[0]).toMatchObject({ contractTypeId: "ct-nda" });
    expect(matterApi.conversions[0]).not.toHaveProperty("matterTypeId");
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

    await user.click(within(dialog).getByRole("button", { name: "Convert to contract" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Fill Governing law — this contract type requires it.",
    );
    expect(api.conversions).toEqual([]);

    await user.type(gap, "England and Wales");
    await user.click(within(dialog).getByRole("button", { name: "Convert to contract" }));
    await waitFor(() => expect(api.conversions).toHaveLength(1));
    expect(api.conversions[0]).toEqual({
      contractTypeId: "ct-msa",
      priority: "high",
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
    await user.click(within(dialog).getByRole("button", { name: "Convert to contract" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Name the contract.");
    expect(within(dialog).getByLabelText(/^Title/)).toHaveAttribute("aria-invalid", "true");
    expect(api.conversions).toEqual([]);
  });
});

describe("what happens after the press (INT-007)", () => {
  it("repaints the page as converted, with the record it became", async () => {
    const user = userEvent.setup();
    const api = requestApi();
    let attempts = 0;
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/contracts/51/documents" && call.method === "POST") {
          expect(api.conversions).toHaveLength(1);
          attempts++;
          return attempts === 1
            ? json(500, { detail: "Please retry this upload." })
            : json(201, { document: { id: "converted-doc" } });
        }
        return api.handler(call);
      },
    });
    renderAt("/inbox/45");
    const dialog = await openConvert(user);
    await user.upload(
      within(dialog).getByLabelText("Attach documents"),
      new File(["advice"], "advice.txt", { type: "text/plain" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Convert to contract" }));
    await screen.findByText("Please retry this upload.");
    await user.click(screen.getByRole("button", { name: "Retry failed uploads" }));
    await waitFor(() => expect(attempts).toBe(2));

    // The write answers the whole envelope and the page still re-reads:
    // the Status card, the status pill, and the thread's watermark all
    // hang off the loader.
    expect(await screen.findByRole("link", { name: "C-51" })).toBeInTheDocument();
    await waitFor(() => expect(api.reads).toBeGreaterThan(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("links a matter conversion from the Status card", async () => {
    const user = userEvent.setup();
    const api = requestApi(
      request({
        customFields: {},
        requestType: {
          id: "rt-dispute",
          displayName: "Dispute or claim",
          targetModule: "matter",
          targetTypeId: "mt-dispute",
          targetTypeName: "Dispute",
        },
      }),
    );
    open(api);
    const dialog = await openDisposition(user, "Convert to matter");
    await user.type(within(dialog).getByLabelText(/^Governing law/), "DIFC Courts");
    await user.click(within(dialog).getByRole("button", { name: "Convert to matter" }));
    expect(await screen.findByRole("link", { name: "M-12" })).toHaveAttribute(
      "href",
      "/matters/12",
    );
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
    expect(within(await subbar()).getByRole("button", { name: "Triage" })).toBeInTheDocument();
  });

  it("prints the seam's own sentence on an ordinary refusal", async () => {
    const user = userEvent.setup();
    const api = requestApi(request(), () =>
      problem(400, "Fill Governing law first — the type requires it."),
    );
    open(api);
    const dialog = await openConvert(user);
    await user.click(within(dialog).getByRole("button", { name: "Convert to contract" }));
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
        convertedRecord: { module: "contract", number: 51 },
      };
      return new Response(JSON.stringify(body), {
        status: 409,
        headers: { "content-type": "application/problem+json" },
      });
    });
    open(api);
    const dialog = await openConvert(user);
    await user.click(within(dialog).getByRole("button", { name: "Convert to contract" }));

    expect(
      await within(dialog).findByText("Somebody else already converted this request."),
    ).toBeInTheDocument();
    // The one thing a plain outcome cannot say.
    expect(within(dialog).getByText("It became C-51.")).toBeInTheDocument();
    // Nothing left to decide, so the form is gone rather than pressable.
    expect(within(dialog).queryByRole("button", { name: /Convert to/ })).toBeNull();
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
        convertedRecord: null,
      };
      return new Response(JSON.stringify(body), {
        status: 409,
        headers: { "content-type": "application/problem+json" },
      });
    });
    open(api);
    const dialog = await openConvert(user);
    await user.click(within(dialog).getByRole("button", { name: "Convert to contract" }));

    expect(
      await within(dialog).findByText("Somebody else already declined this request."),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/^It became/)).toBeNull();
  });
});

describe("Matter Conversion drafts", () => {
  function preparedApi(pending = false, allValues = false) {
    const base = requestApi();
    const draft = {
      id: "draft-1",
      targetTypeId: "mt-dispute",
      state: pending ? "pending" : "ready",
      suggestions: {
        ...(allValues
          ? {
              priority: {
                value: "critical",
                citations: [{ sourceId: "message:1", revision: "rev", quote: "urgent" }],
              },
              needed_by: {
                value: "2026-10-02",
                citations: [{ sourceId: "message:1", revision: "rev", quote: "October 2" }],
              },
            }
          : {}),
        title: {
          value: "Prepared response",
          citations: [{ sourceId: "message:1", revision: "rev", quote: "Prepare a response" }],
        },
        description: {
          value: "A response is needed.",
          citations: [{ sourceId: "message:1", revision: "rev", quote: "Prepare a response" }],
        },
        "field:governing_law": {
          value: "England",
          citations: [{ sourceId: "message:1", revision: "rev", quote: "England" }],
        },
      },
      conflicts: {},
      warnings: [],
      failure: null,
    };
    return {
      ...base,
      handler: (call: StubCall) => {
        if (call.url.pathname === "/api/v1/conversion-drafts/settings")
          return json(200, { matterPreparation: true });
        if (call.url.pathname.endsWith("/conversion-drafts")) return json(202, { draft });
        if (call.url.pathname.endsWith("/conversion-drafts/draft-1")) return json(200, { draft });
        if (call.url.pathname.includes("/evidence/"))
          return json(200, {
            available: true,
            citations: [
              {
                sourceId: "message:1",
                label: "Nadia Counsel — September 11",
                text: "Prepare a response in England",
                quote: "Prepare a response",
              },
            ],
          });
        return base.handler(call);
      },
    };
  }
  it("shows editable prefill and cited markers, then submits edits as human values", async () => {
    const user = userEvent.setup();
    const api = preparedApi();
    open(api);
    await openDisposition(user, "Convert to matter");
    const title = await screen.findByDisplayValue("Prepared response");
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByText("Unverified")).toHaveLength(3);
    await user.click(within(dialog).getAllByRole("button", { name: "View source evidence" })[0]!);
    expect(await screen.findByText("Nadia Counsel — September 11")).toBeVisible();
    await user.keyboard("{Escape}");
    await user.clear(title);
    await user.type(title, "Human opening title");
    expect(within(dialog).getAllByText("Unverified")).toHaveLength(2);
    await user.selectOptions(within(dialog).getByLabelText(/^Matter type/), "mt-employment");
    expect(within(dialog).getAllByText("Unverified")).toHaveLength(2);
    await user.click(within(dialog).getByRole("button", { name: "Convert to matter" }));
    await waitFor(() => expect(api.conversions).toHaveLength(1));
    expect(api.conversions[0]).toMatchObject({
      title: "Human opening title",
      matterTypeId: "mt-employment",
      description: "A response is needed.",
      conversionDraftId: "draft-1",
      aiAccepted: ["description", "field:governing_law"],
      customFields: { governing_law: "England" },
    });
  });
  it("opens attachment evidence above Convert, centres its PDF passage, and restores focus without changing the page", async () => {
    const user = userEvent.setup();
    const base = preparedApi();
    const href = "/api/v1/requests/42/conversion-drafts/draft-1/sources/attachment%3A2/preview";
    const api = {
      ...base,
      handler: (call: StubCall) =>
        call.url.pathname.includes("/evidence/")
          ? json(200, {
              available: true,
              citations: [
                {
                  sourceId: "request:45:summary",
                  label: "Request summary",
                  text: "Opening context",
                  quote: "Opening context",
                },
                {
                  sourceId: "attachment:2",
                  label: "Second attachment.pdf",
                  text: "A second termination right appears here.",
                  quote: "A second termination right appears here.",
                  attachment: {
                    previewHref: href,
                    downloadHref: href.replace("preview", "download"),
                    documentId: null,
                    versionId: null,
                    method: "native_layer",
                  },
                },
              ],
            })
          : base.handler(call),
    };
    const { router } = open(api);
    await openDisposition(user, "Convert to matter");
    await screen.findByDisplayValue("Prepared response");
    const convert = screen.getByRole("dialog");
    convert.scrollTop = 165;
    const trigger = within(convert).getAllByRole("button", { name: "View source evidence" })[0]!;
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    try {
      await user.click(trigger);
      const panel = await screen.findByRole("dialog", { name: "Source document" });
      expect(convert).toBeInTheDocument();
      expect(convert.scrollTop).toBe(165);
      expect(router.state.location.pathname).toBe("/inbox/45");
      expect(within(panel).getByRole("link", { name: "Download" })).toHaveAttribute(
        "href",
        href.replace("preview", "download"),
      );
      expect(await within(panel).findByText("1 of 1")).toBeVisible();
      await waitFor(() => {
        const marks = panel.querySelectorAll<HTMLElement>(
          '[data-page-number="2"] mark[data-pdf-find-match="0"]',
        );
        expect(
          Array.from(marks)
            .map((m) => m.textContent)
            .join(""),
        ).toBe("A second termination right appears here.");
        expect(
          scroll.mock.instances.some(
            (element, index) =>
              element === marks[0] &&
              (scroll.mock.calls[index]?.[0] as ScrollIntoViewOptions)?.block === "center",
          ),
        ).toBe(true);
      });
      await user.keyboard("{Escape}");
      await waitFor(() => expect(trigger).toHaveFocus());
      expect(screen.getByRole("dialog")).toBe(convert);
      expect(convert.scrollTop).toBe(165);
      expect(within(convert).getByDisplayValue("Prepared response")).toBeVisible();
      await user.click(trigger);
      expect(await screen.findByRole("dialog", { name: "Source document" })).toBeVisible();
    } finally {
      scroll.mockRestore();
    }
  });
  it("leaves prepared values behind when the dialog moves to the contract arm", async () => {
    const user = userEvent.setup();
    open(preparedApi());
    await openDisposition(user, "Convert to matter");
    const dialog = screen.getByRole("dialog");
    await screen.findByDisplayValue("Prepared response");
    await user.click(within(dialog).getByRole("button", { name: /Convert to contract instead/ }));
    // A draft is prepared for one Matter and carries no Contract
    // provenance, so its text cannot ride onto a Contract unmarked.
    expect(within(dialog).getByLabelText("Title", { exact: false })).toHaveValue(
      "Northwind Labs mutual NDA",
    );
    expect(within(dialog).queryByText("Unverified")).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: /Convert to matter instead/ }));
    expect(within(dialog).getByLabelText("Title", { exact: false })).toHaveValue(
      "Northwind Labs mutual NDA",
    );
    expect(within(dialog).queryByText("Unverified")).toBeNull();
  });
  it.each(["Continue manually", "Convert to contract instead"])(
    "%s restores untouched defaults for every prepared value",
    async (action) => {
      const user = userEvent.setup();
      open(preparedApi(false, true));
      await openDisposition(user, "Convert to matter");
      await screen.findByDisplayValue("Prepared response");
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByLabelText(/^Priority/)).toHaveValue("critical");
      expect(within(dialog).getByLabelText(/^Needed by/)).toHaveValue("2026-10-02");
      await user.click(within(dialog).getByRole("button", { name: action }));
      if (action === "Convert to contract instead")
        await user.selectOptions(within(dialog).getByLabelText(/^Contract type/), "ct-msa");
      expect(within(dialog).getByLabelText(/^Title/)).toHaveValue("Northwind Labs mutual NDA");
      expect(within(dialog).getByLabelText(/^Priority/)).toHaveValue("high");
      expect(within(dialog).getByLabelText(/^Needed by/)).toHaveValue("");
      expect(within(dialog).getByLabelText(/^Governing law/)).toHaveValue("");
      expect(within(dialog).queryByText("Unverified")).toBeNull();
      expect(within(dialog).queryByLabelText("Description")).toBeNull();
    },
  );
  it.each(["Continue manually", "Convert to contract instead"])(
    "%s preserves human edits while discarding the draft",
    async (action) => {
      const user = userEvent.setup();
      const api = preparedApi(false, true);
      open(api);
      await openDisposition(user, "Convert to matter");
      await screen.findByDisplayValue("Prepared response");
      const dialog = screen.getByRole("dialog");
      for (const [label, value] of [
        [/^Title/, "Human title"],
        [/^Governing law/, "France"],
        [/^Description/, "Human description"],
      ] as const) {
        const box = within(dialog).getByLabelText(label);
        await user.clear(box);
        await user.type(box, value);
      }
      await user.selectOptions(within(dialog).getByLabelText(/^Priority/), "low");
      const date = within(dialog).getByLabelText(/^Needed by/);
      await user.clear(date);
      await user.type(date, "2026-11-03");
      await user.click(within(dialog).getByRole("button", { name: action }));
      if (action === "Convert to contract instead")
        await user.selectOptions(within(dialog).getByLabelText(/^Contract type/), "ct-msa");
      expect(within(dialog).getByLabelText(/^Title/)).toHaveValue("Human title");
      expect(within(dialog).getByLabelText(/^Priority/)).toHaveValue("low");
      expect(within(dialog).getByLabelText(/^Needed by/)).toHaveValue("2026-11-03");
      expect(within(dialog).getByLabelText(/^Governing law/)).toHaveValue("France");
      expect(within(dialog).queryByText("Unverified")).toBeNull();
      await user.click(
        within(dialog).getByRole("button", {
          name: action === "Continue manually" ? "Convert to matter" : "Convert to contract",
        }),
      );
      await waitFor(() => expect(api.conversions).toHaveLength(1));
      expect(api.conversions[0]).toMatchObject({
        title: "Human title",
        priority: "low",
        neededBy: "2026-11-03",
        customFields: { governing_law: "France" },
      });
      expect(api.conversions[0]).not.toHaveProperty("conversionDraftId");
      expect(api.conversions[0]).not.toHaveProperty("aiAccepted");
      if (action === "Continue manually")
        expect(api.conversions[0]).toHaveProperty("description", "Human description");
    },
  );
  it("keeps manual continuation usable while preparation waits", async () => {
    const user = userEvent.setup();
    const api = preparedApi(true);
    open(api);
    await openDisposition(user, "Convert to matter");
    expect(await screen.findByText("Getting matter ready…")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Continue manually" }));
    const title = screen.getByLabelText("Title", { exact: false });
    await user.clear(title);
    await user.type(title, "My manual title");
    expect(screen.queryByText("Unverified")).not.toBeInTheDocument();
    expect(title).toHaveValue("My manual title");
  });
});
