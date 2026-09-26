import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../../../client/src/test-utils.tsx";
import { SungrowForm } from "./SungrowForm.tsx";

const mocks = vi.hoisted(() => ({
  listPlantsMutate: vi.fn(),
  listPlantsState: {
    data: undefined as unknown,
    isPending: false,
    isError: false,
    error: null as { message: string } | null,
  },
  testMutate: vi.fn(),
}));

vi.mock("./trpc.ts", () => ({
  trpc: {
    plugin: {
      energy: {
        sungrow_isolarcloud: {
          listPlants: {
            useMutation: () => ({
              mutate: mocks.listPlantsMutate,
              ...mocks.listPlantsState,
            }),
          },
          testConnection: {
            useMutation: () => ({
              mutate: mocks.testMutate,
              data: undefined,
              isPending: false,
              isSuccess: false,
              isError: false,
              error: null,
            }),
          },
        },
      },
    },
  },
}));

// ---- Tests ----

describe("SungrowForm", () => {
  const renderForm = () =>
    renderWithProviders(
      <SungrowForm
        initialEmail="owner@example.com"
        initialRegion="europe"
        initialPsId=""
        onTestSuccess={vi.fn()}
      />,
    );

  const fillPassword = () => {
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "secret" },
    });
  };

  const setPlants = (plants: Array<{ psId: string; name: string }>) => {
    mocks.listPlantsState.data = { success: true, plants };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listPlantsState.data = undefined;
    mocks.listPlantsState.isPending = false;
    mocks.listPlantsState.isError = false;
    mocks.listPlantsState.error = null;
  });

  afterEach(() => {
    cleanup();
  });

  it("renders email, password and region fields", () => {
    renderForm();

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByLabelText("Server region")).toBeInTheDocument();
  });

  it("defaults the region select to Europe", () => {
    renderForm();

    expect(screen.getByLabelText("Server region")).toHaveTextContent("Europe");
  });

  it("Load Plants is disabled until email and password are filled", () => {
    renderForm();

    expect(screen.getByRole("button", { name: "Load Plants" })).toBeDisabled();

    fillPassword();

    expect(screen.getByRole("button", { name: "Load Plants" })).toBeEnabled();
  });

  it("Load Plants calls listPlants with the credentials and region", () => {
    renderForm();
    fillPassword();

    fireEvent.click(screen.getByRole("button", { name: "Load Plants" }));

    expect(mocks.listPlantsMutate).toHaveBeenCalledWith({
      email: "owner@example.com",
      password: "secret",
      region: "europe",
    });
  });

  it("lists the returned plants as rows with name, id and a Use button", () => {
    setPlants([
      { psId: "1198878", name: "Home" },
      { psId: "2200011", name: "Shed" },
    ]);

    renderForm();

    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("1198878")).toBeInTheDocument();
    expect(screen.getByText("Shed")).toBeInTheDocument();
    expect(screen.getByText("2200011")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Use" })).toHaveLength(2);
  });

  it("no plant rows before Load Plants returns", () => {
    renderForm();

    expect(screen.queryByText("Plant")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use" }))
      .not.toBeInTheDocument();
  });

  it("shows the empty state when the account has no plants", () => {
    setPlants([]);

    renderForm();

    expect(screen.getByText("No plants found on this iSolarCloud account."))
      .toBeInTheDocument();
  });

  it("Test Connection sends the plant chosen with Use", async () => {
    setPlants([{ psId: "1198878", name: "Home" }]);

    renderForm();
    fillPassword();
    fireEvent.click(screen.getByRole("button", { name: "Use" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Test Connection" }))
        .toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));

    expect(mocks.testMutate).toHaveBeenCalledWith({
      email: "owner@example.com",
      password: "secret",
      region: "europe",
      psId: "1198878",
    });
  });

  it("surfaces a listPlants failure", () => {
    mocks.listPlantsState.data = { success: false, error: "Login failed" };

    renderForm();

    expect(screen.getByText("Login failed")).toBeInTheDocument();
  });
});
