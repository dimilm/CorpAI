import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Field } from "./Field";

describe("Field", () => {
  it("associates the label with the control via htmlFor/id", () => {
    render(
      <Field id="email" label="E-Mail">
        {(aria) => <input {...aria} />}
      </Field>
    );
    const input = screen.getByLabelText("E-Mail");
    expect(input).toHaveAttribute("id", "email");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  it("renders a required marker when required", () => {
    render(
      <Field id="name" label="Name" required>
        {(aria) => <input {...aria} />}
      </Field>
    );
    expect(screen.getByText("*")).toBeInTheDocument();
  });

  it("wires aria-invalid and aria-describedby to the error message", () => {
    render(
      <Field id="isin" label="ISIN" error="Ungültige ISIN">
        {(aria) => <input {...aria} />}
      </Field>
    );
    const input = screen.getByLabelText("ISIN");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "isin-error");
    const error = screen.getByRole("alert");
    expect(error).toHaveAttribute("id", "isin-error");
    expect(error).toHaveTextContent("Ungültige ISIN");
  });

  it("links both helper and error in aria-describedby order (helper, error)", () => {
    render(
      <Field id="qty" label="Menge" helper="Stückzahl" error="Pflichtfeld">
        {(aria) => <input {...aria} />}
      </Field>
    );
    const input = screen.getByLabelText("Menge");
    expect(input).toHaveAttribute("aria-describedby", "qty-helper qty-error");
  });

  it("links only the helper when there is no error", () => {
    render(
      <Field id="qty" label="Menge" helper="Stückzahl">
        {(aria) => <input {...aria} />}
      </Field>
    );
    const input = screen.getByLabelText("Menge");
    expect(input).toHaveAttribute("aria-describedby", "qty-helper");
    expect(input).not.toHaveAttribute("aria-invalid");
  });
});
