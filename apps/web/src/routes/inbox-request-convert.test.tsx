// SPDX-License-Identifier: AGPL-3.0-only

/** Conversion prefills, editable values, validation and disposition outcomes. */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
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
  description: "Who in the business owns this deal.",
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
    title: "Northwind Labs mutual NDA",
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

function open(
  api: Omit<ReturnType<typeof requestApi>, "handler"> & {
    handler: (call: StubCall) => Response | Promise<Response> | undefined;
  },
) {
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
  it("seeds the title from the title and says where it came from", async () => {
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
  function preparedApi(
    pending = false,
    allValues = false,
    withAttachments: boolean | "readable" = false,
  ) {
    const base = requestApi(
      request({
        requestType: {
          id: "rt-dispute",
          displayName: "Dispute",
          targetModule: "matter",
          targetTypeId: "mt-dispute",
          targetTypeName: "Dispute",
        },
      }),
    );
    const draft = {
      id: "draft-1",
      targetModule: "matter",
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
      limits: {
        sources: 20,
        bytes: 10485760,
        totalBytes: 52428800,
        characters: 30000,
        totalCharacters: 180000,
        sourceRuntimeMs: 15000,
        runtimeMs: 45000,
      },
      warnings: withAttachments === true ? ["attachment_omissions"] : [],
      attachmentReads: withAttachments
        ? [
            { sourceId: "attachment:nda", label: "Signed NDA.pdf", status: "readable" },
            ...(withAttachments === true
              ? [
                  { sourceId: "attachment:sheet", label: "Costs.xlsx", status: "unsupported" },
                  {
                    sourceId: "attachment:long",
                    label: "Long agreement.pdf",
                    status: "truncated",
                    reason: "character_limit",
                  },
                ]
              : []),
          ]
        : [],
      failure: null,
    };
    return {
      ...base,
      handler: (call: StubCall) => {
        if (call.url.pathname === "/api/v1/conversion-drafts/settings")
          return json(200, { matterPreparation: true });
        if (call.url.pathname.endsWith("/conversion-drafts")) {
          draft.targetTypeId = (call.body as { targetTypeId: string }).targetTypeId;
          return json(202, { draft });
        }
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
  it("switches descriptions for comparison without changing the conversion draft", async () => {
    const user = userEvent.setup();
    const api = preparedApi();
    open(api);
    await openDisposition(user, "Convert to matter");
    const generated = await screen.findByRole("textbox", { name: "Description" });
    expect(generated).toHaveValue("A response is needed.");
    const toggle = screen.getByRole("switch", { name: "Show requester description" });
    await user.click(toggle);
    expect(toggle).toBeChecked();
    expect(screen.queryByRole("textbox", { name: "Description" })).toBeNull();
    expect(
      within(screen.getByRole("dialog")).getByText("Small vendor, standard terms.", {
        selector: "p",
      }),
    ).toBeVisible();
    await user.click(toggle);
    const current = screen.getByRole("textbox", { name: "Description" });
    expect(current).toHaveValue("A response is needed.");
    await user.clear(current);
    await user.type(current, "Reviewed description");
    await user.click(toggle);
    await user.click(toggle);
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue(
      "Reviewed description",
    );
    expect(api.conversions).toHaveLength(0);
    await user.click(toggle);
    await user.click(screen.getByRole("button", { name: "Convert to matter" }));
    await waitFor(() => expect(api.conversions).toHaveLength(1));
    expect(api.conversions[0]).toHaveProperty("description", "Reviewed description");
  });
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
    await waitFor(() => expect(within(dialog).getAllByText("Unverified")).toHaveLength(2));
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
                  sourceId: "request:45:title",
                  label: "Request title",
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
      const panel = await screen.findByRole("dialog", { name: "Title" });
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
      expect(await screen.findByRole("dialog", { name: "Title" })).toBeVisible();
    } finally {
      scroll.mockRestore();
    }
  });
  it("groups cited passages without repeating the description and keeps PDF passages reachable", async () => {
    const user = userEvent.setup();
    const base = preparedApi();
    const quotes = Array.from({ length: 11 }, (_, index) => `Request passage ${index + 1}.`);
    const requestCitations = quotes.map((quote) => ({
      sourceId: "request:45:description",
      label: "R-45 description",
      text: quotes.join("\n"),
      quote,
    }));
    const attachment = {
      sourceId: "attachment:2",
      label: "Agreement.pdf",
      text: PDF_PAGE_TEXT.flat().join(" "),
      attachment: {
        previewHref: "/api/v1/requests/45/conversion-drafts/draft-1/sources/attachment%3A2/preview",
        downloadHref:
          "/api/v1/requests/45/conversion-drafts/draft-1/sources/attachment%3A2/download",
        documentId: null,
        versionId: null,
        method: "native_layer",
      },
    };
    open({
      ...base,
      handler: (call: StubCall) =>
        call.url.pathname.includes("/evidence/")
          ? json(200, {
              available: true,
              citations: [
                ...requestCitations,
                requestCitations[0],
                { ...attachment, quote: "The first termination right is on this page." },
                { ...attachment, quote: "A second termination right appears here." },
              ],
            })
          : base.handler(call),
    });
    await openDisposition(user, "Convert to matter");
    await screen.findByDisplayValue("Prepared response");
    await user.click(screen.getAllByRole("button", { name: "View source evidence" })[0]!);
    const panel = await screen.findByRole("dialog", { name: "Title" });
    // The reader opens straight from the sparkle, on the file, with the
    // popover's explanation column beside the document.
    expect(screen.getAllByRole("heading", { name: "Title" })).toEqual([
      within(panel).getByRole("heading", { name: "Title" }),
    ]);
    expect(within(panel).getByText("No explanation was saved for this value.")).toBeVisible();
    expect(within(panel).getByRole("button", { name: "Agreement.pdf" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(panel).getAllByRole("button", { name: "R-45 description" })).toHaveLength(1);
    expect(within(panel).getAllByRole("button", { name: "Agreement.pdf" })).toHaveLength(1);
    expect(panel.querySelector("blockquote")).toBeNull();
    expect(within(panel).queryByText("Agreement.pdf", { selector: "p" })).toBeNull();
    expect(within(panel).getByText("Passage 1 of 2")).toBeVisible();
    await user.click(within(panel).getByRole("button", { name: "Next passage" }));
    expect(within(panel).getByText("Passage 2 of 2")).toBeVisible();
    await waitFor(() => {
      const marks = panel.querySelectorAll('[data-page-number="2"] mark[data-pdf-find-match="0"]');
      expect(
        Array.from(marks)
          .map((mark) => mark.textContent)
          .join(""),
      ).toBe("A second termination right appears here.");
    });
    await user.click(within(panel).getByRole("button", { name: "R-45 description" }));
    expect(within(panel).queryByRole("button", { name: "Previous passage" })).toBeNull();
    expect(within(panel).queryByRole("button", { name: "Next passage" })).toBeNull();
    expect(panel.querySelectorAll("blockquote")).toHaveLength(11);
    expect(within(panel).getByText(quotes[0]!)).toBeVisible();
    expect(within(panel).getByText(quotes[10]!)).toBeVisible();
    await user.click(within(panel).getByRole("button", { name: "Agreement.pdf" }));
    expect(within(panel).getByText("Passage 1 of 2")).toBeVisible();
    expect(within(panel).getByRole("link", { name: "Download" })).toHaveAttribute(
      "href",
      attachment.attachment.downloadHref,
    );
  });
  it("shows the saved justification and opens a text source's relevant quotes on request", async () => {
    const user = userEvent.setup();
    const base = preparedApi();
    const source = {
      sourceId: "message:1",
      label: "Nadia Counsel — September 11",
      text: "First passage. Second passage. Further context.",
      quote: "First passage.",
    };
    open({
      ...base,
      handler: (call: StubCall) =>
        call.url.pathname.includes("/evidence/")
          ? json(200, {
              available: true,
              justification: "The request identifies this as a dispute requiring a response.",
              citations: [
                {
                  sourceId: "request:45:description",
                  label: "R-45 description",
                  text: "Full request description.",
                  quote: "Full request",
                },
                {
                  sourceId: "request:45:description",
                  label: "R-45 description",
                  text: "Full request description.",
                  quote: "description",
                },
                source,
                { ...source, quote: "Second passage." },
                source,
                {
                  ...source,
                  sourceId: "message:2",
                  text: "A different message.",
                  quote: "different",
                },
              ],
            })
          : base.handler(call),
    });
    await openDisposition(user, "Convert to matter");
    await screen.findByDisplayValue("Prepared response");
    await user.click(screen.getAllByRole("button", { name: "View source evidence" })[0]!);
    expect(
      await screen.findByText("The request identifies this as a dispute requiring a response."),
    ).toBeVisible();
    expect(screen.getByText("Why this value")).toBeVisible();
    // The popover is the explanation and a source list; no passage is
    // reproduced in it.
    expect(screen.getAllByRole("button", { name: "R-45 description" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: source.label })).toHaveLength(2);
    expect(screen.queryByText("Full request description.")).toBeNull();
    expect(screen.queryByText(source.text)).toBeNull();
    expect(document.querySelector("blockquote")).toBeNull();
    await user.click(screen.getByRole("button", { name: "R-45 description" }));
    const panel = await screen.findByRole("dialog", { name: "Title" });
    expect(within(panel).getByText("Full request", { selector: "blockquote" })).toBeVisible();
    expect(within(panel).getByText("description", { selector: "blockquote" })).toBeVisible();
    expect(within(panel).queryByText("Full request description.")).toBeNull();
    expect(within(panel).queryByText("First passage.")).toBeNull();
    await user.click(within(panel).getAllByRole("button", { name: source.label })[0]!);
    expect(within(panel).getAllByText("First passage.", { selector: "blockquote" })).toHaveLength(
      1,
    );
    expect(within(panel).getByText("Second passage.", { selector: "blockquote" })).toBeVisible();
  });
  it("keeps Convert in place when a citation becomes unavailable", async () => {
    const user = userEvent.setup();
    const base = preparedApi();
    const { router } = open({
      ...base,
      handler: (call: StubCall) =>
        call.url.pathname.includes("/evidence/")
          ? json(200, { available: false, citations: [] })
          : base.handler(call),
    });
    await openDisposition(user, "Convert to matter");
    await screen.findByDisplayValue("Prepared response");
    const convert = screen.getByRole("dialog");
    const trigger = within(convert).getAllByRole("button", { name: "View source evidence" })[0]!;
    await user.click(trigger);
    expect(await screen.findByText("The source is unavailable or has changed.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Close the document" })).toBeNull();
    expect(router.state.location.pathname).toBe("/inbox/45");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.getByRole("dialog")).toBe(convert);
  });
  it.each(["unreachable to the deadline", "failed", "ready at deadline", "unreachable once"])(
    "handles a mapped Office rendition that is %s without losing Convert",
    async (result) => {
      const user = userEvent.setup();
      const base = preparedApi();
      const href = "/api/v1/documents/promoted/versions/immutable/preview";
      const clock = vi.spyOn(Date, "now");
      let renditionReads = 0;
      try {
        const { router } = open({
          ...base,
          handler: (call: StubCall) => {
            if (call.url.pathname.endsWith("/rendition")) {
              renditionReads += 1;
              // A read nobody answers is worth waiting through. Two arms
              // run the clock past the panel's bound so they settle on the
              // first read; the last one answers on the retry the panel is
              // supposed to make.
              if (result === "ready at deadline" || result === "unreachable to the deadline")
                clock.mockReturnValue(Date.now() + 60_001);
              if (result === "unreachable to the deadline") return json(404, {});
              if (result === "unreachable once")
                return renditionReads === 1
                  ? json(404, {})
                  : json(200, { rendition: { state: "ready" } });
              return json(200, { rendition: { state: result === "failed" ? "failed" : "ready" } });
            }
            if (call.url.pathname.includes("/evidence/"))
              return json(200, {
                available: true,
                citations: [
                  {
                    sourceId: "attachment:word",
                    label: "Agreement.docx",
                    text: "Supporting agreement text",
                    quote: "Supporting agreement",
                    attachment: {
                      previewHref: href,
                      downloadHref: href.replace("preview", "download"),
                      documentId: "promoted",
                      versionId: "immutable",
                      method: "converted",
                    },
                  },
                ],
              });
            return base.handler(call);
          },
        });
        await openDisposition(user, "Convert to matter");
        await screen.findByDisplayValue("Prepared response");
        const convert = screen.getByRole("dialog");
        convert.scrollTop = 165;
        const trigger = within(convert).getAllByRole("button", {
          name: "View source evidence",
        })[0]!;
        await user.click(trigger);
        const panel = await screen.findByRole("dialog", { name: "Title" });
        if (result === "ready at deadline" || result === "unreachable once") {
          expect(
            await within(panel).findByRole(
              "region",
              { name: "Agreement.docx, pages" },
              { timeout: 6000 },
            ),
          ).toBeVisible();
          expect(renditionReads).toBe(result === "unreachable once" ? 2 : 1);
        } else {
          expect(
            await within(panel).findByText(
              "This source has no searchable passage preview. Read the source text and check the original file.",
            ),
          ).toBeVisible();
          expect(within(panel).getByText("Supporting agreement text")).toBeVisible();
        }
        expect(within(panel).getByRole("link", { name: "Download" })).toHaveAttribute(
          "href",
          href.replace("preview", "download"),
        );
        expect(router.state.location.pathname).toBe("/inbox/45");
        await user.keyboard("{Escape}");
        await waitFor(() => expect(trigger).toHaveFocus());
        expect(screen.getByRole("dialog")).toBe(convert);
        expect(convert.scrollTop).toBe(165);
      } finally {
        clock.mockRestore();
      }
    },
  );
  it("reports genuine failures and historical truncation without implementation-limit boilerplate", async () => {
    const user = userEvent.setup();
    open(preparedApi(false, false, true));
    await openDisposition(user, "Convert to matter");
    await screen.findByDisplayValue("Prepared response");
    expect(
      screen.getByText(
        "Some attachments could not be fully read. Review the source statuses and original files before converting.",
      ),
    ).toBeVisible();
    await user.click(screen.getByText("Attachment reading details"));
    expect(screen.getByText("Costs.xlsx: unsupported")).toBeVisible();
    expect(screen.getByText(/Long agreement.pdf: truncated.*text limit/)).toBeVisible();
    // A file that was read in full is not a detail anyone acts on.
    expect(screen.queryByText(/Signed NDA.pdf/)).toBeNull();
    expect(screen.queryByText(/Up to 20 attachments, 10 MiB each/)).toBeNull();
  });
  it("says nothing about attachment reading when every file was read in full", async () => {
    const user = userEvent.setup();
    open(preparedApi(false, false, "readable"));
    await openDisposition(user, "Convert to matter");
    await screen.findByDisplayValue("Prepared response");
    expect(screen.queryByText("Attachment reading details")).toBeNull();
    expect(screen.queryByText(/Signed NDA.pdf/)).toBeNull();
  });
  it("drops Matter suggestions for disabled Contract preparation and prepares on return", async () => {
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
    expect(await within(dialog).findByDisplayValue("Prepared response")).toBeVisible();
    expect(within(dialog).getAllByText("Unverified")).toHaveLength(3);
  });
  it.each(["Discard AI suggestions", "Convert to contract instead"])(
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
  it.each(["Discard AI suggestions", "Convert to contract instead"])(
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
          name: action === "Discard AI suggestions" ? "Convert to matter" : "Convert to contract",
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
      if (action === "Discard AI suggestions")
        expect(api.conversions[0]).toHaveProperty("description", "Human description");
    },
  );
  it("opens an already prepared draft without waiting for another read", async () => {
    const user = userEvent.setup();
    const base = preparedApi();
    let reads = 0;
    open({
      ...base,
      handler: (call: StubCall) => {
        if (call.url.pathname.endsWith("/conversion-drafts/draft-1")) {
          reads++;
          return new Promise<Response>(() => {});
        }
        return base.handler(call);
      },
    });
    await openDisposition(user, "Convert to matter");
    expect(await screen.findByRole("textbox", { name: /Title/ })).toHaveValue("Prepared response");
    expect(reads).toBe(0);
  });

  it("keeps waiting beyond three minutes while the worker renews its lease", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const base = preparedApi(true);
      open({
        ...base,
        handler: (call: StubCall) => {
          const response = base.handler(call);
          if (
            call.url.pathname.includes("/conversion-drafts") &&
            !call.url.pathname.endsWith("/settings")
          ) {
            return Promise.resolve(response).then(async (response) => {
              const body = await response!.json();
              body.draft.progressAt = new Date(Date.now()).toISOString();
              return json(response!.status, body);
            });
          }
          return response;
        },
      });
      await openDisposition(user, "Convert to matter");
      expect(await screen.findByText("Getting matter ready…")).toBeVisible();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(240_000);
      });
      expect(screen.getByText("Getting matter ready…")).toBeVisible();
      expect(screen.getByText(/Working for 4 minutes 0 seconds\./)).toBeVisible();
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
      await user.click(screen.getByRole("button", { name: "Continue manually" }));
      expect(screen.getByRole("textbox", { name: /Title/ })).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["create", "poll"])(
    "bounds a stalled %s request and ignores its late result",
    async (stage) => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        const base = preparedApi(true);
        let release: (() => void) | undefined;
        open({
          ...base,
          handler: (call: StubCall) => {
            const held =
              stage === "create"
                ? call.url.pathname.endsWith("/conversion-drafts")
                : call.url.pathname.endsWith("/conversion-drafts/draft-1");
            if (held)
              return new Promise<Response>((resolve) => {
                release = () => resolve(preparedApi().handler(call) as Response);
              });
            return base.handler(call);
          },
        });
        await openDisposition(user, "Convert to matter");
        await waitFor(() => expect(release).toBeDefined());
        expect(screen.getByText("Getting matter ready…")).toBeVisible();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(180_001);
        });
        expect(
          screen.getByText("Preparation could not finish. Retry or continue manually."),
        ).toBeVisible();
        expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
        await user.click(screen.getByRole("button", { name: "Continue manually" }));
        const title = screen.getByRole("textbox", { name: /Title/ });
        await user.clear(title);
        await user.type(title, "My preserved title");
        await act(async () => {
          release?.();
        });
        expect(title).toHaveValue("My preserved title");
        expect(screen.queryByText("Unverified")).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("keeps manual continuation usable while preparation waits", async () => {
    const user = userEvent.setup();
    const api = preparedApi(true);
    open(api);
    await openDisposition(user, "Convert to matter");
    expect(await screen.findByText("Getting matter ready…")).toBeVisible();
    expect(
      screen.getByText(/A long attachment can take a few minutes\. Working for 0 seconds\./),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Continue manually" }));
    const title = screen.getByLabelText("Title", { exact: false });
    await user.clear(title);
    await user.type(title, "My manual title");
    expect(screen.queryByText("Unverified")).not.toBeInTheDocument();
    expect(title).toHaveValue("My manual title");
  });
});

