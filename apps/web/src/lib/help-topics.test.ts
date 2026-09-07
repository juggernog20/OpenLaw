// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { helpHref, topicsForRoute } from "./help-topics";
import bindings from "../../../../docs/documentation/help-contexts.json";
import type { HelpMetadata } from "../../../../scripts/documentation/reader.mjs";

const metadata: HelpMetadata = {
  contexts: [...new Set(bindings.bindings.flatMap((b) => b.contexts))],
  bindings: bindings.bindings as HelpMetadata["bindings"],
  articles: [],
};
describe("Help topics", () => {
  it("combines specific bindings before shared fallbacks without retaining record identifiers", () => {
    const topics = topicsForRoute(metadata, "/contracts/314/documents", "staff");
    expect(topics).toContain("contracts.overview");
    expect(topics).toContain("documents.versions");
    expect(topics).toContain("comments");
    expect(topics.indexOf("contracts.overview")).toBeLessThan(topics.indexOf("support"));
    expect(topics).toEqual([...new Set(topics)]);
    expect(JSON.stringify(topics)).not.toContain("314");
    expect(topicsForRoute(metadata, "/contracts/314", "staff")).toEqual(topics);
  });
  it("matches the full route and the correct shell", () => {
    expect(topicsForRoute(metadata, "/contracts/314/overview/unknown", "staff")).toEqual([
      "notifications",
      "errors",
      "reference",
      "support",
    ]);
    expect(topicsForRoute(metadata, "/portal/new/fictional", "portal")[0]).toBe("portal.form");
    expect(topicsForRoute(metadata, "/settings/ai-analysis", "portal")).not.toContain(
      "settings.analysis",
    );
    expect(topicsForRoute(metadata, "/auth/setup", "formal")).toEqual(["setup", "welcome"]);
  });
  it("filters discovery by destination and audience and falls back to the index", () => {
    const help = {
      ...metadata,
      articles: [
        {
          audiences: ["administrator"],
          destinations: ["staff-help"],
          contexts: ["contracts.overview"],
        },
        {
          audiences: ["contributor"],
          destinations: ["staff-help"],
          contexts: ["documents.versions", "support"],
        },
      ],
    } as HelpMetadata;
    const href = helpHref(help, "/contracts/314", "staff", "contributor");
    expect(href).toBe("/help?topic=documents.versions&topic=support");
    expect(helpHref(help, "/contracts/314", "staff", "legal_team_member")).toBe("/help");
    expect(helpHref(help, "/portal/help", "portal", "business_user")).toBe("/portal/help");
  });
});
