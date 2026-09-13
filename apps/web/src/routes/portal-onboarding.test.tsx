// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi, type ApiState, type StubCall } from "../testing/helpers";

const TITLE = "We need to learn a little about you";
const SALES = { id: "sales", displayName: "Sales" };
function setup(
  departments: { id: string; displayName: string }[] = [SALES],
  refusal = false,
  refuseFinish = false,
) {
  const person: NonNullable<ApiState["signedIn"]> = {
    id: "business",
    email: "business@example.com",
    displayName: "Business colleague",
    role: "business_user",
    portalOnboardingCompletedAt: null,
  };
  const writes: StubCall[] = [];
  stubApi({
    signedIn: person,
    extra: (call) => {
      if (call.method !== "GET") writes.push(call);
      if (call.url.pathname === "/api/v1/portal/onboarding")
        return json(200, {
          completedAt: person.portalOnboardingCompletedAt,
          departmentId: person.departmentId ?? null,
          departments,
        });
      if (call.url.pathname === "/api/v1/portal/onboarding/department") {
        if (refusal) return problem(400, "Choose a live Department.");
        person.departmentId = "sales";
        return json(200, { departmentId: "sales" });
      }
      if (call.url.pathname === "/api/v1/portal/onboarding/complete") {
        if (refuseFinish)
          return problem(400, "Choose a live Department before finishing your first run.");
        person.portalOnboardingCompletedAt = "2026-09-13T00:00:00.000Z";
        return json(200, { completedAt: person.portalOnboardingCompletedAt });
      }
      if (call.url.pathname === "/api/v1/me/notification-preferences")
        return json(200, {
          groups: [
            { eventGroup: "requester_events", inApp: true, email: true },
            { eventGroup: "assigned_to_you", inApp: true, email: true },
            { eventGroup: "activity_on_your_records", inApp: true, email: true },
          ],
        });
      if (call.url.pathname === "/api/auth/update-user")
        return json(200, { status: true, user: { ...person, name: person.displayName } });
      if (call.url.pathname === "/api/v1/me/preferences") return json(200, { user: person });
      return undefined;
    },
  });
  return { person, writes };
}

it.each([
  "/portal",
  "/portal/enter",
  "/portal/contracts",
  "/portal/contracts/1",
  "/portal/matters/1",
  "/portal/new/nda",
  "/portal/requests/1",
  "/portal/knowledge/item",
  "/portal/settings",
  "/portal/help",
  "/portal/unknown",
])("redirects an unfinished Business User from %s", async (path) => {
  setup();
  renderAt(path);
  expect(await screen.findByRole("heading", { name: TITLE })).toBeVisible();
  expect(screen.getByRole("region", { name: "Department" })).toBeVisible();
  expect(screen.queryByRole("navigation", { name: "Portal" })).not.toBeInTheDocument();
});

it("requires Department, permits skipping the other steps, and completes only once", async () => {
  const { writes } = setup();
  const { router } = renderAt("/portal/onboarding");
  const user = userEvent.setup();
  const picker = await screen.findByRole("combobox", { name: "Department" });
  expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Skip" })).not.toBeInTheDocument();
  await user.selectOptions(picker, "sales");
  await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: "Continue" }));
  for (const title of ["Name and photo", "Theme", "Notifications"]) {
    expect(screen.getByRole("region", { name: title })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Skip" }));
  }
  expect(screen.getByRole("region", { name: "A short tour" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Auto-Docs" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Finish" }));
  expect(
    await screen.findByRole("heading", { name: "What do you need from Legal?" }),
  ).toBeVisible();
  expect(writes.map((call) => [call.url.pathname, call.body])).toEqual([
    ["/api/v1/portal/onboarding/department", { departmentId: "sales" }],
    ["/api/v1/portal/onboarding/complete", undefined],
  ]);
  await router.navigate("/portal/onboarding");
  expect(
    await screen.findByRole("heading", { name: "What do you need from Legal?" }),
  ).toBeVisible();
});

it("omits Department for an empty list and saves profile, theme, and notifications through existing routes", async () => {
  const { writes } = setup([]);
  renderAt("/portal/onboarding");
  const user = userEvent.setup();
  const name = await screen.findByRole("textbox", { name: "Full name" });
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: "Name and photo" })).toHaveFocus(),
  );
  expect(screen.queryByRole("combobox", { name: "Department" })).not.toBeInTheDocument();
  await user.clear(name);
  await user.type(name, "New name");
  await user.tab();
  await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
  await user.upload(
    screen.getByLabelText("Photo"),
    new File(["png"], "avatar.png", { type: "image/png" }),
  );
  await waitFor(() =>
    expect(writes.filter((call) => call.url.pathname === "/api/auth/update-user")).toHaveLength(2),
  );
  await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.click(screen.getByRole("radio", { name: "Dark" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.click(screen.getAllByRole("switch")[0]!);
  await waitFor(() =>
    expect(writes.some((call) => call.url.pathname === "/api/v1/me/notification-preferences")).toBe(
      true,
    ),
  );
  expect(writes.find((call) => call.url.pathname === "/api/auth/update-user")?.body).toEqual({
    name: "New name",
  });
  expect(writes.find((call) => call.url.pathname === "/api/v1/me/preferences")?.body).toEqual({
    theme: "dark",
  });
});

it("shows a refused Department write and keeps Continue disabled", async () => {
  setup([SALES], true);
  renderAt("/portal/onboarding");
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByRole("combobox", { name: "Department" }), "sales");
  expect(await screen.findByText("Choose a live Department.")).toBeVisible();
  expect(screen.getByRole("combobox", { name: "Department" })).toHaveValue("");
  expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
});

it("returns to Department with fresh choices when the list changes before Finish", async () => {
  const departments: { id: string; displayName: string }[] = [];
  setup(departments, false, true);
  renderAt("/portal/onboarding");
  const user = userEvent.setup();
  await screen.findByRole("region", { name: "Name and photo" });
  for (let step = 0; step < 3; step++)
    await user.click(screen.getByRole("button", { name: "Skip" }));
  departments.push(SALES);
  await user.click(screen.getByRole("button", { name: "Finish" }));
  expect(await screen.findByRole("region", { name: "Department" })).toBeVisible();
  expect(screen.getByRole("option", { name: "Sales" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("Choose a live Department");
});

it("asks the session question once for a guarded Portal page", async () => {
  const calls: StubCall[] = [];
  stubApi({
    signedIn: {
      id: "business",
      email: "business@example.com",
      displayName: "Business colleague",
      role: "business_user",
    },
    extra: (call) => {
      calls.push(call);
      return undefined;
    },
  });
  renderAt("/portal");
  expect(
    await screen.findByRole("heading", { name: "What do you need from Legal?" }),
  ).toBeVisible();
  expect(calls.filter((call) => call.url.pathname === "/api/v1/me")).toHaveLength(1);
});

it.each(["administrator", "legal_team_member"])("refuses the wizard to a %s", async (role) => {
  stubApi({
    signedIn: {
      id: "staff",
      email: "staff@example.com",
      displayName: "Staff",
      role,
      portalOnboardingCompletedAt: null,
    },
  });
  renderAt("/portal/onboarding");
  expect(await screen.findByRole("heading", { name: "Profile" })).toBeVisible();
});