describe("Contract and Matter preparation together", () => {
  function bothApi(suggestType = false, refuseCall = 0, row = request()) {
    const calls: { targetModule: "matter" | "contract"; targetTypeId: string; retry?: boolean }[] =
      [];
    const drafts = new Map<string, unknown>();
    let held: (() => void) | undefined;
    const base = requestApi(row);
    const api = {
      ...base,
      calls,
      release: () => held?.(),
      handler: (call: StubCall) => {
        if (call.url.pathname === "/api/v1/conversion-drafts/settings")
          return json(200, { matterPreparation: true, contractPreparation: true });
        if (call.url.pathname.endsWith("/conversion-drafts")) {
          const target = call.body as (typeof calls)[number];
          calls.push(target);
          if (calls.length === refuseCall) return problem(503, "Preparation is busy.");
          const id = `both-${calls.length}`;
          const proposal = (value: unknown) => ({
            value,
            citations: [{ sourceId: "message:1", revision: "v1", quote: "Supported" }],
          });
          const draft = {
            id,
            ...target,
            state: "ready",
            suggestions: {
              title: proposal(`${target.targetModule} title ${calls.length}`),
              ...(suggestType && calls.length === 1 ? { contract_type: proposal("ct-msa") } : {}),
              description: proposal(`${target.targetModule} description`),
              priority: proposal("critical"),
              needed_by: proposal("2026-10-02"),
              ...(target.targetModule === "contract" ? { counterparty: proposal("Acme") } : {}),
              ...(target.targetTypeId === "ct-msa"
                ? { "field:governing_law": proposal("England") }
                : {}),
            },
            conflicts: {},
            warnings: [],
            attachmentReads: [],
            failure: null,
          };
          drafts.set(id, draft);
          if (target.targetModule === "matter")
            return new Promise<Response>((resolve) => {
              held = () => resolve(json(202, { draft }));
            });
          return json(202, { draft });
        }
        const id = call.url.pathname.split("/conversion-drafts/")[1];
        if (id && drafts.has(id)) return json(200, { draft: drafts.get(id) });
        return base.handler(call);
      },
    };
    return api;
  }
  it("keeps identical intake answers ordinary and omits them from accepted AI values", async () => {
    const user = userEvent.setup();
    const api = bothApi(
      false,
      0,
      request({
        urgency: "critical",
        customFields: { counterparty_name: "Acme", needed_by: "2026-10-02" },
      }),
    );
    open(api);
    await openDisposition(user, "Convert to contract");
    await screen.findByDisplayValue("contract title 1");
    for (const name of [/^Counterparty$/, /^Needed by/, /^Priority/]) {
      const control = screen.getByLabelText(name);
      expect(
        within(control.parentElement!.parentElement!).queryByRole("button", {
          name: "View source evidence",
        }),
      ).toBeNull();
    }
    expect(screen.getAllByRole("button", { name: "View source evidence" }).length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByText("Who in the business owns this deal.")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Convert to contract" }));
    await waitFor(() => expect(api.conversions).toHaveLength(1));
    expect(api.conversions[0]).toMatchObject({
      counterpartyName: "Acme",
      neededBy: "2026-10-02",
      priority: "critical",
    });
    expect((api.conversions[0] as { aiAccepted: string[] }).aiAccepted).not.toEqual(
      expect.arrayContaining(["counterparty"]),
    );
    expect((api.conversions[0] as { aiAccepted: string[] }).aiAccepted).not.toContain("needed_by");
    expect((api.conversions[0] as { aiAccepted: string[] }).aiAccepted).not.toContain("priority");
  });

  it("bounds a stalled Type refresh and preserves edits when it finally responds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const base = bothApi();
      let release: (() => void) | undefined;
      open({
        ...base,
        handler: (call: StubCall) => {
          if (
            call.url.pathname.endsWith("/conversion-drafts") &&
            (call.body as { targetTypeId: string }).targetTypeId === "ct-msa"
          ) {
            return new Promise<Response>((resolve) => {
              release = () => resolve(base.handler(call) as Response);
            });
          }
          return base.handler(call);
        },
      });
      await openDisposition(user, "Convert to contract");
      const title = await screen.findByDisplayValue("contract title 1");
      await user.clear(title);
      await user.type(title, "Human title");
      await user.selectOptions(screen.getByLabelText(/^Contract type/), "ct-msa");
      await waitFor(() => expect(release).toBeDefined());
      expect(screen.getByRole("button", { name: "Convert to contract" })).toBeDisabled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(180_001);
      });
      expect(
        screen.getByText("Preparation could not finish. Retry or continue manually."),
      ).toBeVisible();
      expect(screen.getByRole("button", { name: "Convert to contract" })).toBeEnabled();
      await act(async () => {
        release?.();
      });
      expect(title).toHaveValue("Human title");
      expect(
        screen.getByText("Preparation could not finish. Retry or continue manually."),
      ).toBeVisible();
      expect(screen.getByRole("button", { name: "Convert to contract" })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([1, 2])(
    "retries a refused preparation on call %s and preserves human values",
    async (refuseCall) => {
      const user = userEvent.setup();
      const api = bothApi(false, refuseCall);
      open(api);
      await openDisposition(user, "Convert to contract");
      if (refuseCall === 2) {
        const title = await screen.findByDisplayValue("contract title 1");
        await user.clear(title);
        await user.type(title, "Human title");
        await user.clear(within(screen.getByRole("dialog")).getByLabelText("Description"));
        await user.clear(within(screen.getByRole("dialog")).getByLabelText(/^Needed by/));
        await user.selectOptions(
          within(screen.getByRole("dialog")).getByLabelText(/^Contract type/),
          "ct-msa",
        );
      }
      expect(
        await screen.findByText("Preparation could not finish. Retry or continue manually."),
      ).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Retry" }));
      await waitFor(() => expect(api.calls).toHaveLength(refuseCall + 1));
      expect(api.calls.at(-1)).toMatchObject({ targetModule: "contract", retry: true });
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Convert to contract" })).toBeEnabled(),
      );
      expect(
        screen.queryByText("Preparation could not finish. Retry or continue manually."),
      ).toBeNull();
      if (refuseCall === 2) {
        expect(within(screen.getByRole("dialog")).getByLabelText(/^Title/)).toHaveValue(
          "Human title",
        );
        expect(within(screen.getByRole("dialog")).getByLabelText("Description")).toHaveValue("");
        expect(within(screen.getByRole("dialog")).getByLabelText(/^Needed by/)).toHaveValue("");
        expect(within(screen.getByRole("dialog")).getByLabelText(/^Governing law/)).toHaveValue(
          "England",
        );
      } else
        expect(within(screen.getByRole("dialog")).getByLabelText(/^Title/)).toHaveValue(
          "contract title 2",
        );
    },
  );
  it.each([false, true])(
    "uses the Request Type as a fallback, not an initial constraint, with suggestion %s",
    async (suggestType) => {
      const user = userEvent.setup();
      const api = bothApi(suggestType);
      open(api);
      await openDisposition(user, "Convert to contract");
      await screen.findByDisplayValue("contract title 1");
      expect(api.calls[0]).toMatchObject({ targetModule: "contract", targetTypeId: "" });
      expect(screen.getByLabelText(/^Contract type/)).toHaveValue(
        suggestType ? "ct-msa" : "ct-nda",
      );
      await user.selectOptions(screen.getByLabelText(/^Contract type/), "ct-sow");
      await waitFor(() =>
        expect(api.calls[1]).toMatchObject({ targetModule: "contract", targetTypeId: "ct-sow" }),
      );
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Convert to contract" })).toBeEnabled(),
      );
      expect(screen.getByLabelText(/^Contract type/)).toHaveValue("ct-sow");
    },
  );
  it("prepares Contract controls, preserves edits through Type and Re-target changes, and ignores a late Matter reply", async () => {
    const user = userEvent.setup();
    const api = bothApi();
    open(api);
    await openDisposition(user, "Convert to contract");
    const title = await screen.findByDisplayValue("contract title 1");
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText(/^Counterparty/)).toHaveValue("Acme");
    expect(within(dialog).queryByLabelText("Matter template")).toBeNull();
    await user.clear(title);
    await user.type(title, "Human title");
    await user.clear(within(dialog).getByLabelText("Description"));
    await user.clear(within(dialog).getByLabelText(/^Needed by/));
    await user.selectOptions(within(dialog).getByLabelText(/^Contract type/), "ct-msa");
    expect(await within(dialog).findByDisplayValue("England")).toBeVisible();
    await user.clear(within(dialog).getByLabelText(/^Governing law/));
    await user.type(within(dialog).getByLabelText(/^Governing law/), "France");
    await user.click(within(dialog).getByRole("button", { name: "Convert to matter instead" }));
    expect(await within(dialog).findByText("Getting matter ready…")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Convert to contract instead" }));
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Convert to contract" })).toBeEnabled(),
    );
    api.release();
    expect(within(dialog).getByLabelText(/^Title/)).toHaveValue("Human title");
    expect(within(dialog).getByLabelText("Description")).toHaveValue("");
    expect(within(dialog).getByLabelText(/^Needed by/)).toHaveValue("");
    expect(within(dialog).getByLabelText(/^Governing law/)).toHaveValue("France");
    expect(within(dialog).queryByText("Getting matter ready…")).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Convert to contract" }));
    await waitFor(() => expect(api.conversions).toHaveLength(1));
    expect(api.conversions[0]).toMatchObject({
      title: "Human title",
      description: null,
      contractTypeId: "ct-msa",
      customFields: { governing_law: "France" },
      counterpartyName: "Acme",
      aiAccepted: ["priority", "counterparty"],
    });
    expect(api.conversions[0]).not.toHaveProperty("neededBy");
    expect(api.conversions[0]).not.toHaveProperty("templateId");
  });
});
