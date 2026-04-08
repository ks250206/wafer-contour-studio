import { contourColorPalettes, type ContourColorPalette } from "./contourPlot";
import {
  type EditableAlignmentHole,
  type EditableDatasetEntry,
  type EditableOpening,
  type LayoutPosition,
  type LayoutShape,
  type MaskMapDataset,
  type MaskMapEditorState,
  type MaskMapProject,
  type MaskMapProjectView,
  type WaferMaskLayout,
  type WaferSize,
} from "./maskMapTypes";

export const WAFER_SIZE_TO_DIAMETER_MM: Record<WaferSize, number> = {
  "2inch": 50,
  "3inch": 76.2,
  "4inch": 100,
  "6inch": 150,
  "8inch": 200,
  "12inch": 300,
};

export const DEFAULT_NUMERIC_KEY = "thickness";
const DEFAULT_VIEW: MaskMapProjectView = {
  mode: "numeric",
  numericKey: DEFAULT_NUMERIC_KEY,
  colorPalette: "turbo",
  compareEnabled: true,
  compareMode: "phase",
  compareNumericKey: DEFAULT_NUMERIC_KEY,
  compareColorPalette: "turbo",
};

const DEFAULT_PHASE_COLORS = [
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#4b5563",
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNumberRecord = (value: unknown): value is Record<string, number> =>
  isRecord(value) && Object.values(value).every((entry) => typeof entry === "number");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export const positionToCartesian = (position: LayoutPosition) => {
  if (position.type === "cartesian") {
    return { xMm: position.x_mm, yMm: position.y_mm };
  }

  const thetaRad = (position.theta_deg * Math.PI) / 180;
  return {
    xMm: position.r_mm * Math.cos(thetaRad),
    yMm: position.r_mm * Math.sin(thetaRad),
  };
};

export const createEmptyEditorState = (): MaskMapEditorState => ({
  layoutName: "Untitled Mask",
  waferSize: "4inch",
  openings: [],
  alignmentHoles: [],
  datasetById: {},
  phaseColors: {},
});

const normalizeShape = (shape: LayoutShape): LayoutShape => {
  if (shape.type === "circle") {
    return { type: "circle", radius_mm: shape.radius_mm };
  }

  return {
    type: "rectangle",
    width_mm: shape.width_mm,
    height_mm: shape.height_mm,
    rotation_deg: shape.rotation_deg ?? 0,
  };
};

const normalizeOpening = (
  opening: {
    id?: string;
    name?: string;
    position: LayoutPosition;
    shape: LayoutShape;
    enabled?: boolean;
  },
  index: number,
): EditableOpening => {
  assert(
    typeof opening.id === "string" && opening.id.trim().length > 0,
    `opening ${index + 1} is missing id`,
  );
  const id = opening.id;
  const name =
    typeof opening.name === "string" && opening.name.trim().length > 0 ? opening.name : id;
  const cartesian = positionToCartesian(opening.position);
  return {
    id,
    name,
    xMm: cartesian.xMm,
    yMm: cartesian.yMm,
    shape: normalizeShape(opening.shape),
    enabled: opening.enabled ?? true,
  };
};

const normalizeAlignmentHole = (
  opening: {
    id?: string;
    name?: string;
    role?: "primary" | "secondary" | "tertiary";
    position: LayoutPosition;
    shape: LayoutShape;
    enabled?: boolean;
  },
  index: number,
): EditableAlignmentHole => ({
  ...normalizeOpening(opening, index),
  role: opening.role,
});

export const normalizeLayout = (
  input: unknown,
): Pick<MaskMapEditorState, "layoutName" | "waferSize" | "openings" | "alignmentHoles"> => {
  assert(isRecord(input), "layout JSON must be an object");
  assert(typeof input.name === "string" && input.name.trim().length > 0, "layout.name is required");
  assert(typeof input.wafer_size === "string", "layout.wafer_size is required");
  assert(
    input.wafer_size in WAFER_SIZE_TO_DIAMETER_MM,
    "layout.wafer_size is not supported by the schema",
  );
  assert(Array.isArray(input.openings), "layout.openings must be an array");

  const openings = input.openings.map((opening, index) => {
    assert(isRecord(opening), `opening ${index + 1} must be an object`);
    assert(isRecord(opening.position), `opening ${index + 1}.position must be an object`);
    assert(isRecord(opening.shape), `opening ${index + 1}.shape must be an object`);
    return normalizeOpening(
      {
        id: typeof opening.id === "string" ? opening.id : undefined,
        name: typeof opening.name === "string" ? opening.name : undefined,
        enabled: typeof opening.enabled === "boolean" ? opening.enabled : undefined,
        position: opening.position as unknown as LayoutPosition,
        shape: opening.shape as unknown as LayoutShape,
      },
      index,
    );
  });

  const duplicateId = findDuplicateId(openings.map((opening) => opening.id));
  assert(!duplicateId, `opening id "${duplicateId}" is duplicated`);

  const alignmentHoles = Array.isArray(input.alignment_holes)
    ? input.alignment_holes.map((opening, index) => {
        assert(isRecord(opening), `alignment_hole ${index + 1} must be an object`);
        assert(
          isRecord(opening.position),
          `alignment_hole ${index + 1}.position must be an object`,
        );
        assert(isRecord(opening.shape), `alignment_hole ${index + 1}.shape must be an object`);
        return normalizeAlignmentHole(
          {
            id: typeof opening.id === "string" ? opening.id : `alignment-${index + 1}`,
            name: typeof opening.name === "string" ? opening.name : undefined,
            role:
              opening.role === "primary" ||
              opening.role === "secondary" ||
              opening.role === "tertiary"
                ? opening.role
                : undefined,
            enabled: typeof opening.enabled === "boolean" ? opening.enabled : undefined,
            position: opening.position as unknown as LayoutPosition,
            shape: opening.shape as unknown as LayoutShape,
          },
          index,
        );
      })
    : [];

  return {
    layoutName: input.name,
    waferSize: input.wafer_size as WaferSize,
    openings,
    alignmentHoles,
  };
};

export const normalizeDataset = (input: unknown, knownIds?: Set<string>) => {
  assert(isRecord(input), "dataset JSON must be an object");
  assert(input.version === 1, "dataset.version must be 1");
  assert(Array.isArray(input.openings), "dataset.openings must be an array");

  const warnings: string[] = [];
  const datasetById: Record<string, EditableDatasetEntry> = {};
  const phaseColors: Record<string, string> = {};

  if (isRecord(input.phases)) {
    for (const [phase, color] of Object.entries(input.phases)) {
      if (typeof color === "string" && color.trim().length > 0) {
        phaseColors[phase] = color;
      }
    }
  }

  for (const [index, opening] of input.openings.entries()) {
    assert(isRecord(opening), `dataset.openings[${index}] must be an object`);
    assert(
      typeof opening.id === "string" && opening.id.trim().length > 0,
      `dataset.openings[${index}].id is required`,
    );
    if (knownIds && !knownIds.has(opening.id)) {
      warnings.push(`dataset opening "${opening.id}" does not exist in layout`);
    }
    assert(
      opening.numericProperties === undefined || isNumberRecord(opening.numericProperties),
      `dataset.openings[${index}].numericProperties must be a string:number map`,
    );
    assert(
      opening.composition === undefined || isNumberRecord(opening.composition),
      `dataset.openings[${index}].composition must be a string:number map`,
    );
    assert(
      opening.phase === undefined ||
        opening.phase === null ||
        typeof opening.phase === "string" ||
        (Array.isArray(opening.phase) && opening.phase.every((entry) => typeof entry === "string")),
      `dataset.openings[${index}].phase must be a string, string array, or null`,
    );

    datasetById[opening.id] = {
      id: opening.id,
      numericProperties:
        opening.numericProperties && Object.keys(opening.numericProperties).length > 0
          ? { ...opening.numericProperties }
          : {},
      composition:
        opening.composition && Object.keys(opening.composition).length > 0
          ? { ...opening.composition }
          : {},
      phase: normalizePhaseValue(opening.phase),
    };
  }

  return { datasetById, phaseColors, warnings };
};

export const normalizeProject = (input: unknown) => {
  assert(isRecord(input), "project JSON must be an object");
  assert(input.version === 1, "project.version must be 1");
  const layout = normalizeLayout(input.layout);
  const dataset = normalizeDataset(
    input.dataset,
    new Set(layout.openings.map((opening) => opening.id)),
  );
  const view = isRecord(input.view) ? input.view : {};

  return {
    state: {
      ...layout,
      datasetById: dataset.datasetById,
      phaseColors: dataset.phaseColors,
    },
    view: {
      mode:
        view.mode === "numeric" || view.mode === "composition" || view.mode === "phase"
          ? view.mode
          : DEFAULT_VIEW.mode,
      numericKey: typeof view.numericKey === "string" ? view.numericKey : DEFAULT_VIEW.numericKey,
      compositionKey: typeof view.compositionKey === "string" ? view.compositionKey : undefined,
      colorPalette:
        typeof view.colorPalette === "string" && view.colorPalette in contourColorPalettes
          ? view.colorPalette
          : DEFAULT_VIEW.colorPalette,
      compareEnabled: typeof view.compareEnabled === "boolean" ? view.compareEnabled : true,
      compareMode:
        view.compareMode === "numeric" ||
        view.compareMode === "composition" ||
        view.compareMode === "phase"
          ? view.compareMode
          : DEFAULT_VIEW.compareMode,
      compareNumericKey:
        typeof view.compareNumericKey === "string"
          ? view.compareNumericKey
          : DEFAULT_VIEW.compareNumericKey,
      compareCompositionKey:
        typeof view.compareCompositionKey === "string" ? view.compareCompositionKey : undefined,
      compareColorPalette:
        typeof view.compareColorPalette === "string" &&
        view.compareColorPalette in contourColorPalettes
          ? view.compareColorPalette
          : DEFAULT_VIEW.compareColorPalette,
    } satisfies MaskMapProjectView,
    warnings: dataset.warnings,
  };
};

export const mergeLayoutIntoState = (
  currentState: MaskMapEditorState,
  parsedLayout: Pick<
    MaskMapEditorState,
    "layoutName" | "waferSize" | "openings" | "alignmentHoles"
  >,
): MaskMapEditorState => {
  const nextDataset: Record<string, EditableDatasetEntry> = {};
  for (const opening of parsedLayout.openings) {
    nextDataset[opening.id] = currentState.datasetById[opening.id] ?? {
      id: opening.id,
      numericProperties: {},
      composition: {},
      phase: [],
    };
  }

  return {
    ...currentState,
    ...parsedLayout,
    datasetById: nextDataset,
  };
};

export const mergeDatasetIntoState = (
  currentState: MaskMapEditorState,
  dataset: ReturnType<typeof normalizeDataset>,
): { state: MaskMapEditorState; warnings: string[] } => ({
  state: {
    ...currentState,
    datasetById: {
      ...currentState.datasetById,
      ...dataset.datasetById,
    },
    phaseColors: {
      ...currentState.phaseColors,
      ...dataset.phaseColors,
    },
  },
  warnings: dataset.warnings,
});

export const exportLayoutFromState = (state: MaskMapEditorState): WaferMaskLayout => ({
  name: state.layoutName,
  wafer_size: state.waferSize,
  openings: state.openings.map((opening) => ({
    id: opening.id,
    name: opening.name,
    enabled: opening.enabled,
    position: { type: "cartesian", x_mm: round3(opening.xMm), y_mm: round3(opening.yMm) },
    shape:
      opening.shape.type === "circle"
        ? { type: "circle", radius_mm: round3(opening.shape.radius_mm) }
        : {
            type: "rectangle",
            width_mm: round3(opening.shape.width_mm),
            height_mm: round3(opening.shape.height_mm),
            rotation_deg: round3(opening.shape.rotation_deg ?? 0),
          },
  })),
  alignment_holes:
    state.alignmentHoles.length > 0
      ? state.alignmentHoles.map((opening) => ({
          id: opening.id,
          name: opening.name,
          role: opening.role,
          enabled: opening.enabled,
          position: { type: "cartesian", x_mm: round3(opening.xMm), y_mm: round3(opening.yMm) },
          shape:
            opening.shape.type === "circle"
              ? { type: "circle", radius_mm: round3(opening.shape.radius_mm) }
              : {
                  type: "rectangle",
                  width_mm: round3(opening.shape.width_mm),
                  height_mm: round3(opening.shape.height_mm),
                  rotation_deg: round3(opening.shape.rotation_deg ?? 0),
                },
        }))
      : undefined,
});

export const exportDatasetFromState = (state: MaskMapEditorState): MaskMapDataset => ({
  version: 1,
  phases: Object.keys(state.phaseColors).length > 0 ? state.phaseColors : undefined,
  openings: state.openings.map((opening) => {
    const entry = state.datasetById[opening.id] ?? {
      id: opening.id,
      numericProperties: {},
      composition: {},
      phase: [],
    };
    return {
      id: opening.id,
      numericProperties:
        Object.keys(entry.numericProperties).length > 0
          ? sortNumericRecord(entry.numericProperties)
          : undefined,
      composition:
        Object.keys(entry.composition).length > 0
          ? sortNumericRecord(entry.composition)
          : undefined,
      phase:
        entry.phase.length === 0 ? null : entry.phase.length === 1 ? entry.phase[0] : entry.phase,
    };
  }),
});

export const exportProjectFromState = (
  state: MaskMapEditorState,
  view: MaskMapProjectView,
): MaskMapProject => ({
  version: 1,
  layout: exportLayoutFromState(state),
  dataset: exportDatasetFromState(state),
  view,
});

export const collectNumericKeys = (state: MaskMapEditorState) => {
  const keys: string[] = [DEFAULT_NUMERIC_KEY];
  const seen = new Set<string>(keys);
  for (const opening of state.openings) {
    const entry = state.datasetById[opening.id];
    if (!entry) continue;
    for (const key of Object.keys(entry.numericProperties)) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  for (const entry of Object.values(state.datasetById)) {
    for (const key of Object.keys(entry.numericProperties)) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  return keys;
};

export const collectCompositionKeys = (state: MaskMapEditorState) => {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const opening of state.openings) {
    const entry = state.datasetById[opening.id];
    if (!entry) continue;
    for (const key of Object.keys(entry.composition)) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  for (const entry of Object.values(state.datasetById)) {
    for (const key of Object.keys(entry.composition)) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  return keys;
};

export const collectPhases = (state: MaskMapEditorState) => {
  const phases = new Set<string>();
  for (const entry of Object.values(state.datasetById)) {
    for (const phase of entry.phase) {
      phases.add(phase);
    }
  }
  return Array.from(phases).sort((a, b) => a.localeCompare(b));
};

export const getOrCreatePhaseColor = (phase: string, phaseColors: Record<string, string>) => {
  if (phaseColors[phase]) {
    return phaseColors[phase];
  }

  const hash = Array.from(phase).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return DEFAULT_PHASE_COLORS[hash % DEFAULT_PHASE_COLORS.length];
};

export const splitPhaseInput = (value: string) =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index);

export const normalizePhaseValue = (value: unknown) => {
  if (typeof value === "string") {
    return splitPhaseInput(value);
  }
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .flatMap((entry) => splitPhaseInput(entry));
  }
  return [] as string[];
};

export const getOpeningPhaseColors = (
  state: MaskMapEditorState,
  openingId: string,
  palette: ContourColorPalette,
) => {
  const entry = state.datasetById[openingId];
  if (!entry || entry.phase.length === 0) {
    return [];
  }

  const phases = collectPhases(state);
  return entry.phase.map((phase) => {
    if (state.phaseColors[phase]) {
      return state.phaseColors[phase];
    }
    const phaseIndex = Math.max(0, phases.indexOf(phase));
    const amount = phases.length <= 1 ? 1 : phaseIndex / (phases.length - 1);
    return getPaletteColor(palette, amount);
  });
};

export const getPaletteColor = (palette: ContourColorPalette, amount: number) => {
  const colors = contourColorPalettes[palette].colors;
  const clamped = Math.max(0, Math.min(1, amount));
  const scaled = clamped * (colors.length - 1);
  const lowerIndex = Math.floor(scaled);
  const upperIndex = Math.min(colors.length - 1, Math.ceil(scaled));

  if (lowerIndex === upperIndex) {
    return colors[lowerIndex];
  }

  return interpolateColor(colors[lowerIndex], colors[upperIndex], scaled - lowerIndex);
};

export const findOpeningById = (state: MaskMapEditorState, openingId: string | null) =>
  openingId ? (state.openings.find((opening) => opening.id === openingId) ?? null) : null;

export const nextOpeningId = (state: MaskMapEditorState) => {
  const taken = new Set(state.openings.map((opening) => opening.id));
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = String(index);
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  return String(Date.now());
};

export const upsertDatasetEntry = (
  datasetById: Record<string, EditableDatasetEntry>,
  openingId: string,
): Record<string, EditableDatasetEntry> => ({
  ...datasetById,
  [openingId]: datasetById[openingId] ?? {
    id: openingId,
    numericProperties: {},
    composition: {},
    phase: [],
  },
});

export const renameOpeningIdInState = (
  state: MaskMapEditorState,
  previousId: string,
  nextId: string,
): MaskMapEditorState => {
  if (previousId === nextId) {
    return state;
  }

  const openings = state.openings.map((opening) =>
    opening.id === previousId ? { ...opening, id: nextId } : opening,
  );
  const datasetById = { ...state.datasetById };
  if (datasetById[previousId]) {
    datasetById[nextId] = { ...datasetById[previousId], id: nextId };
    delete datasetById[previousId];
  }

  return {
    ...state,
    openings,
    datasetById,
  };
};

export const deleteOpeningFromState = (
  state: MaskMapEditorState,
  openingId: string,
): MaskMapEditorState => {
  const datasetById = { ...state.datasetById };
  delete datasetById[openingId];
  return {
    ...state,
    openings: state.openings.filter((opening) => opening.id !== openingId),
    datasetById,
  };
};

export const round3 = (value: number) => Math.round(value * 1000) / 1000;

export const formatNumber = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value.toFixed(3) : "-";

const sortNumericRecord = (record: Record<string, number>) =>
  Object.fromEntries(
    Object.entries(record)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, round3(value)]),
  );

