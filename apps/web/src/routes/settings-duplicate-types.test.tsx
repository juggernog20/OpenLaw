// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi } from "../testing/helpers";

const ADMIN = {
  id: "u1",
  email: "devon@example.com",
  displayName: "Devon Calloway",
  role: "administrator",
  theme: "light",
};

it.each(["contract", "matter", "entity"])(
  "duplicates a live %s type and opens its editor",
  async (module) => {
    const calls: string[] = [];
    const row = {
      id: "source",
      slug: "source",
      displayName: "Source",
      description: null,
      displayOrder: 1,
      isSystemDefault: false,
      archivedAt: null,
      inUseCount: 0,
    };
    const copy = { ...row, id: "copy", slug: "source_copy", displayName: "Source (copy)" };
    stubApi({
      signedIn: ADMIN,
      extra: (call) => {
        if (call.url.pathname === `/api/v1/${module}-types` && call.method === "GET")
          return json(200, { [`${module}Types`]: [row, copy] });
        if (
          call.url.pathname === `/api/v1/${module}-types/source/duplicate` &&
          call.method === "POST"
        ) {
          calls.push(call.url.pathname);
          return json(201, { [`${module}Type`]: copy });
        }
        return undefined;
      },
    });
    const plural = module === "entity" ? "entities" : `${module}s`;
    const { router } = renderAt(`/settings/${plural}/types`);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Duplicate Source" }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/settings/${plural}/types/copy`),
    );
    expect(calls).toEqual([`/api/v1/${module}-types/source/duplicate`]);
  },
);

it.each(["contract", "matter", "entity"])(
  "hides Duplicate on archived %s rows and shows a refusal on live rows",
  async (module) => {
    const row = {
      id: "source",
      slug: "source",
      displayName: "Source",
      description: null,
      displayOrder: 1,
      isSystemDefault: false,
      archivedAt: null,
      inUseCount: 0,
    };
    stubApi({
      signedIn: ADMIN,
      extra: (call) => {
        if (call.url.pathname === `/api/v1/${module}-types` && call.method === "GET")
          return json(200, {
            [`${module}Types`]: [
              row,
              {
                ...row,
                id: "archived",
                displayName: "Archived source",
                archivedAt: "2026-09-30T00:00:00.000Z",
              },
            ],
          });
        if (call.url.pathname.endsWith("/duplicate"))
          return problem(409, "Restore this type first.");
        return undefined;
      },
    });
    const plural = module === "entity" ? "entities" : `${module}s`;
    const { router } = renderAt(`/settings/${plural}/types`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("switch", { name: "Show archived" }));
    expect(
      screen.queryByRole("button", { name: "Duplicate Archived source" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Duplicate Source" }));
    expect(await screen.findByText("Restore this type first.")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/settings/${plural}/types`);
  },
);
