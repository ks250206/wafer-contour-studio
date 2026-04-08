export type WaferSize = "2inch" | "3inch" | "4inch" | "6inch" | "8inch" | "12inch";

export interface CartesianPosition {
  type: "cartesian";
  x_mm: number;
  y_mm: number;
}

export interface PolarPosition {
  type: "polar";
  r_mm: number;
  theta_deg: number;
}

export type LayoutPosition = CartesianPosition | PolarPosition;

export interface CircleShape {
  type: "circle";
  radius_mm: number;
}

export interface RectangleShape {
  type: "rectangle";
  width_mm: number;
  height_mm: number;
  rotation_deg?: number;
}

export type LayoutShape = CircleShape | RectangleShape;

export interface LayoutOpeningInput {
  id?: string;
  name?: string;
  position: LayoutPosition;
  shape: LayoutShape;
  enabled?: boolean;
}

export interface AlignmentHoleInput extends LayoutOpeningInput {
  role?: "primary" | "secondary" | "tertiary";
}

export interface WaferMaskLayout {
  name: string;
  wafer_size: WaferSize;
  openings: LayoutOpeningInput[];
  alignment_holes?: AlignmentHoleInput[];
}

export interface MaskMapDatasetOpening {
  id: string;
  numericProperties?: Record<string, number>;
  composition?: Record<string, number>;
  phase?: string | string[] | null;
}

export interface MaskMapDataset {
  version: 1;
  phases?: Record<string, string>;
  openings: MaskMapDatasetOpening[];
}

export interface MaskMapProjectView {
  mode: "numeric" | "composition" | "phase";
  numericKey?: string;
  compositionKey?: string;
  colorPalette?: string;
  compareEnabled?: boolean;
  compareMode?: "numeric" | "composition" | "phase";
  compareNumericKey?: string;
  compareCompositionKey?: string;
  compareColorPalette?: string;
}

export interface MaskMapProject {
  version: 1;
  layout: WaferMaskLayout;
  dataset: MaskMapDataset;
  view: MaskMapProjectView;
}

export interface EditableOpening {
  id: string;
  name: string;
  xMm: number;
  yMm: number;
  shape: LayoutShape;
  enabled: boolean;
}

export interface EditableAlignmentHole extends EditableOpening {
  role?: "primary" | "secondary" | "tertiary";
}

export interface EditableDatasetEntry {
  id: string;
  numericProperties: Record<string, number>;
  composition: Record<string, number>;
  phase: string[];
}

export interface MaskMapEditorState {
  layoutName: string;
  waferSize: WaferSize;
  openings: EditableOpening[];
  alignmentHoles: EditableAlignmentHole[];
  datasetById: Record<string, EditableDatasetEntry>;
  phaseColors: Record<string, string>;
}
