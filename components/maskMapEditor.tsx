import { useEffect, useMemo, useRef, useState } from "react";
import { contourColorPalettes, type ContourColorPalette } from "./contourPlot";
import { getWaferSvgPath, WAFER_MAP_PADDING } from "./waferGeometry";
import {
  collectCompositionKeys,
  collectNumericKeys,
  collectPhases,
  createEmptyEditorState,
  DEFAULT_NUMERIC_KEY,
  deleteOpeningFromState,
  exportDatasetFromState,
  exportLayoutFromState,
  exportProjectFromState,
  findOpeningById,
  getOpeningFill,
  getOpeningPhaseColors,
  getOrCreatePhaseColor,
  mergeDatasetIntoState,
  mergeLayoutIntoState,
  nextOpeningId,
  normalizeDataset,
  normalizeLayout,
  normalizeProject,
  renameOpeningIdInState,
  round3,
  splitPhaseInput,
  upsertDatasetEntry,
  WAFER_SIZE_TO_DIAMETER_MM,
} from "./maskMapUtils";
import type {
  EditableDatasetEntry,
  EditableOpening,
  LayoutShape,
  MaskMapEditorState,
  MaskMapProjectView,
} from "./maskMapTypes";

interface MaskMapEditorProps {
  size: number;
}

type ControlsTab = "files" | "view" | "properties" | "preset";
type WaferInteractionMode = "select" | "add" | "delete";
type WaferCanvasId = "primary" | "compare";

const readJsonFile = async (file: File) => JSON.parse(await file.text()) as unknown;
const NOMINAL_WAFER_RADIUS_MM = 50;
const clampCoordinate = (value: number) =>
  Math.max(-NOMINAL_WAFER_RADIUS_MM, Math.min(NOMINAL_WAFER_RADIUS_MM, value));
const isInsideNominalWafer = (x: number, y: number) => Math.hypot(x, y) <= NOMINAL_WAFER_RADIUS_MM;
const GEOMETRY_TOLERANCE_MM = 1e-6;
const getRectangleCorners = (
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  rotationDeg: number,
) => {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const theta = (rotationDeg * Math.PI) / 180;
  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);

  return [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight],
  ].map(([x, y]) => ({
    x: centerX + x * cosTheta - y * sinTheta,
    y: centerY + x * sinTheta + y * cosTheta,
  }));
};
const isOpeningGeometryValid = (opening: EditableOpening) => {
  if (opening.shape.type === "circle") {
    return (
      Math.hypot(opening.xMm, opening.yMm) + opening.shape.radius_mm <=
      NOMINAL_WAFER_RADIUS_MM + GEOMETRY_TOLERANCE_MM
    );
  }

  return getRectangleCorners(
    opening.xMm,
    opening.yMm,
    opening.shape.width_mm,
    opening.shape.height_mm,
    opening.shape.rotation_deg ?? 0,
  ).every((corner) => isInsideNominalWafer(corner.x, corner.y));
};
const blurOnEnter = (
  event: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
) => {
  if (event.key === "Enter") {
    event.currentTarget.blur();
  }
};

const downloadTextFile = (filename: string, content: string, type: string) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

const downloadSvgRoot = (root: SVGSVGElement, filename: string) => {
  const clone = root.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const serialized = new XMLSerializer().serializeToString(clone);
  downloadTextFile(filename, serialized, "image/svg+xml");
};

const downloadPngFromSvg = async (root: SVGSVGElement, filename: string) => {
  const clone = root.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const serialized = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  const image = new Image();
  image.decoding = "async";
  image.src = url;

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("failed to load SVG into image"));
  });

  const viewBox = root.viewBox.baseVal;
  const width = viewBox?.width || root.clientWidth || 1200;
  const height = viewBox?.height || root.clientHeight || 1200;
  const canvas = document.createElement("canvas");
  canvas.width = width * 2;
  canvas.height = height * 2;
  const context = canvas.getContext("2d");
  if (!context) {
    URL.revokeObjectURL(url);
    throw new Error("failed to create canvas context");
  }

  context.scale(2, 2);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  URL.revokeObjectURL(url);

  const pngUrl = canvas.toDataURL("image/png");
  const anchor = document.createElement("a");
  anchor.href = pngUrl;
  anchor.download = filename;
  anchor.click();
};

const ensureDatasetEntry = (state: MaskMapEditorState, openingId: string): EditableDatasetEntry =>
  state.datasetById[openingId] ?? {
    id: openingId,
    numericProperties: {},
    composition: {},
    phase: [],
  };

const openingLabel = (opening: EditableOpening) => opening.name.trim() || opening.id;

const describePhases = (phases: string[]) => phases.join(", ");

