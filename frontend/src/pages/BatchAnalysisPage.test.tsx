import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";

import { BatchAnalysisPage } from "./BatchAnalysisPage";
import { api } from "../api/client";

vi.mock("../api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

const AGENTS = [
  { id: "fisher", name: "Fisher", description: "", output_schema: {} },
  { id: "scenario", name: "Szenario", description: "", output_schema: {} },
  { id: "redflag", name: "Risiko", description: "", output_schema: {} },
  { id: "tournament", name: "Turnier", description: "", output_schema: {} },
];

const STOCKS = [
  { isin: "US0378331005", name: "Apple" },
  { isin: "US5949181045", name: "Microsoft" },
];

beforeEach(() => {
  mockedApi.get.mockReset();
  mockedApi.post.mockReset();
  mockedApi.get.mockImplementation((url: string) => {
    if (url === "/ai/agents") return Promise.resolve({ data: AGENTS });
    if (url === "/stocks") return Promise.resolve({ data: STOCKS });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  mockedApi.post.mockResolvedValue({
    data: {
      queued: [{ agent_id: "fisher", isin: "US0378331005", run_id: 1, status: "queued", reason: null }],
      skipped: [],
    },
  });
});

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <BatchAnalysisPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

it("preselects all agents except tournament", async () => {
  renderPage();
  const fisher = await screen.findByRole("checkbox", { name: "Fisher" });
  expect(fisher).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Szenario" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Risiko" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Turnier" })).not.toBeChecked();
});

it("starts a batch with the selected agents and stocks", async () => {
  const user = userEvent.setup();
  renderPage();

  await user.click(await screen.findByRole("checkbox", { name: /Apple/ }));
  await user.click(screen.getByRole("button", { name: /KI-Analyse starten/ }));

  await waitFor(() => expect(mockedApi.post).toHaveBeenCalledTimes(1));
  expect(mockedApi.post).toHaveBeenCalledWith("/ai/runs/batch", {
    agent_ids: ["fisher", "scenario", "redflag"],
    isins: ["US0378331005"],
  });
});

it("disables the start button until a stock is selected", async () => {
  renderPage();
  const startBtn = await screen.findByRole("button", { name: /KI-Analyse starten/ });
  expect(startBtn).toBeDisabled();
});
