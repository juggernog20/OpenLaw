// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi } from "../testing/helpers";

const BUSINESS = {
  id: "u9",
  email: "business@example.com",
  displayName: "Business User",
  role: "business_user",
  theme: "light",
};
afterEach(() => {
  delete document.documentElement.dataset.theme;
  localStorage.removeItem("openlaw.theme");
});

function setup(fail = false) {
  let theme = "light";
  const writes: unknown[] = [];
  stubApi({
    signedIn: BUSINESS,
    extra: (call) => {
      if (call.url.pathname === "/api/v1/me" && call.method === "GET")
        return json(200, { user: { ...BUSINESS, theme } });
      if (call.url.pathname === "/api/v1/me/preferences" && call.method === "PATCH") {
        writes.push(call.body);
        if (fail) return problem(500, "Preference could not be saved.");
        theme = (call.body as { theme: string }).theme;
        return json(200, { user: { ...BUSINESS, theme } });
      }
      if (call.url.pathname === "/api/v1/me/notification-preferences")
        return json(200, {
          groups: [
            {
              eventGroup: "requester_events",
              inApp: true,
              email: true,
              defaults: { inApp: true, email: true },
            },
          ],
        });
      if (call.url.pathname === "/api/v1/portal/request-types")
        return json(200, { requestTypes: [] });
      if (call.url.pathname === "/api/v1/portal/intake-links")
        return json(200, { intakeLinks: [] });
      if (call.url.pathname === "/api/v1/portal/requests") return json(200, { requests: [] });
      return undefined;
    },
  });
  return writes;
}

it("lets a Business User choose all three themes and retains the saved choice on another portal page", async () => {
  const writes = setup();
  const user = userEvent.setup();
  renderAt("/portal");
  for (const [before, after] of [
    ["Light", "Dark"],
    ["Dark", "Warm"],
    ["Warm", "Light"],
    ["Light", "Dark"],
  ]) {
    await user.click(await screen.findByRole("button", { name: `Theme: ${before}` }));
    await user.click(screen.getByRole("menuitemradio", { name: after }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: `Theme: ${after}` })).toBeEnabled(),
    );
    expect(document.documentElement.dataset.theme).toBe(after!.toLowerCase());
    expect(localStorage.getItem("openlaw.theme")).toBe(after!.toLowerCase());
  }
  expect(writes).toEqual([
    { theme: "dark" },
    { theme: "warm" },
    { theme: "light" },
    { theme: "dark" },
  ]);
  await user.click(screen.getByRole("link", { name: "Notification settings" }));
  expect(
    await screen.findByRole("heading", { name: "Notification settings", level: 1 }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Theme: Dark" })).toBeInTheDocument();
  expect(document.documentElement.dataset.theme).toBe("dark");
});

it("restores the previous theme and reports a failed save", async () => {
  setup(true);
  const user = userEvent.setup();
  renderAt("/portal");
  await user.click(await screen.findByRole("button", { name: "Theme: Light" }));
  await user.click(screen.getByRole("menuitemradio", { name: "Dark" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("The theme could not be saved");
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(localStorage.getItem("openlaw.theme")).toBe("light");
  expect(screen.getByRole("button", { name: "Theme: Light" })).toBeEnabled();
});
