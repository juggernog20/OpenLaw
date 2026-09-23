// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi } from "../testing/helpers";
const ADMIN = {
  id: "u1",
  email: "admin@example.com",
  displayName: "Admin",
  role: "administrator",
  theme: "light",
};
const field = (key: string, value: string, extra = {}) => ({
  key,
  value,
  activeValue: value,
  source: "deployment",
  secret: false,
  configured: Boolean(value),
  locked: false,
  ...extra,
});
const state = (fields = [field("BASE_URL", "http://localhost:3000")]) => ({
  version: "initial",
  restartRequired: false,
  fields,
});
describe("Advanced settings", () => {
  it("saves an instance address and distinguishes saved values from active ones", async () => {
    const writes: unknown[] = [];
    stubApi({
      signedIn: ADMIN,
      extra: (call) => {
        if (call.url.pathname !== "/api/v1/advanced-settings/instance") return;
        if (call.method === "GET") return json(200, state());
        writes.push(call.body);
        return json(200, {
          ...state([
            field("BASE_URL", "https://legal.internal", {
              activeValue: "http://localhost:3000",
              source: "app",
            }),
          ]),
          version: "new",
          restartRequired: true,
        });
      },
    });
    renderAt("/settings/instance");
    const user = userEvent.setup();
    const address = await screen.findByLabelText("Application address");
    await user.clear(address);
    await user.type(address, "https://legal.internal");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Settings saved/)).toBeInTheDocument();
    expect(screen.getByText("Active: http://localhost:3000")).toBeInTheDocument();
    expect(writes).toEqual([
      { version: "initial", values: { BASE_URL: "https://legal.internal" } },
    ]);
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    for (const title of [
      "Instance address",
      "File uploads",
      "Document storage",
      "Document processing",
      "System status",
    ])
      expect(within(nav).getByRole("link", { name: title })).toBeInTheDocument();
  });
  it("requires a new test after editing storage and leaves configured credentials blank", async () => {
    const calls: string[] = [];
    stubApi({
      signedIn: ADMIN,
      extra: (call) => {
        if (!call.url.pathname.startsWith("/api/v1/advanced-settings/storage")) return;
        calls.push(call.method);
        if (call.method === "GET")
          return json(
            200,
            state([
              field("STORAGE_DRIVER", "s3"),
              field("S3_BUCKET", "files", { locked: true }),
              field("S3_SECRET_ACCESS_KEY", "", { secret: true, configured: true }),
            ]),
          );
        if (call.method === "POST") return json(200, { ok: true });
        return problem(
          409,
          "These settings changed in another session. Reload the page before saving.",
        );
      },
    });
    renderAt("/settings/storage");
    const user = userEvent.setup();
    const key = await screen.findByLabelText("S3 secret access key");
    expect(key).toHaveValue("");
    expect(key).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("S3 bucket")).toHaveAttribute("readonly");
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("Connection test passed.")).toBeInTheDocument();
    expect(save).toBeEnabled();
    await user.type(key, "new-test-credential");
    expect(save).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    await user.click(save);
    expect(await screen.findByText(/These settings changed/)).toBeInTheDocument();
    expect(key).toHaveValue("new-test-credential");
    expect(calls).toContain("PUT");
  });
  it("shows a missing worker and pending configuration without claiming everything is healthy", async () => {
    stubApi({
      signedIn: ADMIN,
      extra: (call) =>
        call.url.pathname === "/api/v1/system-status"
          ? json(200, {
              database: "available",
              storageDriver: "local",
              documentEngine: "http://doc-engine:8080",
              processes: [
                {
                  role: "api",
                  startedAt: "2026-09-17T00:00:00Z",
                  heartbeatAt: "2026-09-17T00:00:00Z",
                  online: true,
                  current: false,
                },
              ],
            })
          : undefined,
    });
    renderAt("/settings/system-status");
    expect(await screen.findByText(/heartbeat is missing/)).toBeInTheDocument();
    expect(screen.getByText("Restart required")).toBeInTheDocument();
  });
  it.each(["instance", "uploads", "storage", "document-processing", "system-status"])(
    "keeps %s restricted to administrators",
    async (path) => {
      stubApi({ signedIn: { ...ADMIN, role: "legal_team_member" } });
      renderAt(`/settings/${path}`);
      expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
    },
  );
});

it("shows the MCP limit and respects deployment pinning", async () => {
  stubApi({
    signedIn: ADMIN,
    extra: (call) => {
      if (call.url.pathname === "/api/v1/advanced-settings/mcp")
        return json(
          200,
          state([field("MCP_RATE_LIMIT_PER_HOUR", "600", { locked: true, source: "deployment" })]),
        );
    },
  });
  renderAt("/settings/mcp-limits");
  expect(await screen.findByLabelText("Calls per hour per credential")).toHaveValue(600);
  expect(screen.getByLabelText("Calls per hour per credential")).toHaveAttribute("readonly");
  expect(screen.getByText(/Deployment configuration/)).toBeInTheDocument();
});
