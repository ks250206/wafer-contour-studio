import { describe, expect, it } from "vite-plus/test";
import {
  collectCompositionKeys,
  collectNumericKeys,
  createEmptyEditorState,
  exportDatasetFromState,
  exportLayoutFromState,
  getOpeningFill,
  getOpeningPhaseColors,
  normalizeDataset,
  normalizeLayout,
  normalizeProject,
  positionToCartesian,
  splitPhaseInput,
} from "./maskMapUtils";

describe("maskMapUtils", () => {
  it("converts polar coordinates to cartesian", () => {
    const position = positionToCartesian({ type: "polar", r_mm: 10, theta_deg: 90 });
    expect(position.xMm).toBeCloseTo(0, 6);
    expect(position.yMm).toBeCloseTo(10, 6);
  });

  it("normalizes layout and enforces opening ids", () => {
    const layout = normalizeLayout({
      name: "Example",
      wafer_size: "4inch",
      openings: [
        {
          id: "a",
          position: { type: "cartesian", x_mm: 1, y_mm: 2 },
          shape: { type: "circle", radius_mm: 1.5 },
        },
      ],
    });

    expect(layout.layoutName).toBe("Example");
    expect(layout.openings[0]).toMatchObject({ id: "a", xMm: 1, yMm: 2 });
  });

  it("normalizes dataset and warns on unknown ids", () => {
    const dataset = normalizeDataset(
      {
        version: 1,
        openings: [{ id: "ghost", numericProperties: { thickness: 10 } }],
      },
      new Set(["real"]),
    );

    expect(dataset.datasetById.ghost.numericProperties.thickness).toBe(10);
    expect(dataset.datasetById.ghost.phase).toEqual([]);
    expect(dataset.warnings).toContain('dataset opening "ghost" does not exist in layout');
  });

  it("normalizes full project and preserves selected view", () => {
    const project = normalizeProject({
      version: 1,
      layout: {
        name: "Project",
        wafer_size: "4inch",
        openings: [
          {
            id: "o1",
            position: { type: "cartesian", x_mm: 0, y_mm: 0 },
            shape: { type: "rectangle", width_mm: 2, height_mm: 3, rotation_deg: 15 },
          },
        ],
      },
      dataset: {
        version: 1,
        openings: [{ id: "o1", numericProperties: { roughness: 1.2 } }],
      },
      view: {
        mode: "numeric",
        numericKey: "roughness",
      },
    });

    expect(project.state.openings[0].shape.type).toBe("rectangle");
    expect(project.view.numericKey).toBe("roughness");
  });

  it("collects numeric and composition keys from editor state", () => {
    const state = createEmptyEditorState();
    state.openings = [
      {
        id: "a",
        name: "a",
        xMm: 0,
        yMm: 0,
        enabled: true,
        shape: { type: "circle", radius_mm: 1 },
      },
    ];
    state.datasetById.a = {
      id: "a",
      numericProperties: { thickness: 10, resistivity: 3 },
      composition: { Si: 0.4, Al: 0.6 },
      phase: ["mix"],
    };

    expect(collectNumericKeys(state)).toEqual(["resistivity", "thickness"]);
    expect(collectCompositionKeys(state)).toEqual(["Al", "Si"]);
  });

  it("exports schema-compatible layout and dataset", () => {
    const state = createEmptyEditorState();
    state.layoutName = "Export";
    state.waferSize = "4inch";
    state.openings = [
      {
        id: "o1",
        name: "One",
        xMm: 1.2349,
        yMm: -2.3451,
        enabled: true,
        shape: { type: "circle", radius_mm: 0.75 },
      },
    ];
    state.datasetById.o1 = {
      id: "o1",
      numericProperties: { thickness: 12.3456 },
      composition: { Si: 0.25 },
      phase: ["Si", "Al"],
    };

    expect(exportLayoutFromState(state)).toEqual({
      name: "Export",
      wafer_size: "4inch",
      openings: [
        {
          id: "o1",
          name: "One",
          enabled: true,
          position: { type: "cartesian", x_mm: 1.235, y_mm: -2.345 },
          shape: { type: "circle", radius_mm: 0.75 },
        },
      ],
      alignment_holes: undefined,
    });

    expect(exportDatasetFromState(state)).toEqual({
      version: 1,
      phases: undefined,
      openings: [
        {
          id: "o1",
          numericProperties: { thickness: 12.346 },
          composition: { Si: 0.25 },
          phase: ["Si", "Al"],
        },
      ],
    });
  });

  it("computes fills for numeric and phase modes", () => {
    const state = createEmptyEditorState();
    state.openings = [
      {
        id: "o1",
        name: "One",
        xMm: 0,
        yMm: 0,
        enabled: true,
        shape: { type: "circle", radius_mm: 1 },
      },
      {
        id: "o2",
        name: "Two",
        xMm: 1,
        yMm: 1,
        enabled: true,
        shape: { type: "circle", radius_mm: 1 },
      },
    ];
    state.datasetById.o1 = {
      id: "o1",
      numericProperties: { thickness: 0 },
      composition: {},
      phase: ["Si"],
    };
    state.datasetById.o2 = {
      id: "o2",
      numericProperties: { thickness: 10 },
      composition: {},
      phase: ["Al", "Si"],
    };

    const numericFill = getOpeningFill({
      openingId: "o2",
      state,
      mode: "numeric",
      numericKey: "thickness",
    });
    const phaseFill = getOpeningFill({
      openingId: "o1",
      state,
      mode: "phase",
    });

    expect(numericFill).toMatch(/^#/);
    expect(phaseFill).toMatch(/^#/);
  });

  it("parses comma separated phases and resolves colors for multiple phases", () => {
    const state = createEmptyEditorState();
    state.openings = [
      {
        id: "o1",
        name: "One",
        xMm: 0,
        yMm: 0,
        enabled: true,
        shape: { type: "circle", radius_mm: 1 },
      },
    ];
    state.datasetById.o1 = {
      id: "o1",
      numericProperties: {},
      composition: {},
      phase: splitPhaseInput("Si, Al, Si, Oxide"),
    };

    expect(state.datasetById.o1.phase).toEqual(["Si", "Al", "Oxide"]);
    expect(getOpeningPhaseColors(state, "o1", "turbo")).toHaveLength(3);
  });
});
