// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { json, renderAt, stubApi } from "../testing/helpers";

const logo = "data:image/png;base64,aGVsbG8=";
const orgGeneral = {
  name: "Wentworth Family Office",
  logo,
  defaultLocale: "en-US" as const,
  defaultTimezone: "UTC",
};

describe("organization branding before sign-in", () => {
  it.each(["/auth/login", "/portal/login", "/auth/set-password?token=example"])(
    "shows the saved name and logo at %s",
    async (path) => {
      stubApi({ orgGeneral });
      renderAt(path);
      expect(await screen.findByText(orgGeneral.name)).toBeInTheDocument();
      expect(screen.getByRole("img", { name: "Organization logo" })).toHaveAttribute("src", logo);
      expect(screen.getByText("Powered by OpenLaw")).toBeInTheDocument();
    },
  );

  it("uses the organization name when no logo is saved", async () => {
    stubApi({ orgGeneral: { ...orgGeneral, logo: null } });
    renderAt("/auth/login");
    expect(await screen.findByText(orgGeneral.name)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Organization logo" })).not.toBeInTheDocument();
  });

  it("keeps sign-in usable when the saved image cannot load", async () => {
    stubApi({ orgGeneral });
    renderAt("/auth/login");
    fireEvent.error(await screen.findByRole("img", { name: "Organization logo" }));
    expect(screen.queryByRole("img", { name: "Organization logo" })).not.toBeInTheDocument();
    expect(screen.getByText(orgGeneral.name)).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it.each(["unconfigured", "unavailable"])(
    "falls back to OpenLaw when branding is %s",
    async (state) => {
      stubApi({
        extra: (call) =>
          state === "unavailable" && call.url.pathname === "/api/v1/org/branding"
            ? json(503, { message: "Unavailable" })
            : undefined,
      });
      renderAt("/auth/login");
      expect(await screen.findByLabelText("Password")).toBeInTheDocument();
      expect(screen.getByText("OpenLaw")).toBeInTheDocument();
      expect(screen.queryByText("Powered by OpenLaw")).not.toBeInTheDocument();
    },
  );
});
