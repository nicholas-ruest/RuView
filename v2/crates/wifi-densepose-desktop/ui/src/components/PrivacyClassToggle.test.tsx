import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PrivacyClassToggle } from "./PrivacyClassToggle";
import { configureEcosystems } from "../api/ecosystems";

function mockFetchOnce(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response);
}

describe("PrivacyClassToggle", () => {
  beforeEach(() => {
    configureEcosystems({ baseUrl: "http://test.local:8123", token: "tok" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("surfaces the 422 floor error inline and does not call onChange", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchOnce(422, {
        error: "class_below_floor",
        message: "consumer ecosystems may not drop below class 2 (anonymous)",
      }),
    );
    const onChange = vi.fn();

    render(<PrivacyClassToggle ecosystem="google_home" value={3} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Anonymous" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/may not drop below class 2/i),
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("calls onChange with the applied class on a successful change", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchOnce(200, {
        ecosystem: "apple_home",
        privacy_class: 3,
        applied: true,
      }),
    );
    const onChange = vi.fn();

    render(<PrivacyClassToggle ecosystem="apple_home" value={2} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Restricted" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(3));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