const findDuplicateId = (ids: string[]) => {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      return id;
    }
    seen.add(id);
  }
  return null;
};

export const getNumericRange = (state: MaskMapEditorState, numericKey: string) => {
  const values = state.openings
    .map((opening) => state.datasetById[opening.id]?.numericProperties[numericKey])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (values.length === 0) {
    return null;
  }

  return {
    min: Math.min(...values),
    max: Math.max(...values),
  };
};

export const getCompositionRange = (state: MaskMapEditorState, compositionKey: string) => {
  const values = state.openings
    .map((opening) => state.datasetById[opening.id]?.composition[compositionKey])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (values.length === 0) {
    return null;
  }

  return {
    min: Math.min(...values),
    max: Math.max(...values),
  };
};

const mixChannel = (start: number, end: number, amount: number) =>
  Math.round(start + (end - start) * amount);

const hexToRgb = (hex: string) => {
  const normalized = hex.replace("#", "");
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : normalized;

  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
};

const rgbToHex = (rgb: { r: number; g: number; b: number }) =>
  `#${rgb.r.toString(16).padStart(2, "0")}${rgb.g.toString(16).padStart(2, "0")}${rgb.b
    .toString(16)
    .padStart(2, "0")}`;

export const interpolateColor = (startHex: string, endHex: string, amount: number) => {
  const start = hexToRgb(startHex);
  const end = hexToRgb(endHex);
  return rgbToHex({
    r: mixChannel(start.r, end.r, amount),
    g: mixChannel(start.g, end.g, amount),
    b: mixChannel(start.b, end.b, amount),
  });
};

