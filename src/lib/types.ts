/** Shared types for the TEM analysis pipeline. */

export interface SpatialMetrics {
  meanIntensity: number;
  rmsContrast: number;
  meanGradient: number;
  laplacianVariance: number;
  entropy: number;
}

export interface LatticePeak {
  plane: string;
  dRef: number;
  dMeasured: number;
  errorPercent: number;
  frequency: number; // nm^-1
  angleDeg: number;
  snrDb: number;
  detected: boolean;
  px: [number, number];
  pf: [number, number];
}

export interface CalibrationResult {
  nominal: number;
  calibrated: number;
  changePercent: number;
  familiesUsed: number[];
}

export interface BandEnergy {
  low: number;
  lattice: number;
  high: number;
}

export interface FilterResult {
  bandpassData: Float64Array;
  braggData: Float64Array;
  bandpassEnergy: number;
  braggEnergy: number;
}

export interface FftData {
  mag: Float64Array;
  fx: Float64Array;
  fy: Float64Array;
  df: number;
  rows: number;
  cols: number;
}

export interface AnalysisResult {
  // Image info
  imageRows: number;
  imageCols: number;
  roiRows: number;
  roiCols: number;
  roiData: Float64Array;

  // Calibration
  calibration: CalibrationResult;
  nmPerPx: number;
  latticeReferences: { d1: number | null; d2: number | null };

  // Spatial
  spatial: SpatialMetrics;
  histogram: { counts: number[]; binCenters: number[] };

  // Frequency
  fft: FftData;
  radialProfile: { freq: number[]; mag: number[] };
  bandEnergy: BandEnergy;

  // Lattice
  peaks: LatticePeak[];
  peakSnrThreshold: number;

  // Validation
  angleDiff: number | null;
  freqRatio: number | null;

  // Filters
  filters: FilterResult;
  filterRows: number;
  filterCols: number;
}

export type AnalysisStage =
  | "idle"
  | "fft"
  | "calibration"
  | "spatial"
  | "frequency"
  | "lattice"
  | "inverse"
  | "done";
