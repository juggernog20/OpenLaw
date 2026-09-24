// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { renderBriefingMail, type BriefingMail } from "./briefing-template.js";

const FULL_BRIEFING: BriefingMail = {
  recipientName: "Casey Counsel",
  localDate: "2026-09-01",
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
        isDone: false,
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
        title: "Review distributor redline",
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
  it("preserves the authored text part, including overflow", () => {
    const message = renderBriefingMail(
      { ...FULL_BRIEFING, tasks: { ...FULL_BRIEFING.tasks!, total: 5 } },
      "casey@example.com",
      "https://openlaw.test",
    );
    expect(message!.text).toMatchInlineSnapshot(`
      "Hello Casey Counsel,

      Here is your daily briefing.

      Approvals

      Northwind supply terms (#1041) — requested by Nadia Counsel on Aug 31, 2026
      https://openlaw.test/contracts/1041/approvals

      Tasks

      Prepare signature pack — Atlas acquisition (M-1017) — due Sep 1, 2026
      https://openlaw.test/matters/1017/tasks

      And 4 more on Home.
      https://openlaw.test/

      Dates

      In 7 days (Sep 8, 2026) unverified — Notice deadline: Northwind supply terms (#41)
      https://openlaw.test/contracts/41/key-dates

      Obligations

      Tomorrow (Sep 2, 2026) — Annual return: OpenLaw Holdings Ltd
      https://openlaw.test/entities/entity-1/obligations

      Knowledge

      Contract review playbook
      https://openlaw.test/knowledge/knowledge-1

      Intake

      R-1029 Review distributor redline — Contract review, high
      https://openlaw.test/inbox/1029

      Change what reaches you in your notification settings:
      https://openlaw.test/settings/notifications"
    `);
  });

  it("renders both parts in NOT-008's stable section order", () => {
    const message = renderBriefingMail(FULL_BRIEFING, "casey@example.com", "https://openlaw.test");
    expect(message).not.toBeNull();

    const headings = ["Approvals", "Tasks", "Dates", "Obligations", "Knowledge", "Intake"];
    for (const part of [message!.text, message!.html!]) {
      let previous = -1;
      for (const heading of headings) {
        const index = part.indexOf(part === message!.html ? `${heading} <span` : heading);
        expect(index, `${heading} in ${part}`).toBeGreaterThan(previous);
        previous = index;
      }
    }
    expect(message!.text).toContain("Sep 1, 2026");
    expect(message!.text).toContain("In 7 days (Sep 8, 2026) unverified — Notice deadline");
    expect(message!.html).toMatch(/width="100"[^>]*>In 7 days<br>Sep 8, 2026/);
    expect(message!.html).toContain("Notice deadline · unverified");
    expect(message!.html).toMatch(/width="100"[^>]*>Tomorrow<br>Sep 2, 2026/);
    expect(message!.text).not.toContain("Tomorrow (Sep 2, 2026) unverified");
    expect(message!.html).not.toContain("Tomorrow (Sep 2, 2026) unverified");
    expect(message!.html).toContain("/contracts/1041/approvals");
    expect(message!.text).toContain("/matters/1017/tasks");
    expect(message!.html).toContain("/inbox/1029");
    expect(message!.text).not.toMatch(/(?:#|M-|R-)1,0/);
    expect(message!.subject).toBe("Your daily briefing");
  });

  it("uses the shared layout with six tiles in two rows and structured row facts", () => {
    const message = renderBriefingMail(FULL_BRIEFING, "casey@example.com", "https://openlaw.test");
    const html = message!.html!;
    expect(html).toMatch(/Daily briefing <span[^>]*>· Sep 1, 2026<\/span>/);
    const tileRows = html.match(
      /<tr><td width="33%"[\s\S]*?<\/p><\/td><\/tr><\/table><\/td><\/tr>/g,
    )!;
    expect(tileRows).toHaveLength(2);
    for (const row of tileRows) expect(row.match(/width="33%"/g)).toHaveLength(3);
    for (const heading of ["Approvals", "Tasks", "Dates", "Obligations", "Knowledge", "Intake"]) {
      expect(html).toMatch(new RegExp(`${heading} <span[^>]*>1</span>`));
    }
    expect(html).toMatch(
      /color:#1f2328;text-decoration:none;font-weight:600;">Prepare signature pack/,
    );
    expect(html).toMatch(/font-family:[^";]*monospace;[^">]*white-space:nowrap;">M-1017/);
    expect(html).toContain("Requested by Nadia Counsel on Aug 31, 2026");
    expect(html).toContain("Atlas acquisition");
    expect(html).toMatch(/align="right"[^>]*color:#9a6700;">[\s\S]*?Due Sep 1, 2026/);
    expect(html).toMatch(/align="right"[^>]*color:#bc4c00;">[\s\S]*?High/);
    expect(html).toContain("Contract review");
    expect(html).toContain("Published Sep 1, 2026");
    expect(html).toContain('src="cid:openlaw-mark@openlaw"');
    expect(message!.attachments).toEqual([
      expect.objectContaining({ cid: "openlaw-mark@openlaw", contentType: "image/png" }),
    ]);
    expect(html).not.toMatch(/<script|data:|calc\(/);
  });

  it("omits tiles for a dates-only Portal briefing and keeps its destinations", () => {
    const message = renderBriefingMail(
      {
        ...FULL_BRIEFING,
        surface: "portal",
        approvals: null,
        tasks: null,
        intake: null,
        knowledgeItems: [],
        rows: [FULL_BRIEFING.rows[0]!],
      },
      "casey@example.com",
      "https://openlaw.test",
    );
    expect(message!.html).not.toContain('width="33%"');
    expect(message!.html).toContain("Legal portal");
    expect(message!.html).toContain('href="https://openlaw.test/portal/contracts/41"');
    expect(message!.html).toContain('href="https://openlaw.test/portal/settings"');
    expect(message!.text).toContain("https://openlaw.test/portal/settings");
  });

  it("escapes row titles and metadata", () => {
    const message = renderBriefingMail(
      {
        ...FULL_BRIEFING,
        rows: [
          {
            ...FULL_BRIEFING.rows[0]!,
            recordTitle: '<script>alert("date")</script>',
            label: "A & B",
          },
        ],
        knowledgeItems: [{ ...FULL_BRIEFING.knowledgeItems[0]!, title: '<img src="x">' }],
      },
      "casey@example.com",
      "https://openlaw.test",
    );
    expect(message!.html).toContain("&lt;script&gt;");
    expect(message!.html).toContain("A &amp; B");
    expect(message!.html).toContain("&lt;img src=&quot;x&quot;&gt;");
    expect(message!.html).not.toContain("<script>");
  });

  it("names the one section a single-section briefing holds in its subject", () => {
    const base = {
      recipientName: FULL_BRIEFING.recipientName,
      localDate: FULL_BRIEFING.localDate,
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

  it.each(["approvals", "tasks", "intake"] as const)(
    "names the rows the %s preview cap kept out",
    (section) => {
      const message = renderBriefingMail(
        { ...FULL_BRIEFING, [section]: { ...FULL_BRIEFING[section]!, total: 5 } },
        "casey@example.com",
        "https://openlaw.test",
      );
      expect(message!.text).toContain("And 4 more on Home.\nhttps://openlaw.test/");
      expect(message!.html).toMatch(/href="https:\/\/openlaw.test\/"[^>]*>View all 5 &rarr;/);
      expect(message!.html).not.toContain("more on Home");
      expect(message!.html!.match(/View all/g)).toHaveLength(1);
      expect(message!.html).toMatch(/font-size:20px;font-weight:600;">5<\/p>/);
      expect(message!.html).toMatch(
        new RegExp(`${section[0]!.toUpperCase()}${section.slice(1)} <span[^>]*>5</span>`),
      );
      // The sections whose total is what they show name no remainder.
      expect(message!.text).not.toContain("And 0 more");
      expect(message!.text.match(/more on Home/g)).toHaveLength(1);
    },
  );

  it("omits empty sections and refuses a fully empty briefing", () => {
    const tasksOnly = renderBriefingMail(
      {
        recipientName: FULL_BRIEFING.recipientName,
        localDate: FULL_BRIEFING.localDate,
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
    expect(tasksOnly?.html).not.toContain(">Knowledge");
    expect(tasksOnly?.html).not.toContain('width="33%"');

    expect(
      renderBriefingMail(
        {
          recipientName: FULL_BRIEFING.recipientName,
          localDate: FULL_BRIEFING.localDate,
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