export const getOpeningFill = ({
  openingId,
  state,
  mode,
  numericKey,
  compositionKey,
  colorPalette,
}: {
  openingId: string;
  state: MaskMapEditorState;
  mode: MaskMapProjectView["mode"];
  numericKey?: string;
  compositionKey?: string;
  colorPalette?: ContourColorPalette;
}) => {
  const entry = state.datasetById[openingId];
  const disabledFill = "#f4f4f5";
  const palette = colorPalette ?? "turbo";
  if (!entry) {
    return disabledFill;
  }

  if (mode === "phase") {
    if (entry.phase.length === 0) {
      return disabledFill;
    }
    if (entry.phase.length === 1 && state.phaseColors[entry.phase[0]]) {
      return state.phaseColors[entry.phase[0]];
    }
    const phases = collectPhases(state);
    const phaseIndex = Math.max(0, phases.indexOf(entry.phase[0]));
    const amount = phases.length <= 1 ? 1 : phaseIndex / (phases.length - 1);
    return getPaletteColor(palette, amount);
  }

  if (mode === "numeric" && numericKey) {
    const range = getNumericRange(state, numericKey);
    const value = entry.numericProperties[numericKey];
    if (!range || typeof value !== "number") {
      return disabledFill;
    }
    const amount = range.max === range.min ? 1 : (value - range.min) / (range.max - range.min);
    return getPaletteColor(palette, amount);
  }

  if (mode === "composition" && compositionKey) {
    const range = getCompositionRange(state, compositionKey);
    const value = entry.composition[compositionKey];
    if (!range || typeof value !== "number") {
      return disabledFill;
    }
    const amount = range.max === range.min ? 1 : (value - range.min) / (range.max - range.min);
    return getPaletteColor(palette, amount);
  }

  return disabledFill;
};
