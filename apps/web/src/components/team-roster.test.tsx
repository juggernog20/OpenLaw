// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TeamRoster, type TeamPerson } from "./team-roster";

const PERSON: TeamPerson = {
  id: "person-1",
  displayName: "Alex Smith",
  image: null,
  archived: false,
};

describe("TeamRoster", () => {
  it("shows one person with all their responsibilities and membership", () => {
    render(
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
    render(
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
});
