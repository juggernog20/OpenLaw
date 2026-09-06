// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { renderBriefingMail, type BriefingMail } from "./briefing-template.js";

const FULL_BRIEFING: BriefingMail = {
  recipientName: "Casey Counsel",
  approvals: {
    type: "approvals",
    total: 1,
    rows: [
      {
        id: "approval-1",
        contract: {
          id: "contract-1",
          number: 1041,
          title: "Northwind supply terms",
          isConfidential: false,
        },
        requestedBy: { id: "requester-1", displayName: "Nadia Counsel" },
        requestedAt: "2026-08-31T09:00:00.000Z",
      },
    ],
  },
  tasks: {
    type: "tasks",
    total: 1,
    rows: [
      {
        id: "task-1",
        title: "Prepare signature pack",
        dueDate: "2026-09-01",
        isOverdue: false,
        record: {
          kind: "matter",
          id: "matter-1",
          number: 1017,
          title: "Atlas acquisition",
          isConfidential: false,
        },
      },
    ],
  },
  rows: [
    {
      eventType: "date.notice_deadline_approaching",
      entityType: "contract",
      recordNumber: 41,
      recordTitle: "Northwind supply terms",
      date: "2026-09-08",
      daysAway: 7,
      label: null,
      unverified: true,
    },
    {
      eventType: "date.obligation_approaching",
      entityType: "entity",
      recordId: "entity-1",
      recordTitle: "OpenLaw Holdings Ltd",
      date: "2026-09-02",
      daysAway: 1,
      label: "Annual return",
      unverified: false,
    },
  ],
  knowledgeItems: [
    {
      id: "knowledge-1",
      title: "Contract review playbook",
      publishedAt: new Date("2026-09-01T07:00:00.000Z"),
    },
  ],
  intake: {
    type: "inbox",
    total: 1,
    rows: [
      {
        id: "request-1",
        number: 1029,
        summary: "Review distributor redline",
        urgency: "high",
        requestType: { id: "request-type-1", displayName: "Contract review" },
        requester: { id: "requester-2", displayName: "Priya Raman" },
        createdAt: "2026-09-01T06:00:00.000Z",
      },
    ],
  },
  readerTimeZone: null,
};

describe("the full daily briefing template", () => {
  it("renders both parts in NOT-008's stable section order", () => {
    const message = renderBriefingMail(FULL_BRIEFING, "casey@example.com", "https://openlaw.test");
    expect(message).not.toBeNull();

    const headings = ["Approvals", "Tasks", "Dates", "Obligations", "Knowledge", "Intake"];
    for (const part of [message!.text, message!.html!]) {
      let previous = -1;
      for (const heading of headings) {
        const index = part.indexOf(heading);
        expect(index, `${heading} in ${part}`).toBeGreaterThan(previous);
        previous = index;
      }
    }
    expect(message!.text).toContain("Sep 1, 2026");
    expect(message!.text).toContain("In 7 days (Sep 8, 2026) unverified — Notice deadline");
    expect(message!.html).toContain("In 7 days (Sep 8, 2026) unverified — Notice deadline");
    expect(message!.text).not.toContain("Tomorrow (Sep 2, 2026) unverified");
    expect(message!.html).not.toContain("Tomorrow (Sep 2, 2026) unverified");
    expect(message!.html).toContain("/contracts/1041/approvals");
    expect(message!.text).toContain("/matters/1017/tasks");
    expect(message!.html).toContain("/inbox/1029");
    expect(message!.text).not.toMatch(/(?:#|M-|R-)1,0/);
    expect(message!.subject).toBe("Your daily briefing");
  });

  it("names the one section a single-section briefing holds in its subject", () => {
    const base = {
      recipientName: FULL_BRIEFING.recipientName,
      approvals: null,
      tasks: null,
      intake: null,
      readerTimeZone: null,
    };
    const datesOnly = renderBriefingMail(
      { ...base, rows: FULL_BRIEFING.rows, knowledgeItems: [] },
      "casey@example.com",
      "https://openlaw.test",
    );
    expect(datesOnly!.subject).toBe("2 dates on your records");

    const knowledgeOnly = renderBriefingMail(
      { ...base, rows: [], knowledgeItems: FULL_BRIEFING.knowledgeItems },
      "casey@example.com",
      "https://openlaw.test",
    );
    expect(knowledgeOnly!.subject).toBe("1 new Knowledge item");
  });

  it("places an approval's instant on the reader's own calendar", () => {
    // 2026-08-31T09:00Z is still Aug 30 in Honolulu (UTC-10). The date
    // rows are civil dates and must not shift; only the instant does.
    const message = renderBriefingMail(
      { ...FULL_BRIEFING, readerTimeZone: "Pacific/Honolulu" },
      "casey@example.com",
      "https://openlaw.test",
    );
    expect(message!.text).toContain("requested by Nadia Counsel on Aug 30, 2026");
    expect(message!.text).toContain("Sep 8, 2026");
  });

  it("names the rows a section's preview cap kept out", () => {
    const message = renderBriefingMail(
      { ...FULL_BRIEFING, tasks: { ...FULL_BRIEFING.tasks!, total: 5 } },
      "casey@example.com",
      "https://openlaw.test",
    );
    expect(message!.text).toContain("And 4 more on Home.\nhttps://openlaw.test/");
    expect(message!.html).toContain("And 4 more on Home.");
    // The sections whose total is what they show name no remainder.
    expect(message!.text).not.toContain("And 0 more");
    expect(message!.text.match(/more on Home/g)).toHaveLength(1);
  });

  it("omits empty sections and refuses a fully empty briefing", () => {
    const tasksOnly = renderBriefingMail(
      {
        recipientName: FULL_BRIEFING.recipientName,
        approvals: null,
        tasks: FULL_BRIEFING.tasks,
        rows: [],
        knowledgeItems: [],
        intake: null,
        readerTimeZone: null,
      },
      "casey@example.com",
      "https://openlaw.test",
    );
    expect(tasksOnly?.text).toContain("Tasks");
    expect(tasksOnly?.text).not.toContain("Approvals\n");
    expect(tasksOnly?.html).not.toContain("<h2>Knowledge</h2>");

    expect(
      renderBriefingMail(
        {
          recipientName: FULL_BRIEFING.recipientName,
          approvals: null,
          tasks: null,
          rows: [],
          knowledgeItems: [],
          intake: null,
          readerTimeZone: null,
        },
        "casey@example.com",
        "https://openlaw.test",
      ),
    ).toBeNull();
  });
});
