// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntlProvider } from "react-intl";
import { expect, it, vi } from "vitest";
import { OfficerNameInput } from "./officer-name-input";

const users = [
  { id: "u1", displayName: "Nadia Counsel", image: null, role: "legal_team_member" as const },
];
function example(props: Partial<React.ComponentProps<typeof OfficerNameInput>> = {}) {
  return (
    <IntlProvider locale="en-US">
      <OfficerNameInput
        label="Name"
        name="External Director"
        userId={null}
        users={users}
        {...props}
      />
      <button>Next</button>
    </IntlProvider>
  );
}

it("selects a user by pointer and commits the name and link together", async () => {
  const user = userEvent.setup();
  const commit = vi.fn().mockResolvedValue(true);
  render(example({ onCommit: commit }));
  const input = screen.getByRole("combobox", { name: "Name" });
  await user.clear(input);
  await user.type(input, "Nadia");
  await user.click(screen.getByRole("option", { name: "Nadia Counsel" }));
  await waitFor(() =>
    expect(commit).toHaveBeenCalledExactlyOnceWith({ name: "Nadia Counsel", userId: "u1" }),
  );
  expect(input).toHaveValue("Nadia Counsel");
});

it("accepts an unlisted name without creating or linking a user", async () => {
  const user = userEvent.setup();
  const commit = vi.fn().mockResolvedValue(true);
  render(example({ onCommit: commit }));
  const input = screen.getByRole("combobox");
  await user.clear(input);
  await user.type(input, "Dana Director");
  await user.click(
    screen.getByRole("option", { name: 'Use "Dana Director" without linking a user' }),
  );
  expect(commit).toHaveBeenCalledExactlyOnceWith({ name: "Dana Director", userId: null });
});

it("preserves an unavailable linked user on blur and restores it on Escape or a failed edit", async () => {
  const user = userEvent.setup();
  const commit = vi.fn().mockResolvedValue(false);
  render(example({ name: "Former User", userId: "former", onCommit: commit }));
  const input = screen.getByRole("combobox");
  await user.click(input);
  await user.tab();
  expect(commit).not.toHaveBeenCalled();
  await user.clear(input);
  await user.type(input, "Changed{Escape}");
  await user.tab();
  expect(input).toHaveValue("Former User");
  expect(commit).not.toHaveBeenCalled();
  await user.clear(input);
  await user.type(input, "Nadia");
  await user.keyboard("{ArrowDown}{Enter}");
  await waitFor(() => expect(input).toHaveValue("Former User"));
  expect(commit).toHaveBeenCalledExactlyOnceWith({ name: "Nadia Counsel", userId: "u1" });
});

it("disables the name picker on frozen records", () => {
  render(example({ disabled: true }));
  expect(screen.getByRole("combobox")).toBeDisabled();
});
