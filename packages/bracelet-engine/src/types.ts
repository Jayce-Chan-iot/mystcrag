export type BraceletComponentInput = {
  componentId: string;
  heightMm?: number;
  widthMm: number;
};

export type BraceletLayoutOptions = {
  center?: { x: number; y: number };
  gapMm?: number;
  rotationRad?: number;
};

export type BraceletSlot = {
  angle: number;
  componentId: string;
  endAngle: number;
  height: number;
  index: number;
  rotation: number;
  startAngle: number;
  width: number;
  x: number;
  y: number;
};

export type BraceletLayoutResult = {
  center: { x: number; y: number };
  circumference: number;
  gapMm: number;
  radius: number;
  slots: BraceletSlot[];
};

export type BraceletFitStatus = "TOO_SMALL" | "VALID" | "TOO_LARGE";

export type BraceletFitInput = {
  assembledMaterialPathMm: number;
  elasticAllowanceMm: number;
  maxCircumferenceMm?: number;
  minCircumferenceMm?: number;
  targetInnerCircumferenceMm: number;
  userWristCircumferenceMm: number;
};

export type BraceletFitResult = BraceletFitInput & {
  deltaFromTargetMm: number;
  estimatedBraceletFitMm: number;
  status: BraceletFitStatus;
};
