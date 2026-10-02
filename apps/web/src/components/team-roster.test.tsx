// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { IntlProvider } from "react-intl";
import { describe, expect, it } from "vitest";
import { TeamRoster, type TeamPerson } from "./team-roster";

const PERSON: TeamPerson = {
  id: "person-1",
  displayName: "Alex Smith",
  image: null,
  archived: false,
};

function renderRoster(ui: ReactElement) {
  return render(
    <IntlProvider locale="en-US" defaultLocale="en-US">
      {ui}
    </IntlProvider>,
  );
}

describe("TeamRoster", () => {
  it("shows one person with all their responsibilities and membership", () => {
    renderRoster(
      <TeamRoster
        entries={[
          { person: PERSON, statement: "Legal Owner" },
          { person: PERSON, statement: "Business Owner" },
          { person: PERSON, statement: "Creator" },
          { person: PERSON, statement: "Creator" },
          { person: PERSON },
        ]}
      />,
    );

    const row = screen.getByRole("listitem");
    expect(within(row).getByText(PERSON.displayName)).toBeInTheDocument();
    expect(within(row).getByText("Legal Owner")).toBeInTheDocument();
    expect(within(row).getByText("Business Owner")).toBeInTheDocument();
    expect(within(row).getByText("Creator")).toBeInTheDocument();
    expect(within(row).queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps different people with the same display name in separate rows", () => {
    renderRoster(
      <TeamRoster
        entries={[
          { person: PERSON, statement: "Creator" },
          { person: PERSON },
          { person: { ...PERSON, id: "person-2" } },
        ]}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByText(PERSON.displayName)).toHaveLength(2);
  });

  it("mutes an archived person and marks them Archived, keeping their statements", () => {
    renderRoster(
      <TeamRoster
        entries={[
          { person: { ...PERSON, archived: true }, statement: "Matter Manager" },
          { person: { ...PERSON, id: "person-2", displayName: "Blake Jones" } },
        ]}
      />,
    );

    const [archived, live] = screen.getAllByRole("listitem");
    expect(archived).toHaveClass("text-muted");
    expect(within(archived!).getByText("Archived")).toBeInTheDocument();
    expect(within(archived!).getByText("Matter Manager")).toBeInTheDocument();
    expect(live).toHaveClass("text-primary");
    expect(live).not.toHaveClass("text-muted");
    expect(within(live!).queryByText("Archived")).not.toBeInTheDocument();
  });
});
