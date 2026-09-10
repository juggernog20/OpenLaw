// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntlProvider } from "react-intl";
import { json, stubApi } from "../../testing/helpers";
import type { EntityChart } from "../../lib/entities";
import { EntityChartExport } from "./entity-chart-export-dialog";
import { createChartPdf, createChartPowerPoint, downloadChart } from "./entity-chart-export-files";

vi.mock("./entity-chart-export-files", () => ({
  loadExportMeasure: vi.fn(async () => (text: string, size: number) => text.length * size * 0.6),
  createChartPdf: vi.fn(async () => new Blob(["pdf"], { type: "application/pdf" })),
  createChartPowerPoint: vi.fn(async () => new Blob(["pptx"])),
  downloadChart: vi.fn(),
}));
const node = (id: string) => ({
  id,
  legalName: id,
  restricted: false as const,
  type: "LLC",
  jurisdiction: "Kenya",
  status: "active" as const,
  primaryOwnerId: null,
});
const chart: EntityChart = {
  nodes: [
    node("Parent"),
    { ...node("Child"), primaryOwnerId: "Parent" },
    node("Other"),
    { id: "secret", restricted: true, primaryOwnerId: "Child" },
  ],
  edges: [
    { ownerEntityId: "Parent", ownedEntityId: "Child", ownershipPercent: 100 },
    { ownerEntityId: "Child", ownedEntityId: "secret", ownershipPercent: 100 },
  ],
};
function details(id: string) {
  return {
    entity: {
      id,
      legalName: id,
      entityTypeName: "LLC",
      jurisdiction: "Kenya",
      status: "active",
      customFields: {},
      taxId: "TAX-123",
    },
    fields: [],
    customFieldRefs: { users: [], entities: [] },
  };
}
function mount() {
  render(
    <IntlProvider locale="en-US" messages={{}}>
      <EntityChartExport chart={chart} selectedId="Child" />
    </IntlProvider>,
  );
}
beforeEach(() => vi.clearAllMocks());

describe("chart export dialog", () => {
  it("exports the selected chain as PowerPoint with directors and officers and the chosen fields", async () => {
    const reads: string[] = [];
    stubApi({
      extra: (call) => {
        reads.push(call.url.pathname);
        if (call.url.pathname.endsWith("/officers"))
          return json(200, {
            officers: [{ name: "Dana Director", officerRoleName: "Director", resignedOn: null }],
          });
        return json(200, details(call.url.pathname.split("/").at(-1)!));
      },
    });
    mount();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Export chart" }));
    await screen.findByRole("img", { name: "Export preview" });
    expect(screen.getByRole("combobox", { name: "Structure to export" })).toHaveValue("Child");
    await user.click(screen.getByRole("checkbox", { name: "Jurisdiction" }));
    await user.click(screen.getByRole("checkbox", { name: "Directors & Officers" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "File format" }), "pptx");
    await user.click(screen.getByRole("button", { name: "Download chart" }));
    await waitFor(() => expect(createChartPowerPoint).toHaveBeenCalledOnce());
    const model = vi.mocked(createChartPowerPoint).mock.calls[0]![0];
    expect(model.cards.map((card) => card.id).sort()).toEqual(["Child", "Parent", "secret"]);
    const text = model.texts.map((line) => line.text).join(" ");
    expect(text).toContain("Dana Director (Director)");
    expect(text).not.toContain("Jurisdiction");
    expect(text).not.toContain("TAX-123");
    expect(text).toContain("Confidential Entity");
    expect(reads.some((path) => path.includes("secret"))).toBe(false);
    expect(downloadChart).toHaveBeenCalledWith(expect.any(Blob), "Entity structure chart", "pptx");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("blocks exports when a readable record becomes inaccessible and supports retry", async () => {
    let denied = true;
    stubApi({
      extra: (call) => {
        if (denied) return json(404, { detail: "Not found" });
        if (call.url.pathname.endsWith("/officers")) return json(200, { officers: [] });
        return json(200, details(call.url.pathname.split("/").at(-1)!));
      },
    });
    mount();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Export chart" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Entity details could not be loaded",
    );
    expect(screen.getByRole("button", { name: "Download chart" })).toBeDisabled();
    expect(createChartPdf).not.toHaveBeenCalled();
    denied = false;
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("img", { name: "Export preview" });
    expect(screen.getByRole("button", { name: "Download chart" })).toBeEnabled();
  });

  it("keeps choices available after a failed file generation and retries the PDF", async () => {
    stubApi({
      extra: (call) =>
        call.url.pathname.endsWith("/officers")
          ? json(200, { officers: [] })
          : json(200, details(call.url.pathname.split("/").at(-1)!)),
    });
    vi.mocked(createChartPdf).mockRejectedValueOnce(new Error("Generation failed"));
    mount();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Export chart" }));
    await screen.findByRole("img", { name: "Export preview" });
    const dialog = within(screen.getByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: "Download chart" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("The chart could not be exported");
    expect(dialog.getByRole("combobox", { name: "Structure to export" })).toHaveValue("Child");
    await user.click(dialog.getByRole("button", { name: "Download chart" }));
    await waitFor(() =>
      expect(downloadChart).toHaveBeenCalledWith(expect.any(Blob), "Entity structure chart", "pdf"),
    );
  });
});
