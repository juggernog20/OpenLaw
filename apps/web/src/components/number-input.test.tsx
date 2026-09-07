// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntlProvider } from "react-intl";
import { expect, it } from "vitest";
import { NumberInput } from "./number-input";

function Example({ initial = "12345.67", locale = "en-US" }) {
  const [value, setValue] = useState(initial);
  return (
    <IntlProvider locale={locale}>
      <NumberInput aria-label="Budget" value={value} onValueChange={setValue} />
      <button onClick={() => setValue(initial)}>Revert</button>
      <output>{value}</output>
    </IntlProvider>
  );
}

it("groups amounts for reading while preserving the numeric draft and decimal precision", async () => {
  render(<Example />);
  const user = userEvent.setup();
  const input = screen.getByRole("textbox", { name: "Budget" });
  expect(input).toHaveValue("12,345.67");
  await user.click(input);
  expect(input).toHaveValue("12345.67");
  await user.clear(input);
  await user.type(input, "987654.3210");
  await user.tab();
  expect(input).toHaveValue("987,654.321");
  expect(screen.getByRole("status")).toHaveTextContent("987654.3210");
  await user.click(screen.getByRole("button", { name: "Revert" }));
  expect(input).toHaveValue("12,345.67");
});

it("keeps empty distinct from zero and preserves negative values", async () => {
  render(<Example initial="-12500" />);
  const user = userEvent.setup();
  const input = screen.getByRole("textbox", { name: "Budget" });
  expect(input).toHaveValue("-12,500");
  await user.clear(input);
  await user.tab();
  expect(input).toHaveValue("");
  await user.type(input, "0");
  await user.tab();
  expect(input).toHaveValue("0");
});

it("uses locale separators without changing the stored decimal representation", () => {
  render(<Example locale="de-DE" />);
  expect(screen.getByRole("textbox", { name: "Budget" })).toHaveValue("12.345,67");
  expect(screen.getByRole("status")).toHaveTextContent("12345.67");
});

it("accepts pasted separators and normalizes locale decimals for saving", async () => {
  render(<Example locale="de-DE" />);
  const user = userEvent.setup();
  const input = screen.getByRole("textbox", { name: "Budget" });
  await user.click(input);
  expect(input).toHaveValue("12345,67");
  await user.clear(input);
  await user.paste("98.765,43");
  await user.tab();
  expect(input).toHaveValue("98.765,43");
  expect(screen.getByRole("status")).toHaveTextContent("98765.43");
});