const getCircleSectorPath = (
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
) => {
  const startX = cx + radius * Math.cos(startAngle);
  const startY = cy + radius * Math.sin(startAngle);
  const endX = cx + radius * Math.cos(endAngle);
  const endY = cy + radius * Math.sin(endAngle);
  const largeArcFlag = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${startX} ${startY} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${endX} ${endY} Z`;
};

export const MaskMapEditor = ({ size }: MaskMapEditorProps) => {
  const [state, setState] = useState<MaskMapEditorState>(() => createEmptyEditorState());
  const [view, setView] = useState<MaskMapProjectView>({
    mode: "numeric",
    numericKey: DEFAULT_NUMERIC_KEY,
    colorPalette: "turbo",
    compareEnabled: true,
    compareMode: "phase",
    compareNumericKey: DEFAULT_NUMERIC_KEY,
    compareColorPalette: "turbo",
  });
  const [selectedOpeningId, setSelectedOpeningId] = useState<string | null>(null);
  const [messages, setMessages] = useState<{ errors: string[]; warnings: string[] }>({
    errors: [],
    warnings: [],
  });
  const [newNumericKey, setNewNumericKey] = useState("conductivity");
  const [renameNumericKey, setRenameNumericKey] = useState("");
  const [compositionDraftKey, setCompositionDraftKey] = useState("");
  const [compositionDraftValue, setCompositionDraftValue] = useState("");
  const [selectedIdDraft, setSelectedIdDraft] = useState("");
  const [selectedNameDraft, setSelectedNameDraft] = useState("");
  const [selectedXDraft, setSelectedXDraft] = useState("");
  const [selectedYDraft, setSelectedYDraft] = useState("");
  const [selectedShapeTypeDraft, setSelectedShapeTypeDraft] =
    useState<LayoutShape["type"]>("circle");
  const [selectedRadiusDraft, setSelectedRadiusDraft] = useState("");
  const [selectedWidthDraft, setSelectedWidthDraft] = useState("");
  const [selectedHeightDraft, setSelectedHeightDraft] = useState("");
  const [selectedRotationDraft, setSelectedRotationDraft] = useState("");
  const [selectedNumericDrafts, setSelectedNumericDrafts] = useState<Record<string, string>>({});
  const [selectedCompositionDrafts, setSelectedCompositionDrafts] = useState<
    Record<string, string>
  >({});
  const [selectedPhaseDraft, setSelectedPhaseDraft] = useState("");
  const [openingsTableDrafts, setOpeningsTableDrafts] = useState<Record<string, string>>({});
  const [waferInteractionMode, setWaferInteractionMode] = useState<WaferInteractionMode>("select");
  const [hoveredOpeningId, setHoveredOpeningId] = useState<string | null>(null);
  const [hoveredOpeningPosition, setHoveredOpeningPosition] = useState<{
    x: number;
    y: number;
    canvas: WaferCanvasId;
  } | null>(null);
  const [viewModalCanvas, setViewModalCanvas] = useState<WaferCanvasId | null>(null);
  const [numericKeyModalOpen, setNumericKeyModalOpen] = useState(false);
  const [compositionModalOpeningId, setCompositionModalOpeningId] = useState<string | null>(null);
  const [compositionModalDrafts, setCompositionModalDrafts] = useState<Record<string, string>>({});
  const [compositionModalKeyDraft, setCompositionModalKeyDraft] = useState("");
  const [compositionModalValueDraft, setCompositionModalValueDraft] = useState("");
  const [newOpeningShapeType, setNewOpeningShapeType] = useState<LayoutShape["type"]>("circle");
  const [newOpeningCircleRadius, setNewOpeningCircleRadius] = useState("2.5");
  const [newOpeningWidth, setNewOpeningWidth] = useState("4");
  const [newOpeningHeight, setNewOpeningHeight] = useState("4");
  const [newOpeningRotation, setNewOpeningRotation] = useState("0");
  const [activeControlsTab, setActiveControlsTab] = useState<ControlsTab>("files");
  const [openingsCurrentPage, setOpeningsCurrentPage] = useState(1);
  const [openingsJumpPage, setOpeningsJumpPage] = useState("1");
  const [openingsRowsPerPage, setOpeningsRowsPerPage] = useState(20);
  const layoutInputRef = useRef<HTMLInputElement>(null);
  const datasetInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const primaryWaferSvgRef = useRef<SVGSVGElement>(null);
  const secondaryWaferSvgRef = useRef<SVGSVGElement>(null);
  const primaryWaferCanvasRef = useRef<HTMLDivElement>(null);
  const compareWaferCanvasRef = useRef<HTMLDivElement>(null);
  const selectedCompositionSectionRef = useRef<HTMLDivElement>(null);

  const diameter = WAFER_SIZE_TO_DIAMETER_MM[state.waferSize];
  const supportedWafer = state.waferSize === "4inch";
  const waferCanvasSize = Math.round(size * 1);
  const padding = WAFER_MAP_PADDING;
  const displayDiameter = waferCanvasSize - padding * 2;
  const pxPerUnit = displayDiameter / diameter;
  const waferPath = getWaferSvgPath(
    waferCanvasSize / 2,
    waferCanvasSize / 2,
    pxPerUnit,
    pxPerUnit,
    diameter,
  );
  const numericKeys = useMemo(() => collectNumericKeys(state), [state]);
  const compositionKeys = useMemo(() => collectCompositionKeys(state), [state]);
  const phases = useMemo(() => collectPhases(state), [state]);
  const invalidOpeningIds = useMemo(
    () =>
      new Set(
        state.openings
          .filter((opening) => !isOpeningGeometryValid(opening))
          .map((opening) => opening.id),
      ),
    [state.openings],
  );
  const openingsTotalPages = Math.max(1, Math.ceil(state.openings.length / openingsRowsPerPage));
  const safeOpeningsPage = Math.min(openingsCurrentPage, openingsTotalPages);
  const paginatedOpenings = useMemo(() => {
    const start = (safeOpeningsPage - 1) * openingsRowsPerPage;
    return state.openings.slice(start, start + openingsRowsPerPage);
  }, [safeOpeningsPage, openingsRowsPerPage, state.openings]);
  const selectedOpening = useMemo(
    () => findOpeningById(state, selectedOpeningId),
    [state, selectedOpeningId],
  );
  const selectedDataset = selectedOpening ? ensureDatasetEntry(state, selectedOpening.id) : null;
  const hasSelectedOpening = Boolean(selectedOpening && selectedDataset);
  const selectedOpeningRecord: EditableOpening = selectedOpening ?? {
    id: "",
    name: "",
    xMm: 0,
    yMm: 0,
    shape: { type: "circle", radius_mm: 0.1 },
    enabled: false,
  };
  const selectedDatasetRecord: EditableDatasetEntry = selectedDataset ?? {
    id: "",
    numericProperties: {},
    composition: {},
    phase: [],
  };
  const hoveredOpening = useMemo(
    () => findOpeningById(state, hoveredOpeningId),
    [hoveredOpeningId, state],
  );
  const hoveredDataset = hoveredOpening ? ensureDatasetEntry(state, hoveredOpening.id) : null;
  const compositionModalOpening = useMemo(
    () => findOpeningById(state, compositionModalOpeningId),
    [compositionModalOpeningId, state],
  );
  const compositionModalDataset = compositionModalOpening
    ? ensureDatasetEntry(state, compositionModalOpening.id)
    : null;
  const selectedCompositionRows =
    compositionKeys.length > 0 ? compositionKeys : Object.keys(selectedDatasetRecord.composition);
  const compositionModalRows =
    compositionKeys.length > 0
      ? compositionKeys
      : Object.keys(compositionModalDataset?.composition ?? {});

  useEffect(() => {
    if (!selectedOpening || !selectedDataset) {
      setSelectedIdDraft("");
      setSelectedNameDraft("");
      setSelectedXDraft("");
      setSelectedYDraft("");
      setSelectedShapeTypeDraft("circle");
      setSelectedRadiusDraft("");
      setSelectedWidthDraft("");
      setSelectedHeightDraft("");
      setSelectedRotationDraft("");
      setSelectedNumericDrafts({});
      setSelectedCompositionDrafts({});
      setSelectedPhaseDraft("");
      return;
    }

    setSelectedIdDraft(selectedOpening.id);
    setSelectedNameDraft(selectedOpening.name);
    setSelectedXDraft(String(selectedOpening.xMm));
    setSelectedYDraft(String(selectedOpening.yMm));
    setSelectedShapeTypeDraft(selectedOpening.shape.type);
    setSelectedRadiusDraft(
      selectedOpening.shape.type === "circle" ? String(selectedOpening.shape.radius_mm) : "",
    );
    setSelectedWidthDraft(
      selectedOpening.shape.type === "rectangle" ? String(selectedOpening.shape.width_mm) : "",
    );
    setSelectedHeightDraft(
      selectedOpening.shape.type === "rectangle" ? String(selectedOpening.shape.height_mm) : "",
    );
    setSelectedRotationDraft(
      selectedOpening.shape.type === "rectangle"
        ? String(selectedOpening.shape.rotation_deg ?? 0)
        : "0",
    );
    setSelectedNumericDrafts(
      Object.fromEntries(
        Object.entries(selectedDataset.numericProperties).map(([key, value]) => [
          key,
          String(value),
        ]),
      ),
    );
    setSelectedCompositionDrafts(
      Object.fromEntries(
        Object.entries(selectedDataset.composition).map(([key, value]) => [key, String(value)]),
      ),
    );
    setSelectedPhaseDraft(describePhases(selectedDataset.phase));
  }, [selectedDataset, selectedOpening]);

  useEffect(() => {
    if (!compositionModalOpening || !compositionModalDataset) {
      setCompositionModalDrafts({});
      setCompositionModalKeyDraft("");
      setCompositionModalValueDraft("");
      return;
    }

    setCompositionModalDrafts(
      Object.fromEntries(
        Object.entries(compositionModalDataset.composition).map(([key, value]) => [
          key,
          String(value),
        ]),
      ),
    );
    setCompositionModalKeyDraft("");
    setCompositionModalValueDraft("");
  }, [compositionModalDataset, compositionModalOpening]);

  useEffect(() => {
    if (!selectedOpening) return;
    const frame = window.requestAnimationFrame(() => {
      const section = selectedCompositionSectionRef.current;
      if (!section) return;
      const firstEntryInput = section.querySelector<HTMLInputElement>(
        'input[data-composition-entry-input="true"]',
      );
      const addKeyInput = section.querySelector<HTMLInputElement>(
        'input[data-composition-add-key="true"]',
      );
      (firstEntryInput ?? addKeyInput)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedOpening?.id, selectedCompositionRows.length]);

  useEffect(() => {
    if (numericKeyModalOpen) {
      setNewNumericKey("conductivity");
    }
  }, [numericKeyModalOpen]);

  useEffect(() => {
    if (openingsCurrentPage !== safeOpeningsPage) {
      setOpeningsCurrentPage(safeOpeningsPage);
    }
  }, [openingsCurrentPage, safeOpeningsPage]);

  useEffect(() => {
    setOpeningsJumpPage(String(safeOpeningsPage));
  }, [safeOpeningsPage]);

  useEffect(() => {
    setOpeningsTableDrafts({});
  }, [state.openings, view.numericKey]);

  useEffect(() => {
    if (selectedOpeningId && !state.openings.some((opening) => opening.id === selectedOpeningId)) {
      setSelectedOpeningId(null);
    }
  }, [selectedOpeningId, state.openings]);

  useEffect(() => {
    if (numericKeys.length === 0) {
      setView((current) => ({ ...current, numericKey: DEFAULT_NUMERIC_KEY }));
      return;
    }
    if (!view.numericKey || !numericKeys.includes(view.numericKey)) {
      setView((current) => ({ ...current, numericKey: numericKeys[0] }));
    }
  }, [numericKeys, view.numericKey]);

  useEffect(() => {
    if (compositionKeys.length === 0) {
      setView((current) => ({ ...current, compositionKey: undefined }));
      return;
    }
    if (!view.compositionKey || !compositionKeys.includes(view.compositionKey)) {
      setView((current) => ({ ...current, compositionKey: compositionKeys[0] }));
    }
  }, [compositionKeys, view.compositionKey]);

  useEffect(() => {
    if (numericKeys.length === 0) {
      setView((current) => ({ ...current, compareNumericKey: DEFAULT_NUMERIC_KEY }));
      return;
    }
    if (!view.compareNumericKey || !numericKeys.includes(view.compareNumericKey)) {
      setView((current) => ({ ...current, compareNumericKey: numericKeys[0] }));
    }
  }, [numericKeys, view.compareNumericKey]);

  useEffect(() => {
    if (compositionKeys.length === 0) {
      setView((current) => ({ ...current, compareCompositionKey: undefined }));
      return;
    }
    if (!view.compareCompositionKey || !compositionKeys.includes(view.compareCompositionKey)) {
      setView((current) => ({ ...current, compareCompositionKey: compositionKeys[0] }));
    }
  }, [compositionKeys, view.compareCompositionKey]);

  const setError = (error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown error";
    setMessages({ errors: [message], warnings: [] });
  };

  const setWarnings = (warnings: string[]) => {
    setMessages({ errors: [], warnings });
  };

  const updateOpening = (
    openingId: string,
    updater: (opening: EditableOpening) => EditableOpening,
  ) => {
    setState((current) => ({
      ...current,
      openings: current.openings.map((opening) =>
        opening.id === openingId ? updater(opening) : opening,
      ),
    }));
  };

  const updateDataset = (
    openingId: string,
    updater: (entry: EditableDatasetEntry) => EditableDatasetEntry,
  ) => {
    setState((current) => {
      const nextDataset = upsertDatasetEntry(current.datasetById, openingId);
      return {
        ...current,
        datasetById: {
          ...nextDataset,
          [openingId]: updater(nextDataset[openingId]),
        },
      };
    });
  };

  const handleWaferClick = (event: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    if (!supportedWafer) return;

    if (waferInteractionMode === "select") {
      setSelectedOpeningId(null);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const xPx = event.clientX - rect.left;
    const yPx = event.clientY - rect.top;
    const xMm = clampCoordinate((xPx - waferCanvasSize / 2) / pxPerUnit);
    const yMm = clampCoordinate((waferCanvasSize / 2 - yPx) / pxPerUnit);

    if (!isInsideNominalWafer(xMm, yMm)) {
      return;
    }

    const id = nextOpeningId(state);
    const shape: LayoutShape =
      newOpeningShapeType === "circle"
        ? {
            type: "circle",
            radius_mm: Math.max(0.1, Number.parseFloat(newOpeningCircleRadius) || 2.5),
          }
        : {
            type: "rectangle",
            width_mm: Math.max(0.1, Number.parseFloat(newOpeningWidth) || 4),
            height_mm: Math.max(0.1, Number.parseFloat(newOpeningHeight) || 4),
            rotation_deg: Number.parseFloat(newOpeningRotation) || 0,
          };

    setState((current) => ({
      ...current,
      openings: [
        ...current.openings,
        {
          id,
          name: id,
          xMm: round3(clampCoordinate(xMm)),
          yMm: round3(clampCoordinate(yMm)),
          shape,
          enabled: true,
        },
      ],
      datasetById: {
        ...current.datasetById,
        [id]: {
          id,
          numericProperties: view.numericKey ? { [view.numericKey]: 0 } : {},
          composition: {},
          phase: [],
        },
      },
    }));
    setSelectedOpeningId(id);
  };

  const handleImportLayout = async (file: File) => {
    try {
      const parsed = normalizeLayout(await readJsonFile(file));
      setState((current) => mergeLayoutIntoState(current, parsed));
      setWarnings([]);
    } catch (error) {
      setError(error);
    }
  };

  const handleImportDataset = async (file: File) => {
    try {
      const parsed = normalizeDataset(
        await readJsonFile(file),
        new Set(state.openings.map((opening) => opening.id)),
      );
      const merged = mergeDatasetIntoState(state, parsed);
      setState(merged.state);
      setWarnings(merged.warnings);
    } catch (error) {
      setError(error);
    }
  };

  const handleImportProject = async (file: File) => {
    try {
      const parsed = normalizeProject(await readJsonFile(file));
      setState(parsed.state);
      setView(parsed.view);
      setWarnings(parsed.warnings);
    } catch (error) {
      setError(error);
    }
  };

  const handleFileSelection = async (
    event: React.ChangeEvent<HTMLInputElement>,
    callback: (file: File) => Promise<void>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await callback(file);
    event.target.value = "";
  };

  const handleAddNumericKey = () => {
    const key = newNumericKey.trim();
    if (!key) return;
    setState((current) => ({
      ...current,
      datasetById: Object.fromEntries(
        current.openings.map((opening) => {
          const entry = ensureDatasetEntry(current, opening.id);
          return [
            opening.id,
            {
              ...entry,
              numericProperties: {
                ...entry.numericProperties,
                [key]: entry.numericProperties[key] ?? 0,
              },
            },
          ];
        }),
      ),
    }));
    setView((current) => ({ ...current, numericKey: key, mode: "numeric" }));
    setNewNumericKey("conductivity");
  };

  const handleRenameNumericKey = () => {
    const nextKey = renameNumericKey.trim();
    const currentKey = view.numericKey?.trim();
    if (!nextKey || !currentKey || nextKey === currentKey) return;

    setState((current) => ({
      ...current,
      datasetById: Object.fromEntries(
        Object.entries(current.datasetById).map(([openingId, entry]) => {
          const value = entry.numericProperties[currentKey];
          const nextProperties = { ...entry.numericProperties };
          delete nextProperties[currentKey];
          nextProperties[nextKey] = value ?? 0;
          return [openingId, { ...entry, numericProperties: nextProperties }];
        }),
      ),
    }));
    setView((current) => ({ ...current, numericKey: nextKey }));
    setRenameNumericKey("");
  };

  const handleDeleteNumericKey = () => {
    const currentKey = view.numericKey?.trim();
    if (!currentKey) return;
    setState((current) => ({
      ...current,
      datasetById: Object.fromEntries(
        Object.entries(current.datasetById).map(([openingId, entry]) => {
          const nextProperties = { ...entry.numericProperties };
          delete nextProperties[currentKey];
          return [openingId, { ...entry, numericProperties: nextProperties }];
        }),
      ),
    }));
    setView((current) => ({
      ...current,
      numericKey: numericKeys.find((key) => key !== currentKey),
    }));
  };

  const handleExport = (kind: "project" | "layout" | "dataset") => {
    if (kind === "project") {
      downloadTextFile(
        "mask-map-project.json",
        JSON.stringify(exportProjectFromState(state, view), null, 2),
        "application/json",
      );
      return;
    }
    if (kind === "layout") {
      downloadTextFile(
        "wafer-mask-layout.json",
        JSON.stringify(exportLayoutFromState(state), null, 2),
        "application/json",
      );
      return;
    }
    downloadTextFile(
      "mask-map-dataset.json",
      JSON.stringify(exportDatasetFromState(state), null, 2),
      "application/json",
    );
  };

  const handleUpdateSelectedShapeType = (shapeType: LayoutShape["type"]) => {
    if (!selectedOpening) return;
    updateOpening(selectedOpening.id, (opening) => ({
      ...opening,
      shape:
        shapeType === "circle"
          ? {
              type: "circle",
              radius_mm: opening.shape.type === "circle" ? opening.shape.radius_mm : 2.5,
            }
          : {
              type: "rectangle",
              width_mm: opening.shape.type === "rectangle" ? opening.shape.width_mm : 4,
              height_mm: opening.shape.type === "rectangle" ? opening.shape.height_mm : 4,
              rotation_deg:
                opening.shape.type === "rectangle" ? (opening.shape.rotation_deg ?? 0) : 0,
            },
    }));
  };

  const updateOpeningsTableDraft = (key: string, value: string) => {
    setOpeningsTableDrafts((current) => ({ ...current, [key]: value }));
  };

  const clearOpeningsTableDraft = (key: string) => {
    setOpeningsTableDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const getCanvasView = (canvas: WaferCanvasId) => ({
    mode: canvas === "compare" ? (view.compareMode ?? view.mode) : view.mode,
    numericKey: canvas === "compare" ? view.compareNumericKey : view.numericKey,
    compositionKey: canvas === "compare" ? view.compareCompositionKey : view.compositionKey,
    colorPalette:
      canvas === "compare"
        ? ((view.compareColorPalette ?? view.colorPalette ?? "turbo") as ContourColorPalette)
        : ((view.colorPalette ?? "turbo") as ContourColorPalette),
  });

  const renderOpening = (opening: EditableOpening, canvas: WaferCanvasId) => {
    const canvasView = getCanvasView(canvas);
    const x = waferCanvasSize / 2 + opening.xMm * pxPerUnit;
    const y = waferCanvasSize / 2 - opening.yMm * pxPerUnit;
    const fill = getOpeningFill({
      openingId: opening.id,
      state,
      mode: canvasView.mode,
      numericKey: canvasView.numericKey,
      compositionKey: canvasView.compositionKey,
      colorPalette: canvasView.colorPalette,
    });
    const selected = opening.id === selectedOpeningId;
    const hovered = opening.id === hoveredOpeningId;
    const invalid = invalidOpeningIds.has(opening.id);
    const phaseColors =
      canvasView.mode === "phase"
        ? getOpeningPhaseColors(state, opening.id, canvasView.colorPalette)
        : [];
    const commonProps = {
      fill: opening.enabled ? fill : "#f4f4f5",
      stroke: invalid ? "#dc2626" : selected ? "#09090b" : "#52525b",
      strokeWidth: selected ? 2.6 : 1.2,
      opacity: opening.enabled ? 0.95 : 0.45,
      style: hovered
        ? {
            filter:
              "drop-shadow(0 0 3px rgba(24,24,27,0.28)) drop-shadow(0 0 6px rgba(24,24,27,0.12))",
          }
        : undefined,
      onClick: (event: React.MouseEvent<SVGElement, MouseEvent>) => {
        event.stopPropagation();
        if (waferInteractionMode === "delete") {
          setState((current) => deleteOpeningFromState(current, opening.id));
          if (selectedOpeningId === opening.id) {
            setSelectedOpeningId(null);
          }
          setHoveredOpeningId(null);
          setHoveredOpeningPosition(null);
          return;
        }
        setSelectedOpeningId(opening.id);
      },
      onMouseEnter: (event: React.MouseEvent<SVGElement, MouseEvent>) => {
        const containerRect =
          canvas === "compare"
            ? compareWaferCanvasRef.current?.getBoundingClientRect()
            : primaryWaferCanvasRef.current?.getBoundingClientRect();
        setHoveredOpeningId(opening.id);
        setHoveredOpeningPosition(
          containerRect
            ? {
                x: event.clientX - containerRect.left,
                y: event.clientY - containerRect.top,
                canvas,
              }
            : null,
        );
      },
      onMouseMove: (event: React.MouseEvent<SVGElement, MouseEvent>) => {
        const containerRect =
          canvas === "compare"
            ? compareWaferCanvasRef.current?.getBoundingClientRect()
            : primaryWaferCanvasRef.current?.getBoundingClientRect();
        setHoveredOpeningPosition(
          containerRect
            ? {
                x: event.clientX - containerRect.left,
                y: event.clientY - containerRect.top,
                canvas,
              }
            : null,
        );
      },
      onMouseLeave: () => {
        setHoveredOpeningId(null);
        setHoveredOpeningPosition(null);
      },
      className:
        waferInteractionMode === "add"
          ? "cursor-copy"
          : waferInteractionMode === "delete"
            ? "cursor-not-allowed"
            : "cursor-pointer",
    };
    const segmentProps = {
      opacity: opening.enabled ? 0.95 : 0.45,
      style: commonProps.style,
      onClick: commonProps.onClick,
      onMouseEnter: commonProps.onMouseEnter,
      onMouseMove: commonProps.onMouseMove,
      onMouseLeave: commonProps.onMouseLeave,
      className: commonProps.className,
    };

    return (
      <g key={opening.id}>
        {opening.shape.type === "circle" ? (
          (() => {
            const circleRadius = opening.shape.radius_mm * pxPerUnit;
            return phaseColors.length > 1 ? (
              <>
                {phaseColors.length === 2
                  ? [
                      <path
                        key={`${opening.id}-phase-left`}
                        d={getCircleSectorPath(x, y, circleRadius, Math.PI / 2, (Math.PI * 3) / 2)}
                        fill={phaseColors[0]}
                        stroke="none"
                        {...segmentProps}
                      />,
                      <path
                        key={`${opening.id}-phase-right`}
                        d={getCircleSectorPath(x, y, circleRadius, -Math.PI / 2, Math.PI / 2)}
                        fill={phaseColors[1]}
                        stroke="none"
                        {...segmentProps}
                      />,
                    ]
                  : phaseColors.length === 4
                    ? [
                        <path
                          key={`${opening.id}-phase-q1`}
                          d={getCircleSectorPath(x, y, circleRadius, -Math.PI, -Math.PI / 2)}
                          fill={phaseColors[0]}
                          stroke="none"
                          {...segmentProps}
                        />,
                        <path
                          key={`${opening.id}-phase-q2`}
                          d={getCircleSectorPath(x, y, circleRadius, -Math.PI / 2, 0)}
                          fill={phaseColors[1]}
                          stroke="none"
                          {...segmentProps}
                        />,
                        <path
                          key={`${opening.id}-phase-q3`}
                          d={getCircleSectorPath(x, y, circleRadius, Math.PI / 2, Math.PI)}
                          fill={phaseColors[2]}
                          stroke="none"
                          {...segmentProps}
                        />,
                        <path
                          key={`${opening.id}-phase-q4`}
                          d={getCircleSectorPath(x, y, circleRadius, 0, Math.PI / 2)}
                          fill={phaseColors[3]}
                          stroke="none"
                          {...segmentProps}
                        />,
                      ]
                    : phaseColors.map((color, index) => {
                        const startAngle =
                          -Math.PI / 2 + (index / phaseColors.length) * Math.PI * 2;
                        const endAngle =
                          -Math.PI / 2 + ((index + 1) / phaseColors.length) * Math.PI * 2;
                        return (
                          <path
                            key={`${opening.id}-phase-${index + 1}`}
                            d={getCircleSectorPath(x, y, circleRadius, startAngle, endAngle)}
                            fill={color}
                            stroke="none"
                            {...segmentProps}
                          />
                        );
                      })}
                <circle
                  cx={x}
                  cy={y}
                  r={circleRadius}
                  fill="none"
                  stroke={invalid ? "#dc2626" : selected ? "#09090b" : "#52525b"}
                  strokeWidth={selected ? 2.6 : 1.2}
                  opacity={opening.enabled ? 0.95 : 0.45}
                  style={commonProps.style}
                  onClick={commonProps.onClick}
                  onMouseEnter={commonProps.onMouseEnter}
                  onMouseMove={commonProps.onMouseMove}
                  onMouseLeave={commonProps.onMouseLeave}
                  className={commonProps.className}
                />
              </>
            ) : (
              <circle cx={x} cy={y} r={circleRadius} {...commonProps} />
            );
          })()
        ) : (
          <rect
            x={x - (opening.shape.width_mm * pxPerUnit) / 2}
            y={y - (opening.shape.height_mm * pxPerUnit) / 2}
            width={opening.shape.width_mm * pxPerUnit}
            height={opening.shape.height_mm * pxPerUnit}
            transform={`rotate(${-(opening.shape.rotation_deg ?? 0)} ${x} ${y})`}
            {...commonProps}
          />
        )}
        {selected ? (
          <text x={x + 8} y={y - 8} fontSize="11" fill="#111827">
            {openingLabel(opening)}
          </text>
        ) : null}
      </g>
    );
  };

  const rulerLines = Array.from({ length: Math.floor(diameter / 10) + 1 }, (_, index) => {
    const value = -diameter / 2 + index * 10;
    return value <= diameter / 2 ? value : null;
  }).filter((value): value is number => value !== null);
  const rulerLabels = rulerLines.filter((value) => value > -diameter / 2 && value < diameter / 2);
  const primaryCanvasView = getCanvasView("primary");
  const compareCanvasView = getCanvasView("compare");

  const renderCanvasSubtitle = (canvas: WaferCanvasId) => {
    const canvasView = canvas === "compare" ? compareCanvasView : primaryCanvasView;
    if (canvasView.mode === "numeric") return canvasView.numericKey ?? "numeric";
    if (canvasView.mode === "composition") return canvasView.compositionKey ?? "composition";
    return "phase";
  };

  const renderCanvasViewSettings = (canvas: WaferCanvasId) => {
    const isCompare = canvas === "compare";
    const paletteValue = isCompare
      ? ((view.compareColorPalette ?? "turbo") as ContourColorPalette)
      : ((view.colorPalette ?? "turbo") as ContourColorPalette);
    const modeValue = isCompare ? (view.compareMode ?? "numeric") : view.mode;
    const numericKeyValue = isCompare ? (view.compareNumericKey ?? "") : (view.numericKey ?? "");
    const compositionKeyValue = isCompare
      ? (view.compareCompositionKey ?? "")
      : (view.compositionKey ?? "");

    return (
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm text-zinc-700">
            {isCompare ? "Secondary mode" : "Mode"}
          </label>
          <select
            value={modeValue}
            onChange={(event) =>
              setView((current) => ({
                ...current,
                ...(isCompare
                  ? { compareMode: event.target.value as MaskMapProjectView["mode"] }
                  : { mode: event.target.value as MaskMapProjectView["mode"] }),
              }))
            }
            className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-black"
          >
            <option value="numeric">Numeric</option>
            <option value="composition">Composition</option>
            <option value="phase">Phase</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm text-zinc-700">
            {isCompare ? "Secondary numeric key" : "Numeric key"}
          </label>
          <select
            value={numericKeyValue}
            onChange={(event) =>
              setView((current) => ({
                ...current,
                ...(isCompare
                  ? { compareNumericKey: event.target.value }
                  : { numericKey: event.target.value }),
              }))
            }
            className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-black"
          >
            <option value="">No numeric key</option>
            {numericKeys.map((key) => (
              <option key={`${canvas}-numeric-${key}`} value={key}>
                {key}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm text-zinc-700">
            {isCompare ? "Secondary composition key" : "Composition key"}
          </label>
          <select
            value={compositionKeyValue}
            onChange={(event) =>
              setView((current) => ({
                ...current,
                ...(isCompare
                  ? { compareCompositionKey: event.target.value || undefined }
                  : { compositionKey: event.target.value || undefined }),
              }))
            }
            className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-black"
          >
            <option value="">No composition key</option>
            {compositionKeys.map((key) => (
              <option key={`${canvas}-composition-${key}`} value={key}>
                {key}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm text-zinc-700">
            {isCompare ? "Secondary color palette" : "Color palette"}
          </label>
          <select
            value={paletteValue}
            onChange={(event) =>
              setView((current) => ({
                ...current,
                ...(isCompare
                  ? { compareColorPalette: event.target.value as ContourColorPalette }
                  : { colorPalette: event.target.value as ContourColorPalette }),
              }))
            }
            className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-black"
          >
            {Object.entries(contourColorPalettes).map(([key, palette]) => (
              <option key={`${canvas}-palette-${key}`} value={key}>
                {palette.label}
              </option>
            ))}
          </select>
        </div>
        <div
          className="h-3 rounded"
          style={{
            background: contourColorPalettes[paletteValue].gradient,
          }}
        />
      </div>
    );
  };

  const renderWaferCanvas = (canvas: WaferCanvasId) => {
    const isCompare = canvas === "compare";
    const hoveredHere =
      hoveredOpening && hoveredDataset && hoveredOpeningPosition?.canvas === canvas;
    const canvasRef = isCompare ? compareWaferCanvasRef : primaryWaferCanvasRef;
    const svgRef = isCompare ? secondaryWaferSvgRef : primaryWaferSvgRef;
    const tooltipContainerWidth = canvasRef.current?.clientWidth ?? waferCanvasSize;
    const tooltipContainerHeight = canvasRef.current?.clientHeight ?? waferCanvasSize;

    return (
      <div key={canvas} className="flex-1">
        <div className="mb-2 flex items-center justify-between px-1 text-xs uppercase tracking-[0.18em] text-zinc-500">
          <span>{isCompare ? "Secondary" : "Primary"}</span>
          <button
            type="button"
            onClick={() => setViewModalCanvas(canvas)}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium tracking-[0.18em] text-zinc-600 shadow-sm transition-colors hover:border-zinc-300 hover:bg-zinc-100 hover:text-zinc-800"
          >
            {renderCanvasSubtitle(canvas)}
            <span aria-hidden="true" className="text-zinc-400">
              ▾
            </span>
          </button>
        </div>
        <div
          ref={canvasRef}
          className="relative flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-2 py-6"
        >
          <svg
            ref={svgRef}
            width={waferCanvasSize}
            height={waferCanvasSize}
            viewBox={`0 0 ${waferCanvasSize} ${waferCanvasSize}`}
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            onClick={handleWaferClick}
            className={
              waferInteractionMode === "add"
                ? "cursor-crosshair"
                : waferInteractionMode === "delete"
                  ? "cursor-not-allowed"
                  : "cursor-default"
            }
          >
            <rect width={waferCanvasSize} height={waferCanvasSize} fill="#fbfdff" />
            <defs>
              <clipPath id={`mask-map-wafer-clip-${canvas}`} clipPathUnits="userSpaceOnUse">
                <path d={waferPath} />
              </clipPath>
            </defs>
            <path d={waferPath} fill="#ffffff" stroke="#111827" strokeWidth="1.2" />
            {rulerLines.map((value) => {
              const x = waferCanvasSize / 2 + value * pxPerUnit;
              return (
                <line
                  key={`${canvas}-grid-x-${value}`}
                  x1={x}
                  y1={0}
                  x2={x}
                  y2={waferCanvasSize}
                  stroke={value === 0 ? "#9ca3af" : "#e4e4e7"}
                  strokeWidth={value === 0 ? "1.2" : "0.8"}
                />
              );
            })}
            {rulerLines.map((value) => {
              const y = waferCanvasSize / 2 - value * pxPerUnit;
              return (
                <line
                  key={`${canvas}-grid-y-${value}`}
                  x1={0}
                  y1={y}
                  x2={waferCanvasSize}
                  y2={y}
                  stroke={value === 0 ? "#9ca3af" : "#e4e4e7"}
                  strokeWidth={value === 0 ? "1.2" : "0.8"}
                />
              );
            })}
            <g>
              {rulerLabels.map((value) => {
                const x = waferCanvasSize / 2 + value * pxPerUnit;
                return (
                  <g key={`${canvas}-ruler-x-${value}`}>
                    <line
                      x1={x}
                      y1={waferCanvasSize - 18}
                      x2={x}
                      y2={waferCanvasSize - 12}
                      stroke="#71717a"
                      strokeWidth="0.8"
                    />
                    <text
                      x={x}
                      y={waferCanvasSize - 2}
                      fontSize="9"
                      fill="#71717a"
                      textAnchor="middle"
                    >
                      {value}
                    </text>
                  </g>
                );
              })}
              {rulerLabels.map((value) => {
                const y = waferCanvasSize / 2 - value * pxPerUnit;
                return (
                  <g key={`${canvas}-ruler-y-${value}`}>
                    <line x1={12} y1={y} x2={18} y2={y} stroke="#71717a" strokeWidth="0.8" />
                    <text x={14} y={y + 3} fontSize="9" fill="#71717a" textAnchor="end">
                      {value}
                    </text>
                  </g>
                );
              })}
            </g>
            <g clipPath={`url(#mask-map-wafer-clip-${canvas})`}>
              {[
                ...state.openings.filter((opening) => opening.id !== selectedOpeningId),
                ...state.openings.filter((opening) => opening.id === selectedOpeningId),
              ].map((opening) => renderOpening(opening, canvas))}
            </g>
            <path d={waferPath} fill="none" stroke="#111827" strokeWidth="1.2" />
            <text x={22} y={22} fontSize="11" fill="#18181b">
              ↑ y (mm)
            </text>
            <text
              x={waferCanvasSize - 14}
              y={waferCanvasSize - 22}
              fontSize="11"
              fill="#18181b"
              textAnchor="end"
            >
              x (mm) →
            </text>
            {state.alignmentHoles
              .filter((opening) => opening.enabled)
              .map((opening) => {
                const x = waferCanvasSize / 2 + opening.xMm * pxPerUnit;
                const y = waferCanvasSize / 2 - opening.yMm * pxPerUnit;
                return (
                  <circle
                    key={`${canvas}-${opening.id}`}
                    cx={x}
                    cy={y}
                    r="3"
                    fill="#18181b"
                    opacity="0.55"
                  />
                );
              })}
          </svg>
          {hoveredHere ? (
            <div
              className="pointer-events-none absolute z-10 max-w-80 rounded-xl border border-zinc-300 bg-white/50 px-3 py-2 text-sm text-zinc-900 shadow-lg backdrop-blur-sm"
              style={{
                left: Math.max(
                  12,
                  Math.min(hoveredOpeningPosition.x + 12, tooltipContainerWidth - 248),
                ),
                top: Math.max(
                  12,
                  Math.min(hoveredOpeningPosition.y + 12, tooltipContainerHeight - 24),
                ),
              }}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-medium">{openingLabel(hoveredOpening)}</span>
                <span className="text-xs text-zinc-600">{hoveredOpening.id}</span>
              </div>
              <div className="space-y-1 text-xs">
                <p>
                  x: {round3(hoveredOpening.xMm)}, y: {round3(hoveredOpening.yMm)}
                </p>
                <div>
                  <p className="font-medium">Numeric</p>
                  {Object.keys(hoveredDataset.numericProperties).length > 0 ? (
                    Object.entries(hoveredDataset.numericProperties).map(([key, value]) => (
                      <p key={`${hoveredOpening.id}-${canvas}-tooltip-numeric-${key}`}>
                        {key}: {round3(value)}
                      </p>
                    ))
                  ) : (
                    <p>-</p>
                  )}
                </div>
                <div>
                  <p className="font-medium">Composition</p>
                  {Object.keys(hoveredDataset.composition).length > 0 ? (
                    Object.entries(hoveredDataset.composition).map(([key, value]) => (
                      <p key={`${hoveredOpening.id}-${canvas}-tooltip-composition-${key}`}>
                        {key}: {round3(value)}
                      </p>
                    ))
                  ) : (
                    <p>-</p>
                  )}
                </div>
                <div>
                  <p className="font-medium">Phase</p>
                  <p>
                    {hoveredDataset.phase.length > 0 ? describePhases(hoveredDataset.phase) : "-"}
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)] xl:grid-rows-[minmax(800px,auto)_minmax(320px,auto)]">
      <div className="flex flex-col rounded-2xl border border-zinc-300 bg-zinc-50 p-4 xl:col-start-1 xl:row-start-1">
        <div className="mb-3 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-600">
              Wafer Map
            </h2>
          </div>
          <div className="text-right text-sm text-zinc-600">
            <p>{state.layoutName}</p>
            <p>{state.waferSize}</p>
          </div>
        </div>
        {!supportedWafer ? (
          <div className="flex h-[520px] items-center justify-center rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
            Current editor rendering is standardized to the existing 4-inch wafer view. Load or save
            data is preserved, but visual editing is limited to `4inch` for now.
          </div>
        ) : (
          <div className="flex flex-1 items-center overflow-x-auto gap-1">
            {renderWaferCanvas("primary")}
            {renderWaferCanvas("compare")}
          </div>
        )}
        <div className="mt-3 flex flex-col items-start gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Interaction Mode
          </p>
          <div role="tablist" aria-label="Wafer interaction mode" className="flex flex-row gap-2">
            {[
              ["select", "Select"],
              ["add", "Add"],
              ["delete", "Delete"],
            ].map(([key, label]) => {
              const isActive = waferInteractionMode === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setWaferInteractionMode(key as WaferInteractionMode)}
                  className={`min-w-20 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? "border-zinc-900 bg-zinc-900 text-white"
                      : "border-zinc-300 bg-white text-black hover:bg-zinc-100"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p className="text-sm text-zinc-600">
            {waferInteractionMode === "add"
              ? "Click the wafer to add a new opening using the current shape preset."
              : waferInteractionMode === "delete"
                ? "Click an opening to delete it."
                : "Click an opening to select it. Click empty wafer space to clear the active selection."}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-300 bg-zinc-50 p-4 xl:col-start-1 xl:row-start-2">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-600">
            Openings
          </h2>
          <span className="text-sm text-zinc-600">{state.openings.length} items</span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-zinc-200 bg-white">
          <table className="min-w-full border-collapse text-sm text-black">
            <thead className="sticky top-0 bg-zinc-100">
              <tr>
                <th className="border-b border-zinc-200 px-2 py-2 text-left">ID</th>
                <th className="border-b border-zinc-200 px-2 py-2 text-left">Name</th>
                <th className="border-b border-zinc-200 px-2 py-2 text-left">x</th>
                <th className="border-b border-zinc-200 px-2 py-2 text-left">y</th>
                <th className="border-b border-zinc-200 px-2 py-2 text-left">Composition</th>
                {numericKeys.map((key) => (
                  <th
                    key={`numeric-header-${key}`}
                    className="border-b border-zinc-200 px-2 py-2 text-left"
                  >
                    {key}
                  </th>
                ))}
                <th className="border-b border-zinc-200 px-2 py-2 text-left">Phase</th>
                <th className="border-b border-zinc-200 px-2 py-2 text-left">Status</th>
                <th className="border-b border-zinc-200 px-2 py-2 text-left">Delete</th>
              </tr>
            </thead>
            <tbody>
              {paginatedOpenings.map((opening) => {
                const entry = ensureDatasetEntry(state, opening.id);
                const invalid = invalidOpeningIds.has(opening.id);
                const idDraftKey = `${opening.id}-id`;
                const nameDraftKey = `${opening.id}-name`;
                const xDraftKey = `${opening.id}-x`;
                const yDraftKey = `${opening.id}-y`;
                const phaseDraftKey = `${opening.id}-phase`;
                return (
                  <tr
                    key={opening.id}
                    className={`hover:bg-zinc-50 ${opening.id === selectedOpeningId ? "bg-zinc-50" : ""} ${invalid ? "bg-red-50/60" : ""}`}
                    onClick={() => setSelectedOpeningId(opening.id)}
                  >
                    <td className="border-b border-zinc-100 px-2 py-1">
                      <input
                        type="text"
                        value={openingsTableDrafts[idDraftKey] ?? opening.id}
                        onChange={(event) =>
                          updateOpeningsTableDraft(idDraftKey, event.target.value)
                        }
                        onKeyDown={blurOnEnter}
                        onBlur={() => {
                          const nextId = (openingsTableDrafts[idDraftKey] ?? opening.id).trim();
                          clearOpeningsTableDraft(idDraftKey);
                          if (!nextId || nextId === opening.id) return;
                          if (state.openings.some((item) => item.id === nextId)) return;
                          setState((current) =>
                            renameOpeningIdInState(current, opening.id, nextId),
                          );
                          if (selectedOpeningId === opening.id) {
                            setSelectedOpeningId(nextId);
                          }
                        }}
                        onClick={(event) => event.stopPropagation()}
                        className="w-24 rounded border border-zinc-300 bg-white px-2 py-1 font-medium text-black"
                      />
                    </td>
                    <td className="border-b border-zinc-100 px-2 py-1">
                      <input
                        type="text"
                        value={openingsTableDrafts[nameDraftKey] ?? openingLabel(opening)}
                        onChange={(event) =>
                          updateOpeningsTableDraft(nameDraftKey, event.target.value)
                        }
                        onKeyDown={blurOnEnter}
                        onBlur={() => {
                          updateOpening(opening.id, (current) => ({
                            ...current,
                            name: openingsTableDrafts[nameDraftKey] ?? opening.name,
                          }));
                          clearOpeningsTableDraft(nameDraftKey);
                        }}
                        onClick={(event) => event.stopPropagation()}
                        className="w-28 rounded border border-zinc-300 bg-white px-2 py-1 text-black"
                      />
                    </td>
                    <td className="border-b border-zinc-100 px-2 py-1">
                      <input
                        type="number"
                        step="0.001"
                        value={openingsTableDrafts[xDraftKey] ?? String(opening.xMm)}
                        onChange={(event) =>
                          updateOpeningsTableDraft(xDraftKey, event.target.value)
                        }
                        onKeyDown={blurOnEnter}
                        onBlur={() => {
                          updateOpening(opening.id, (current) => ({
                            ...current,
                            xMm: round3(
                              clampCoordinate(
                                Number.parseFloat(
                                  openingsTableDrafts[xDraftKey] ?? String(opening.xMm),
                                ) || 0,
                              ),
                            ),
                          }));
                          clearOpeningsTableDraft(xDraftKey);
                        }}
                        onClick={(event) => event.stopPropagation()}
                        className="w-24 rounded border border-zinc-300 bg-white px-2 py-1 text-black"
                      />
                    </td>
                    <td className="border-b border-zinc-100 px-2 py-1">
                      <input
                        type="number"
                        step="0.001"
                        value={openingsTableDrafts[yDraftKey] ?? String(opening.yMm)}
                        onChange={(event) =>
                          updateOpeningsTableDraft(yDraftKey, event.target.value)
                        }
                        onKeyDown={blurOnEnter}
                        onBlur={() => {
                          updateOpening(opening.id, (current) => ({
                            ...current,
                            yMm: round3(
                              clampCoordinate(
                                Number.parseFloat(
                                  openingsTableDrafts[yDraftKey] ?? String(opening.yMm),
                                ) || 0,
                              ),
                            ),
                          }));
                          clearOpeningsTableDraft(yDraftKey);
                        }}
                        onClick={(event) => event.stopPropagation()}
                        className="w-24 rounded border border-zinc-300 bg-white px-2 py-1 text-black"
                      />
                    </td>
                    <td className="border-b border-zinc-100 px-2 py-1">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedOpeningId(opening.id);
                          setCompositionModalOpeningId(opening.id);
                        }}
                        className="flex min-h-10 w-full items-center rounded border border-zinc-200 bg-white px-2 py-1 text-left transition-colors hover:bg-zinc-50"
                      >
                        {Object.keys(entry.composition).length === 0 ? (
                          <span className="text-zinc-400">Open</span>
                        ) : (
                          <div className="max-w-56 overflow-hidden text-ellipsis whitespace-nowrap text-sm text-zinc-800">
                            {Object.entries(entry.composition).map(([key, value]) => (
                              <span key={`${opening.id}-composition-summary-${key}`}>
                                {key}
                                <sub className="text-[0.72em]">{round3(value)}</sub>
                              </span>
                            ))}
                          </div>
                        )}
                      </button>
                    </td>
                    {numericKeys.map((key) => {
                      const numericDraftKey = `${opening.id}-numeric-${key}`;
                      return (
                        <td
                          key={`${opening.id}-numeric-cell-${key}`}
                          className="border-b border-zinc-100 px-2 py-1"
                        >
                          <input
                            type="number"
                            step="0.001"
                            value={
                              openingsTableDrafts[numericDraftKey] ??
                              String(entry.numericProperties[key] ?? "")
                            }
                            onChange={(event) =>
                              updateOpeningsTableDraft(numericDraftKey, event.target.value)
                            }
                            onKeyDown={blurOnEnter}
                            onBlur={() => {
                              updateDataset(opening.id, (current) => ({
                                ...current,
                                numericProperties: {
                                  ...current.numericProperties,
                                  [key]:
                                    (openingsTableDrafts[numericDraftKey] ?? "") === ""
                                      ? 0
                                      : Number.parseFloat(
                                          openingsTableDrafts[numericDraftKey] ?? "",
                                        ) || 0,
                                },
                              }));
                              clearOpeningsTableDraft(numericDraftKey);
                            }}
                            onClick={(event) => event.stopPropagation()}
                            className="w-28 rounded border border-zinc-300 bg-white px-2 py-1 text-black"
                          />
                        </td>
                      );
                    })}
                    <td className="border-b border-zinc-100 px-2 py-1">
                      <input
                        type="text"
                        value={openingsTableDrafts[phaseDraftKey] ?? describePhases(entry.phase)}
                        onChange={(event) =>
                          updateOpeningsTableDraft(phaseDraftKey, event.target.value)
                        }
                        onKeyDown={blurOnEnter}
                        onBlur={() => {
                          updateDataset(opening.id, (current) => ({
                            ...current,
                            phase: splitPhaseInput(
                              openingsTableDrafts[phaseDraftKey] ?? describePhases(entry.phase),
                            ),
                          }));
                          clearOpeningsTableDraft(phaseDraftKey);
                        }}
                        onClick={(event) => event.stopPropagation()}
                        placeholder="A, B, C"
                        className="w-28 rounded border border-zinc-300 bg-white px-2 py-1 text-black"
                      />
                    </td>
                    <td className="border-b border-zinc-100 px-2 py-1">
                      <span
                        className={`inline-flex rounded-full border px-2 py-1 text-xs ${
                          invalid
                            ? "border-red-300 bg-red-50 text-red-700"
                            : "border-emerald-300 bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {invalid ? "Invalid" : "Valid"}
                      </span>
                    </td>
                    <td className="border-b border-zinc-100 px-2 py-1">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setState((current) => deleteOpeningFromState(current, opening.id));
                          if (selectedOpeningId === opening.id) {
                            setSelectedOpeningId(null);
                          }
                        }}
                        className="rounded border border-red-300 bg-red-50 px-2 py-1 text-red-700"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center justify-between text-sm text-zinc-700">
          <span>
            {state.openings.length === 0
              ? "0 / 0"
              : `${(safeOpeningsPage - 1) * openingsRowsPerPage + 1}-${Math.min(safeOpeningsPage * openingsRowsPerPage, state.openings.length)} / ${state.openings.length}`}
          </span>
          <div className="flex items-center gap-2">
            <select
              value={String(openingsRowsPerPage)}
              onChange={(event) => {
                setOpeningsRowsPerPage(Number.parseInt(event.target.value, 10));
                setOpeningsCurrentPage(1);
              }}
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-black"
            >
              {[10, 20, 50, 100].map((value) => (
                <option key={value} value={value}>
                  {value} / page
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setOpeningsCurrentPage((page) => Math.max(1, page - 1))}
              disabled={safeOpeningsPage === 1}
              className="rounded border border-zinc-300 bg-white px-2 py-1 disabled:opacity-40"
            >
              Prev
            </button>
            <span>
              {safeOpeningsPage} / {openingsTotalPages}
            </span>
            <button
              type="button"
              onClick={() =>
                setOpeningsCurrentPage((page) => Math.min(openingsTotalPages, page + 1))
              }
              disabled={safeOpeningsPage === openingsTotalPages}
              className="rounded border border-zinc-300 bg-white px-2 py-1 disabled:opacity-40"
            >
              Next
            </button>
            <input
              type="number"
              min="1"
              max={openingsTotalPages}
              value={openingsJumpPage}
              onChange={(event) => setOpeningsJumpPage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  const page = Math.min(
                    openingsTotalPages,
                    Math.max(1, Number.parseInt(openingsJumpPage, 10) || 1),
                  );
                  setOpeningsCurrentPage(page);
                }
              }}
              className="w-14 rounded border border-zinc-300 bg-white px-2 py-1 text-right text-black outline-none focus:ring-2 focus:ring-zinc-300"
            />
            <button
              type="button"
              onClick={() => {
                const page = Math.min(
                  openingsTotalPages,
                  Math.max(1, Number.parseInt(openingsJumpPage, 10) || 1),
                );
                setOpeningsCurrentPage(page);
              }}
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-black transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
            >
              Go
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-300 bg-zinc-50 p-4 xl:col-start-2 xl:row-start-1">
        <div className="mb-3 flex min-h-7 items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-600">
            Selected Opening
          </h2>
          <div
            className={`flex min-h-7 items-center gap-2 text-sm ${selectedOpening ? "" : "invisible"}`}
          >
            {selectedOpening ? (
              <>
                <span
                  className={`rounded-full border px-2 py-0.5 ${
                    invalidOpeningIds.has(selectedOpening.id)
                      ? "border-red-300 bg-red-50 text-red-700"
                      : "border-emerald-300 bg-emerald-50 text-emerald-700"
                  }`}
                >
                  {invalidOpeningIds.has(selectedOpening.id) ? "Invalid" : "Valid"}
                </span>
                <span className="text-zinc-600">{selectedOpening.id}</span>
              </>
            ) : (
              <>
                <span className="rounded-full border px-2 py-0.5">Valid</span>
                <span>0</span>
              </>
            )}
          </div>
        </div>
        <div className="space-y-3">
          <fieldset disabled={!hasSelectedOpening} className="space-y-3 disabled:opacity-60">
            {hasSelectedOpening && invalidOpeningIds.has(selectedOpeningRecord.id) ? (
              <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
                This opening extends outside the nominal 4-inch wafer boundary. Adjust its size or
                position until the full outline fits inside the wafer.
              </div>
            ) : null}
            <section className="rounded-xl border border-zinc-200 bg-white p-4">
              <p className="mb-3 text-sm font-medium text-black">Geometry</p>
              <div className="grid gap-2 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm text-zinc-700">ID</label>
                  <input
                    type="text"
                    value={selectedIdDraft}
                    onChange={(event) => setSelectedIdDraft(event.target.value)}
                    onKeyDown={blurOnEnter}
                    onBlur={() => {
                      if (!selectedOpening) return;
                      const nextId = selectedIdDraft.trim();
                      if (!nextId) return;
                      if (
                        nextId !== selectedOpeningRecord.id &&
                        state.openings.some((opening) => opening.id === nextId)
                      ) {
                        setSelectedIdDraft(selectedOpeningRecord.id);
                        return;
                      }
                      setState((current) =>
                        renameOpeningIdInState(current, selectedOpeningRecord.id, nextId),
                      );
                      setSelectedOpeningId(nextId);
                    }}
                    className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-black"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-zinc-700">Name</label>
                  <input
                    type="text"
                    value={selectedNameDraft}
                    onChange={(event) => setSelectedNameDraft(event.target.value)}
                    onKeyDown={blurOnEnter}
                    onBlur={() => {
                      if (!selectedOpening) return;
                      updateOpening(selectedOpening.id, (opening) => ({
                        ...opening,
                        name: selectedNameDraft,
                      }));
                    }}
                    className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-black"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-zinc-700">X (mm)</label>
                  <input
                    type="number"
                    step="0.001"
                    value={selectedXDraft}
                    onChange={(event) => setSelectedXDraft(event.target.value)}
                    onKeyDown={blurOnEnter}
                    onBlur={() => {
                      if (!selectedOpening) return;
                      updateOpening(selectedOpening.id, (opening) => ({
                        ...opening,
                        xMm: round3(clampCoordinate(Number.parseFloat(selectedXDraft) || 0)),
                      }));
                    }}
                    className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-black"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-zinc-700">Y (mm)</label>
                  <input
                    type="number"
                    step="0.001"
                    value={selectedYDraft}
                    onChange={(event) => setSelectedYDraft(event.target.value)}
                    onKeyDown={blurOnEnter}
                    onBlur={() => {
                      if (!selectedOpening) return;
                      updateOpening(selectedOpening.id, (opening) => ({
                        ...opening,
                        yMm: round3(clampCoordinate(Number.parseFloat(selectedYDraft) || 0)),
                      }));
                    }}
                    className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-black"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-zinc-700">Shape</label>
                  <select
                    value={selectedShapeTypeDraft}
                    onChange={(event) => {
                      if (!selectedOpening) return;
                      const nextShapeType = event.target.value as LayoutShape["type"];
                      setSelectedShapeTypeDraft(nextShapeType);
                      handleUpdateSelectedShapeType(nextShapeType);
                    }}
                    onKeyDown={blurOnEnter}
                    className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-black"
                  >
                    <option value="circle">Circle</option>
                    <option value="rectangle">Rectangle</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm text-zinc-700">
                    <input
                      type="checkbox"
                      checked={selectedOpeningRecord.enabled}
                      onChange={(event) =>
                        selectedOpening
                          ? updateOpening(selectedOpening.id, (opening) => ({
                              ...opening,
                              enabled: event.target.checked,
                            }))
                          : undefined
                      }
                    />
                    Enabled
                  </label>
                </div>
              </div>
              <div className="mt-2">
                {selectedOpeningRecord.shape.type === "circle" ? (
                  <div>
                    <label className="mb-1 block text-sm text-zinc-700">Radius (mm)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={selectedRadiusDraft}
                      onChange={(event) => setSelectedRadiusDraft(event.target.value)}
                      onKeyDown={blurOnEnter}
                      onBlur={() => {
                        if (!selectedOpening) return;
                        updateOpening(selectedOpening.id, (opening) => ({
                          ...opening,
                          shape: {
                            type: "circle",
                            radius_mm: Math.max(0.1, Number.parseFloat(selectedRadiusDraft) || 0.1),
                          },
                        }));
                      }}
                      className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-black"
                    />
                  </div>
                ) : (
                  <div className="grid gap-2 md:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-sm text-zinc-700">Width (mm)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={selectedWidthDraft}
                        onChange={(event) => setSelectedWidthDraft(event.target.value)}
                        onKeyDown={blurOnEnter}
                        onBlur={() => {
                          if (!selectedOpening) return;
                          updateOpening(selectedOpening.id, (opening) => ({
                            ...opening,
                            shape: {
                              type: "rectangle",
                              width_mm: Math.max(0.1, Number.parseFloat(selectedWidthDraft) || 0.1),
                              height_mm:
                                opening.shape.type === "rectangle" ? opening.shape.height_mm : 4,
                              rotation_deg:
                                opening.shape.type === "rectangle"
                                  ? (opening.shape.rotation_deg ?? 0)
                                  : 0,
                            },
                          }));
                        }}
                        className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-black"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm text-zinc-700">Height (mm)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={selectedHeightDraft}
                        onChange={(event) => setSelectedHeightDraft(event.target.value)}
                        onKeyDown={blurOnEnter}
                        onBlur={() => {
                          if (!selectedOpening) return;
                          updateOpening(selectedOpening.id, (opening) => ({
                            ...opening,
                            shape: {
                              type: "rectangle",
                              width_mm:
                                opening.shape.type === "rectangle" ? opening.shape.width_mm : 4,
                              height_mm: Math.max(
                                0.1,
                                Number.parseFloat(selectedHeightDraft) || 0.1,
                              ),
                              rotation_deg:
                                opening.shape.type === "rectangle"
                                  ? (opening.shape.rotation_deg ?? 0)
                                  : 0,
                            },
                          }));
                        }}
                        className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-black"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm text-zinc-700">Rotation (deg)</label>
                      <input
                        type="number"
                        step="1"
                        value={selectedRotationDraft}
                        onChange={(event) => setSelectedRotationDraft(event.target.value)}
                        onKeyDown={blurOnEnter}
                        onBlur={() => {
                          if (!selectedOpening) return;
                          updateOpening(selectedOpening.id, (opening) => ({
                            ...opening,
                            shape: {
                              type: "rectangle",
                              width_mm:
                                opening.shape.type === "rectangle" ? opening.shape.width_mm : 4,
                              height_mm:
                                opening.shape.type === "rectangle" ? opening.shape.height_mm : 4,
                              rotation_deg: Number.parseFloat(selectedRotationDraft) || 0,
                            },
                          }));
                        }}
                        className="rounded border border-zinc-300 bg-white px-3 py-2 text-black"
                      />
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-xl border border-zinc-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-black">Numeric values</p>
                <button
                  type="button"
                  onClick={() => setNumericKeyModalOpen(true)}
                  className="inline-flex min-w-20 justify-center rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-black transition-colors hover:bg-zinc-100"
                >
                  Add
                </button>
              </div>
              {numericKeys.length === 0 ? (
                <p className="text-sm text-zinc-600">Add a numeric key first.</p>
              ) : (
                <div className="grid gap-2 md:grid-cols-2">
                  {numericKeys.map((key) => (
                    <div key={key}>
                      <label className="mb-1 block text-sm text-zinc-700">{key}</label>
                      <input
                        type="number"
                        step="0.001"
                        value={selectedNumericDrafts[key] ?? ""}
                        onChange={(event) =>
                          setSelectedNumericDrafts((current) => ({
                            ...current,
                            [key]: event.target.value,
                          }))
                        }
                        onKeyDown={blurOnEnter}
                        onBlur={() => {
                          if (!selectedOpening) return;
                          updateDataset(selectedOpening.id, (current) => ({
                            ...current,
                            numericProperties: {
                              ...current.numericProperties,
                              [key]: Number.parseFloat(selectedNumericDrafts[key] ?? "") || 0,
                            },
                          }));
                        }}
                        className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-black"
                      />
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-xl border border-zinc-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-medium text-black">Composition</p>
                <span className="text-sm text-zinc-500">
                  {Object.keys(selectedDatasetRecord.composition).length} entries
                </span>
              </div>
              <div ref={selectedCompositionSectionRef} className="space-y-2">
                {selectedCompositionRows.map((key) => {
                  const value = selectedDatasetRecord.composition[key];
                  return (
                    <div key={key} className="grid grid-cols-[1fr_140px_auto] gap-2">
                      <input
                        type="text"
                        value={key}
                        readOnly
                        className="rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-black"
                      />
                      <input
                        type="number"
                        data-composition-entry-input="true"
                        min="0"
                        step="0.001"
                        value={
                          selectedCompositionDrafts[key] ??
                          (value === undefined ? "" : String(value))
                        }
                        onChange={(event) =>
                          setSelectedCompositionDrafts((current) => ({
                            ...current,
                            [key]: event.target.value,
                          }))
                        }
                        onKeyDown={blurOnEnter}
                        onBlur={() => {
                          if (!selectedOpening) return;
                          const nextValue =
                            selectedCompositionDrafts[key] ??
                            (value === undefined ? "" : String(value));
                          updateDataset(selectedOpening.id, (current) => {
                            const nextComposition = { ...current.composition };
                            if (nextValue.trim() === "") {
                              delete nextComposition[key];
                            } else {
                              nextComposition[key] = Math.max(0, Number.parseFloat(nextValue) || 0);
                            }
                            return {
                              ...current,
                              composition: nextComposition,
                            };
                          });
                        }}
                        className="rounded border border-zinc-300 bg-white px-3 py-2 text-black"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (!selectedOpening) return;
                          updateDataset(selectedOpening.id, (current) => {
                            const nextComposition = { ...current.composition };
                            delete nextComposition[key];
                            return { ...current, composition: nextComposition };
                          });
                        }}
                        className="inline-flex min-w-20 justify-center rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700"
                      >
                        Delete
                      </button>
                    </div>
                  );
                })}
                <div className="grid grid-cols-[1fr_140px_auto] gap-2">
                  <input
                    type="text"
                    data-composition-add-key="true"
                    value={compositionDraftKey}
                    onChange={(event) => setCompositionDraftKey(event.target.value)}
                    placeholder="element"
                    className="rounded border border-zinc-300 bg-white px-3 py-2 text-black"
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    value={compositionDraftValue}
                    onChange={(event) => setCompositionDraftValue(event.target.value)}
                    placeholder="ratio"
                    className="rounded border border-zinc-300 bg-white px-3 py-2 text-black"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!selectedOpening) return;
                      const key = compositionDraftKey.trim();
                      if (!key) return;
                      updateDataset(selectedOpening.id, (current) => ({
                        ...current,
                        composition: {
                          ...current.composition,
                          [key]: Math.max(0, Number.parseFloat(compositionDraftValue) || 0),
                        },
                      }));
                      setCompositionDraftKey("");
                      setCompositionDraftValue("");
                    }}
                    className="inline-flex min-w-20 justify-center rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-black transition-colors hover:bg-zinc-100"
                  >
                    Add
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-zinc-200 bg-white p-4">
              <p className="mb-3 text-sm font-medium text-black">Phase</p>
              <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                <input
                  type="text"
                  value={selectedPhaseDraft}
                  onChange={(event) => setSelectedPhaseDraft(event.target.value)}
                  onKeyDown={blurOnEnter}
                  onBlur={() => {
                    if (!selectedOpening) return;
                    const nextPhases = splitPhaseInput(selectedPhaseDraft);
                    updateDataset(selectedOpening.id, (current) => ({
                      ...current,
                      phase: nextPhases,
                    }));
                    if (nextPhases.length > 0) {
                      setState((current) => ({
                        ...current,
                        phaseColors: {
                          ...current.phaseColors,
                          ...Object.fromEntries(
                            nextPhases.map((phase) => [
                              phase,
                              current.phaseColors[phase] ??
                                getOrCreatePhaseColor(phase, current.phaseColors),
                            ]),
                          ),
                        },
                      }));
                    }
                  }}
                  placeholder="phase A, phase B"
                  className="rounded border border-zinc-300 bg-white px-3 py-2 text-black"
                />
                {selectedDatasetRecord.phase.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {selectedDatasetRecord.phase.map((phase) => (
                      <span
                        key={phase}
                        className="inline-flex items-center rounded-full border border-zinc-300 px-3 py-2 text-sm text-zinc-700"
                        style={{
                          backgroundColor: `${getOrCreatePhaseColor(phase, state.phaseColors)}20`,
                          borderColor: getOrCreatePhaseColor(phase, state.phaseColors),
                        }}
                      >
                        {phase}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </section>
          </fieldset>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-300 bg-zinc-50 p-4 xl:col-start-2 xl:row-start-2">
        <div className="mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-600">
            Controls
          </h2>
        </div>
        <div className="space-y-4">
          <div role="tablist" aria-label="Controls sections" className="grid grid-cols-2 gap-2">
            {[
              ["files", "Files"],
              ["view", "View"],
              ["properties", "Properties"],
              ["preset", "Preset"],
            ].map(([key, label]) => {
              const isActive = activeControlsTab === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveControlsTab(key as ControlsTab)}
                  className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? "border-zinc-900 bg-zinc-900 text-white"
                      : "border-zinc-300 bg-white text-black hover:bg-zinc-100"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {activeControlsTab === "files" ? (
            <section className="rounded-xl border border-zinc-200 bg-white p-4">
              <p className="mb-3 text-sm font-medium text-black">Files</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => layoutInputRef.current?.click()}
                  className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-black transition-colors hover:bg-zinc-100"
                >
                  Import Layout JSON
                </button>
                <button
                  type="button"
                  onClick={() => datasetInputRef.current?.click()}
                  className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-black transition-colors hover:bg-zinc-100"
                >
                  Import Dataset JSON
                </button>
                <button
                  type="button"
                  onClick={() => projectInputRef.current?.click()}
                  className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-black transition-colors hover:bg-zinc-100"
                >
                  Load Project
                </button>
                <button
                  type="button"
                  onClick={() => handleExport("project")}
                  className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-black transition-colors hover:bg-zinc-100"
                >
                  Save Project
                </button>
                <button
                  type="button"
                  onClick={() => handleExport("layout")}
                  className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-black transition-colors hover:bg-zinc-100"
                >
                  Export Layout JSON
                </button>
                <button
                  type="button"
                  onClick={() => handleExport("dataset")}
                  className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-black transition-colors hover:bg-zinc-100"
                >
                  Export Dataset JSON
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (primaryWaferSvgRef.current) {
                      downloadSvgRoot(primaryWaferSvgRef.current, "mask-map-primary.svg");
                    }
                    if (secondaryWaferSvgRef.current) {
                      downloadSvgRoot(secondaryWaferSvgRef.current, "mask-map-secondary.svg");
                    }
                  }}
                  className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-black transition-colors hover:bg-zinc-100"
                >
                  Export SVG
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      if (primaryWaferSvgRef.current) {
                        await downloadPngFromSvg(
                          primaryWaferSvgRef.current,
                          "mask-map-primary.png",
                        );
                      }
                      if (secondaryWaferSvgRef.current) {
                        await downloadPngFromSvg(
                          secondaryWaferSvgRef.current,
                          "mask-map-secondary.png",
                        );
                      }
                    } catch (error) {
                      setError(error);
                    }
                  }}
                  className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-black transition-colors hover:bg-zinc-100"
                >
                  Export PNG
                </button>
              </div>
              <input
                ref={layoutInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => handleFileSelection(event, handleImportLayout)}
              />
              <input
                ref={datasetInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => handleFileSelection(event, handleImportDataset)}
              />
              <input
                ref={projectInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => handleFileSelection(event, handleImportProject)}
              />
            </section>
          ) : null}

          {activeControlsTab === "view" ? (
            <section className="rounded-xl border border-zinc-200 bg-white p-4">
              <p className="mb-3 text-sm font-medium text-black">View</p>
              <div className="space-y-3">
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                  <p className="mb-3 text-sm font-medium text-black">Primary</p>
                  {renderCanvasViewSettings("primary")}
                </div>
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                  <p className="mb-3 text-sm font-medium text-black">Secondary</p>
                  {renderCanvasViewSettings("compare")}
                </div>
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
                  <p>Openings: {state.openings.length}</p>
                  <p>Invalid openings: {invalidOpeningIds.size}</p>
                  <p>Numeric keys: {numericKeys.length}</p>
                  <p>Composition keys: {compositionKeys.length}</p>
                  <p>Phases: {phases.length}</p>
                </div>
              </div>
            </section>
          ) : null}

          {activeControlsTab === "properties" ? (
            <section className="rounded-xl border border-zinc-200 bg-white p-4">
              <p className="mb-3 text-sm font-medium text-black">Numeric properties</p>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newNumericKey}
                    onChange={(event) => setNewNumericKey(event.target.value)}
                    placeholder="e.g. thickness"
                    className="flex-1 rounded border border-zinc-300 bg-white px-3 py-2 text-black"
                  />
                  <button
                    type="button"
                    onClick={handleAddNumericKey}
                    className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-black transition-colors hover:bg-zinc-100"
                  >
                    Add
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={renameNumericKey}
                    onChange={(event) => setRenameNumericKey(event.target.value)}
                    placeholder={`rename ${view.numericKey ?? "current key"}`}
                    className="flex-1 rounded border border-zinc-300 bg-white px-3 py-2 text-black"
                  />
                  <button
                    type="button"
                    onClick={handleRenameNumericKey}
                    className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-black transition-colors hover:bg-zinc-100"
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteNumericKey}
                    className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 transition-colors hover:bg-red-100"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </section>
          ) : null}

          {activeControlsTab === "preset" ? (
            <section className="rounded-xl border border-zinc-200 bg-white p-4">
              <p className="mb-3 text-sm font-medium text-black">New opening preset</p>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-sm text-zinc-700">Shape</label>
                  <select
                    value={newOpeningShapeType}
                    onChange={(event) =>
                      setNewOpeningShapeType(event.target.value as LayoutShape["type"])
                    }
                    className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-black"
                  >
                    <option value="circle">Circle</option>
                    <option value="rectangle">Rectangle</option>
                  </select>
                </div>
                {newOpeningShapeType === "circle" ? (
                  <div>
                    <label className="mb-1 block text-sm text-zinc-700">Radius (mm)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={newOpeningCircleRadius}
                      onChange={(event) => setNewOpeningCircleRadius(event.target.value)}
                      className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-black"
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="mb-1 block text-sm text-zinc-700">Width</label>
                      <input
                        type="number"
                        step="0.1"
                        value={newOpeningWidth}
                        onChange={(event) => setNewOpeningWidth(event.target.value)}
                        className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-black"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm text-zinc-700">Height</label>
                      <input
                        type="number"
                        step="0.1"
                        value={newOpeningHeight}
                        onChange={(event) => setNewOpeningHeight(event.target.value)}
                        className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-black"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm text-zinc-700">Rotation</label>
                      <input
                        type="number"
                        step="1"
                        value={newOpeningRotation}
                        onChange={(event) => setNewOpeningRotation(event.target.value)}
                        className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-black"
                      />
                    </div>
                  </div>
                )}
              </div>
            </section>
          ) : null}

          {messages.errors.length > 0 || messages.warnings.length > 0 ? (
            <section className="rounded-xl border border-zinc-200 bg-white p-4">
              {messages.errors.length > 0 ? (
                <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                  {messages.errors.map((message) => (
                    <p key={message}>{message}</p>
                  ))}
                </div>
              ) : null}
              {messages.warnings.length > 0 ? (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  {messages.warnings.map((message) => (
                    <p key={message}>{message}</p>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>

      {viewModalCanvas ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"
          onClick={() => setViewModalCanvas(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-zinc-300 bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-600">
                  {viewModalCanvas === "compare" ? "Secondary View" : "Primary View"}
                </p>
                <p className="text-sm text-zinc-500">
                  Update the wafer map display for this panel.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewModalCanvas(null)}
                className="rounded border border-zinc-300 px-3 py-2 text-sm text-black transition-colors hover:bg-zinc-100"
              >
                Close
              </button>
            </div>
            {renderCanvasViewSettings(viewModalCanvas)}
          </div>
        </div>
      ) : null}

      {numericKeyModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"
          onClick={() => setNumericKeyModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-zinc-300 bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-600">
                  Add Numeric Key
                </p>
                <p className="text-sm text-zinc-500">
                  Add a new numeric property to the selected opening table and views.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNumericKeyModalOpen(false)}
                className="rounded border border-zinc-300 px-3 py-2 text-sm text-black transition-colors hover:bg-zinc-100"
              >
                Close
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newNumericKey}
                onChange={(event) => setNewNumericKey(event.target.value)}
                placeholder="conductivity"
                className="flex-1 rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-black"
              />
              <button
                type="button"
                onClick={() => {
                  handleAddNumericKey();
                  setNumericKeyModalOpen(false);
                }}
                className="inline-flex min-w-20 justify-center rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-black transition-colors hover:bg-zinc-100"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {compositionModalOpening && compositionModalDataset ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"
          onClick={() => setCompositionModalOpeningId(null)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-zinc-300 bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-600">
                  Composition
                </p>
                <p className="text-sm text-zinc-500">
                  {openingLabel(compositionModalOpening)} ({compositionModalOpening.id})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCompositionModalOpeningId(null)}
                className="rounded border border-zinc-300 px-3 py-2 text-sm text-black transition-colors hover:bg-zinc-100"
              >
                Close
              </button>
            </div>
            <div className="space-y-2">
              {compositionModalRows.map((key) => {
                const value = compositionModalDataset.composition[key];
                return (
                  <div
                    key={`${compositionModalOpening.id}-modal-composition-${key}`}
                    className="grid grid-cols-[1fr_160px_auto] gap-2"
                  >
                    <input
                      type="text"
                      value={key}
                      readOnly
                      className="rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-black"
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      value={
                        compositionModalDrafts[key] ?? (value === undefined ? "" : String(value))
                      }
                      onChange={(event) =>
                        setCompositionModalDrafts((current) => ({
                          ...current,
                          [key]: event.target.value,
                        }))
                      }
                      onKeyDown={blurOnEnter}
                      onBlur={() =>
                        updateDataset(compositionModalOpening.id, (current) => {
                          const nextValue =
                            compositionModalDrafts[key] ??
                            (value === undefined ? "" : String(value));
                          const nextComposition = { ...current.composition };
                          if (nextValue.trim() === "") {
                            delete nextComposition[key];
                          } else {
                            nextComposition[key] = Math.max(0, Number.parseFloat(nextValue) || 0);
                          }
                          return {
                            ...current,
                            composition: nextComposition,
                          };
                        })
                      }
                      className="rounded border border-zinc-300 bg-white px-3 py-2 text-black"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        updateDataset(compositionModalOpening.id, (current) => {
                          const nextComposition = { ...current.composition };
                          delete nextComposition[key];
                          return { ...current, composition: nextComposition };
                        })
                      }
                      className="inline-flex min-w-20 justify-center rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700"
                    >
                      Delete
                    </button>
                  </div>
                );
              })}
              <div className="grid grid-cols-[1fr_160px_auto] gap-2">
                <input
                  type="text"
                  value={compositionModalKeyDraft}
                  onChange={(event) => setCompositionModalKeyDraft(event.target.value)}
                  placeholder="element"
                  className="rounded border border-zinc-300 bg-white px-3 py-2 text-black"
                />
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={compositionModalValueDraft}
                  onChange={(event) => setCompositionModalValueDraft(event.target.value)}
                  placeholder="ratio"
                  className="rounded border border-zinc-300 bg-white px-3 py-2 text-black"
                />
                <button
                  type="button"
                  onClick={() => {
                    const key = compositionModalKeyDraft.trim();
                    if (!key) return;
                    updateDataset(compositionModalOpening.id, (current) => ({
                      ...current,
                      composition: {
                        ...current.composition,
                        [key]: Math.max(0, Number.parseFloat(compositionModalValueDraft) || 0),
                      },
                    }));
                    setCompositionModalKeyDraft("");
                    setCompositionModalValueDraft("");
                  }}
                  className="inline-flex min-w-20 justify-center rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-black transition-colors hover:bg-zinc-100"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
