/**
 * Results view — displays all analysis outputs: original image, ROI,
 * FFT spectrum, radial profile, histogram, spatial metrics table,
 * lattice peak table, band energy chart, and inverse FFT filtered images.
 */
import { useRef, useEffect, useCallback, useState } from "react";
import {
  renderGrayscaleToCanvas,
  renderFftToCanvas,
  renderHistogram,
  renderRadialProfile,
  overlayFftAnnotations,
  renderBandEnergy,
} from "@/lib/render";
import type { AnalysisResult } from "@/lib/types";
import { Download, RotateCcw, Microscope, BarChart3, Waves, Grid3x3, Activity } from "lucide-react";

interface ResultsViewProps {
  result: AnalysisResult;
  imageDisplayData: Float64Array | null;
  imageRows: number;
  imageCols: number;
  roiRect: { x1: number; y1: number; x2: number; y2: number };
  fileName: string;
  onReset: () => void;
}

const ZOOM = 1.0;
const ZOOM_FILTER = 400;

export default function ResultsView({
  result,
  imageDisplayData,
  imageRows,
  imageCols,
  roiRect,
  fileName,
  onReset,
}: ResultsViewProps) {
  const fullImgRef = useRef<HTMLCanvasElement>(null);
  const roiRef = useRef<HTMLCanvasElement>(null);
  const fftRef = useRef<HTMLCanvasElement>(null);
  const histRef = useRef<HTMLCanvasElement>(null);
  const radialRef = useRef<HTMLCanvasElement>(null);
  const bandRef = useRef<HTMLCanvasElement>(null);
  const origPatchRef = useRef<HTMLCanvasElement>(null);
  const bandpassRef = useRef<HTMLCanvasElement>(null);
  const braggRef = useRef<HTMLCanvasElement>(null);

  // Render full image with ROI overlay
  useEffect(() => {
    const canvas = fullImgRef.current;
    if (!canvas || !imageDisplayData) return;
    const dispW = Math.min(600, imageCols);
    const dispH = Math.round((dispW * imageRows) / imageCols);
    renderGrayscaleToCanvas(canvas, imageDisplayData, imageRows, imageCols, dispW, dispH);

    // Draw ROI rectangle
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const scale = dispW / imageCols;
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(
      roiRect.x1 * scale,
      roiRect.y1 * scale,
      (roiRect.x2 - roiRect.x1) * scale,
      (roiRect.y2 - roiRect.y1) * scale,
    );
    ctx.setLineDash([]);
  }, [imageDisplayData, imageRows, imageCols, roiRect]);

  // Render ROI
  useEffect(() => {
    const canvas = roiRef.current;
    if (!canvas) return;
    const dispSize = Math.min(400, result.roiRows, result.roiCols);
    renderGrayscaleToCanvas(
      canvas,
      result.roiData,
      result.roiRows,
      result.roiCols,
      dispSize,
      dispSize,
    );
  }, [result]);

  // Render FFT
  useEffect(() => {
    const canvas = fftRef.current;
    if (!canvas) return;
    renderFftToCanvas(
      canvas,
      result.fft.mag,
      result.fft.rows,
      result.fft.cols,
      ZOOM,
    );
    overlayFftAnnotations(
      canvas,
      result.fft,
      result.peaks,
      ZOOM,
      result.latticeReferences,
    );
  }, [result]);

  // Render histogram
  useEffect(() => {
    const canvas = histRef.current;
    if (!canvas) return;
    renderHistogram(canvas, result.histogram.counts, result.histogram.binCenters, "#3b82f6");
  }, [result]);

  // Render radial profile
  useEffect(() => {
    const canvas = radialRef.current;
    if (!canvas) return;
    const referenceLines = [
      result.latticeReferences.d1 !== null
        ? { freq: 1.0 / result.latticeReferences.d1, color: "#ef4444", label: "(020)" }
        : null,
      result.latticeReferences.d2 !== null
        ? { freq: 1.0 / result.latticeReferences.d2, color: "#06b6d4", label: "(021)" }
        : null,
    ].filter((line): line is { freq: number; color: string; label: string } => line !== null);
    renderRadialProfile(canvas, result.radialProfile.freq, result.radialProfile.mag, referenceLines);
  }, [result]);

  // Render band energy
  useEffect(() => {
    const canvas = bandRef.current;
    if (!canvas) return;
    renderBandEnergy(canvas, [
      { label: "Low", value: result.bandEnergy.low, color: "#94a3b8" },
      { label: "Lattice", value: result.bandEnergy.lattice, color: "#3b82f6" },
      { label: "High", value: result.bandEnergy.high, color: "#06b6d4" },
    ]);
  }, [result]);

  // Render inverse FFT patches
  const renderPatch = useCallback(
    (
      canvas: HTMLCanvasElement | null,
      data: Float64Array,
    ) => {
      if (!canvas) return;
      const rows = result.filterRows;
      const cols = result.filterCols;
      const cr = Math.floor(rows / 2);
      const cc = Math.floor(cols / 2);
      const half = Math.floor(ZOOM_FILTER / 2);
      const patch = new Float64Array(ZOOM_FILTER * ZOOM_FILTER);
      for (let r = 0; r < ZOOM_FILTER; r++) {
        for (let c = 0; c < ZOOM_FILTER; c++) {
          const sr = Math.max(0, Math.min(rows - 1, cr - half + r));
          const sc = Math.max(0, Math.min(cols - 1, cc - half + c));
          patch[r * ZOOM_FILTER + c] = data[sr * cols + sc];
        }
      }
      renderGrayscaleToCanvas(canvas, patch, ZOOM_FILTER, ZOOM_FILTER, ZOOM_FILTER, ZOOM_FILTER);
    },
    [result.filterRows, result.filterCols],
  );

  useEffect(() => {
    renderPatch(origPatchRef.current, result.roiData);
    renderPatch(bandpassRef.current, result.filters.bandpassData);
    renderPatch(braggRef.current, result.filters.braggData);
  }, [result, renderPatch]);

  const downloadCSV = useCallback(() => {
    const lines: string[] = [];
    lines.push("TEM Analysis Results");
    lines.push(`File,${fileName}`);
    lines.push("");
    lines.push("Calibration");
    lines.push(`Nominal nm/px,${result.calibration.nominal.toFixed(6)}`);
    lines.push(`Calibrated nm/px,${result.calibration.calibrated.toFixed(6)}`);
    lines.push(`Change %,${result.calibration.changePercent.toFixed(2)}`);
    lines.push("");
    lines.push("Spatial Metrics");
    lines.push(`Mean intensity,${result.spatial.meanIntensity.toFixed(4)}`);
    lines.push(`RMS contrast / std,${result.spatial.rmsContrast.toFixed(4)}`);
    lines.push(`Mean gradient Sobel,${result.spatial.meanGradient.toFixed(4)}`);
    lines.push(`Laplacian variance,${result.spatial.laplacianVariance.toFixed(4)}`);
    lines.push(`Entropy (bits),${result.spatial.entropy.toFixed(4)}`);
    lines.push("");
    lines.push("Band Energy (%)");
    lines.push(`Low,${result.bandEnergy.low.toFixed(2)}`);
    lines.push(`Lattice,${result.bandEnergy.lattice.toFixed(2)}`);
    lines.push(`High,${result.bandEnergy.high.toFixed(2)}`);
    lines.push("");
    lines.push("Lattice Peaks");
    lines.push("Plane,d_ref (nm),d_measured (nm),Error %,Frequency (nm^-1),Angle (deg),SNR (dB),Detected");
    for (const p of result.peaks) {
      lines.push(
        `${p.plane},${p.dRef},${p.dMeasured.toFixed(4)},${p.errorPercent.toFixed(2)},${p.frequency.toFixed(4)},${p.angleDeg.toFixed(1)},${p.snrDb.toFixed(1)},${p.detected}`,
      );
    }
    lines.push("");
    lines.push("Validation");
    if (result.angleDiff !== null) {
      lines.push(`Angle (020)-(021) deg,${result.angleDiff.toFixed(1)} (ref 60)`);
      lines.push(`Frequency ratio,${result.freqRatio?.toFixed(3)} (ref 1.998)`);
    } else {
      lines.push("Angle (020)-(021) deg,N/A (both reflectors not detected)");
    }
    lines.push("");
    lines.push("Filter Energy (%)");
    lines.push(`Band-pass,${result.filters.bandpassEnergy.toFixed(2)}`);
    lines.push(`Bragg,${result.filters.braggEnergy.toFixed(2)}`);

    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tem_analysis_results.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, [result, fileName]);

  return (
    <div className="max-w-7xl mx-auto px-4 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Hasil Analisis TEM</h2>
          <p className="text-sm text-slate-500 mt-1">
            {fileName} — ROI {result.roiRows}×{result.roiCols} px —{" "}
            {result.nmPerPx.toFixed(5)} nm/px
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={downloadCSV}
            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-700 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
          <button
            onClick={onReset}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition"
          >
            <RotateCcw className="w-4 h-4" />
            Analisis Baru
          </button>
        </div>
      </div>

      {/* Section 1: Images */}
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Microscope className="w-5 h-5 text-slate-700" />
          <h3 className="text-lg font-semibold text-slate-800">Citra & ROI</h3>
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <p className="text-sm font-medium text-slate-600 mb-2">
              Citra lengkap (kotak kuning = ROI)
            </p>
            <canvas ref={fullImgRef} className="w-full rounded-lg border border-slate-200" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-600 mb-2">
              ROI persegi ({result.roiRows}×{result.roiCols} px ={" "}
              {(result.roiRows * result.nmPerPx).toFixed(1)} nm)
            </p>
            <div className="flex justify-center">
              <canvas
                ref={roiRef}
                className="rounded-lg border border-slate-200"
                style={{ imageRendering: "pixelated", maxWidth: "100%" }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Section 2: Spatial Metrics */}
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-5 h-5 text-slate-700" />
          <h3 className="text-lg font-semibold text-slate-800">
            Domain Ruang — Metrik Statistik
          </h3>
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-600">
                    Metrik
                  </th>
                  <th className="text-right px-4 py-2.5 font-medium text-slate-600">
                    Nilai
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="px-4 py-2.5 text-slate-700">Mean intensity</td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-800">
                    {result.spatial.meanIntensity.toFixed(2)}
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5 text-slate-700">
                    RMS contrast / std
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-800">
                    {result.spatial.rmsContrast.toFixed(2)}
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5 text-slate-700">
                    Mean gradient (Sobel)
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-800">
                    {result.spatial.meanGradient.toFixed(2)}
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5 text-slate-700">
                    Laplacian variance
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-800">
                    {result.spatial.laplacianVariance.toExponential(3)}
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5 text-slate-700">Entropy (bits)</td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-800">
                    {result.spatial.entropy.toFixed(3)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-600 mb-2">
              Histogram intensitas ROI
            </p>
            <canvas
              ref={histRef}
              width={400}
              height={200}
              className="w-full rounded-lg border border-slate-200 bg-white"
            />
            <p className="text-xs text-slate-400 mt-2">
              Distribusi nilai intensitas asli (level detektor) pada ROI.
            </p>
          </div>
        </div>
      </section>

      {/* Section 3: Frequency Domain */}
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Waves className="w-5 h-5 text-slate-700" />
          <h3 className="text-lg font-semibold text-slate-800">
            Domain Frekuensi — FFT / Diffraction Pattern
          </h3>
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <p className="text-sm font-medium text-slate-600 mb-2">
              FFT magnitude (log) — pola diffraction ROI & puncak kisi
            </p>
            <div className="flex justify-center">
              <canvas
                ref={fftRef}
                className="w-full max-w-[420px] rounded-lg border border-slate-300 bg-slate-950"
                style={{ imageRendering: "pixelated" }}
              />
            </div>
            <div className="flex gap-4 mt-3 text-xs">
              {result.latticeReferences.d1 !== null && (
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-red-500" /> (020) {result.latticeReferences.d1.toFixed(3)} nm
                </span>
              )}
              {result.latticeReferences.d2 !== null && (
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-cyan-500" /> (021) {result.latticeReferences.d2.toFixed(3)} nm
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full border-2 border-lime-500" /> Puncak terdeteksi
              </span>
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium text-slate-600 mb-2">
                Profil frekuensi radial (log scale)
              </p>
              <canvas
                ref={radialRef}
                width={400}
                height={200}
                className="w-full rounded-lg border border-slate-200 bg-white"
              />
              <p className="text-xs text-slate-400 mt-2">
                Rata-rata magnitude FFT per radius. Garis putus-putus = frekuensi acuan kisi.
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-slate-600 mb-2">
                Energi per pita frekuensi
              </p>
              <canvas
                ref={bandRef}
                width={400}
                height={160}
                className="w-full rounded-lg border border-slate-200 bg-white"
              />
              <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
                <div className="text-center">
                  <p className="text-slate-500">Low (d &gt; 2 nm)</p>
                  <p className="font-mono font-semibold text-slate-700">
                    {result.bandEnergy.low.toFixed(1)}%
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-slate-500">Lattice (0.29–2 nm)</p>
                  <p className="font-mono font-semibold text-slate-700">
                    {result.bandEnergy.lattice.toFixed(1)}%
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-slate-500">High (d &lt; 0.29 nm)</p>
                  <p className="font-mono font-semibold text-slate-700">
                    {result.bandEnergy.high.toFixed(1)}%
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Section 4: Lattice Peaks */}
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Grid3x3 className="w-5 h-5 text-slate-700" />
          <h3 className="text-lg font-semibold text-slate-800">
            Pengukuran Jarak Kisi dari Puncak FFT
          </h3>
        </div>

        {/* Calibration */}
        <div className="bg-slate-50 rounded-lg p-4 mb-4">
          <div className="grid md:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-slate-500">Skala nominal</p>
              <p className="font-mono font-semibold text-slate-800">
                {result.calibration.nominal.toFixed(5)} nm/px
              </p>
            </div>
            <div>
              <p className="text-slate-500">Skala terkalibrasi</p>
              <p className="font-mono font-semibold text-slate-800">
                {result.calibration.calibrated.toFixed(5)} nm/px
              </p>
            </div>
            <div>
              <p className="text-slate-500">Perubahan</p>
              <p
                className={`font-mono font-semibold ${
                  result.calibration.changePercent >= 0
                    ? "text-emerald-600"
                    : "text-rose-600"
                }`}
              >
                {result.calibration.changePercent >= 0 ? "+" : ""}
                {result.calibration.changePercent.toFixed(2)}%
              </p>
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-2">
            Skala dikalibrasi dari puncak kisi yang terdeteksi (SNR ≥{" "}
            {result.peakSnrThreshold} dB). Acuan: crocidolite (020) d=0.903 nm,
            (021) d=0.452 nm.
          </p>
        </div>

        {/* Peaks table */}
        <div className="overflow-hidden rounded-lg border border-slate-200 mb-4">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium text-slate-600">Bidang</th>
                <th className="text-right px-4 py-2.5 font-medium text-slate-600">d acuan (nm)</th>
                <th className="text-right px-4 py-2.5 font-medium text-slate-600">d terukur (nm)</th>
                <th className="text-right px-4 py-2.5 font-medium text-slate-600">Error (%)</th>
                <th className="text-right px-4 py-2.5 font-medium text-slate-600">Frekuensi (nm⁻¹)</th>
                <th className="text-right px-4 py-2.5 font-medium text-slate-600">Sudut (°)</th>
                <th className="text-right px-4 py-2.5 font-medium text-slate-600">SNR (dB)</th>
                <th className="text-center px-4 py-2.5 font-medium text-slate-600">Terdeteksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {result.peaks.map((peak, i) => (
                <tr key={i} className={peak.detected ? "" : "bg-slate-50/50"}>
                  <td className="px-4 py-2.5 text-slate-700">{peak.plane}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-700">
                    {peak.dRef.toFixed(3)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-800">
                    {peak.dMeasured.toFixed(4)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-700">
                    {peak.errorPercent.toFixed(2)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-700">
                    {peak.frequency.toFixed(4)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-700">
                    {peak.angleDeg.toFixed(1)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-700">
                    {peak.snrDb.toFixed(1)}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {peak.detected ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                        Ya
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">
                        Tidak
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Validation */}
        <div className="bg-blue-50 rounded-lg p-4">
          <p className="text-sm font-medium text-slate-700 mb-2">
            Validasi terhadap literatur
          </p>
          {result.angleDiff !== null ? (
            <div className="grid md:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-slate-500">Sudut (020)–(021)</p>
                <p className="font-mono font-semibold text-slate-800">
                  {result.angleDiff.toFixed(1)}°{" "}
                  <span className="text-slate-400 font-normal">(acuan 60°)</span>
                </p>
              </div>
              <div>
                <p className="text-slate-500">Rasio frekuensi</p>
                <p className="font-mono font-semibold text-slate-800">
                  {result.freqRatio?.toFixed(3)}{" "}
                  <span className="text-slate-400 font-normal">(acuan 1.998)</span>
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              Kedua reflektor tidak terdeteksi pada ROI ini — sudut dan rasio
              frekuensi tidak dapat dihitung. Reflektor yang tidak terselesaikan
              tidak dipaksakan.
            </p>
          )}
        </div>
      </section>

      {/* Section 5: Inverse FFT */}
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-5 h-5 text-slate-700" />
          <h3 className="text-lg font-semibold text-slate-800">
            Inverse FFT — Filter Band-pass & Bragg
          </h3>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-sm font-medium text-slate-600 mb-2 text-center">
              ROI asli
            </p>
            <div className="flex justify-center">
              <canvas
                ref={origPatchRef}
                className="rounded-lg border border-slate-200"
                style={{ imageRendering: "pixelated", width: "100%", maxWidth: "300px" }}
              />
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-600 mb-2 text-center">
              Band-pass ({ZOOM_FILTER}×{ZOOM_FILTER} px)
            </p>
            <div className="flex justify-center">
              <canvas
                ref={bandpassRef}
                className="rounded-lg border border-slate-200"
                style={{ imageRendering: "pixelated", width: "100%", maxWidth: "300px" }}
              />
            </div>
            <p className="text-xs text-center text-slate-400 mt-2">
              Daya: {result.filters.bandpassEnergy.toFixed(1)}%
            </p>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-600 mb-2 text-center">
              Bragg filter
            </p>
            <div className="flex justify-center">
              <canvas
                ref={braggRef}
                className="rounded-lg border border-slate-200"
                style={{ imageRendering: "pixelated", width: "100%", maxWidth: "300px" }}
              />
            </div>
            <p className="text-xs text-center text-slate-400 mt-2">
              Daya: {result.filters.braggEnergy.toFixed(1)}%
            </p>
          </div>
        </div>

        <p className="text-xs text-slate-400 mt-4">
          Hasil inverse FFT memakai bagian real (bukan | nilai |) untuk
          menghindari rektifikasi sinyal. Patch {ZOOM_FILTER}×{ZOOM_FILTER} px
          diambil dari pusat ROI agar fringe kisi terlihat jelas.
        </p>
      </section>
    </div>
  );
}
