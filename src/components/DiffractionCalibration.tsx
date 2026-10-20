/**
 * TEM Diffraction Calibration module.
 *
 * Workflow:
 * 1. Upload diffraction image (TIFF/PNG/JPEG/BMP)
 * 2. Enter accelerating voltage and camera length
 * 3. Click on the transmitted beam center
 * 4. Auto-detect ring candidates from radial profile
 * 5. Match candidates to reference material d-spacings
 * 6. Compute calibration scale in nm/pixel
 * 7. View annotated image, export PNG/CSV/PDF
 */
import { useRef, useState, useCallback, useEffect } from "react";
import {
  loadDiffractionImage,
  electronWavelength,
  cameraConstant,
  theoreticalRadiusMm,
  radialProfile,
  detectRingCandidates,
  computeCalibration,
  predictedRingRadiiPx,
  type RingCandidate,
  type CalibrationResult,
} from "@/lib/diffraction";
import {
  DIFFRACTION_MATERIALS,
  getDiffractionMaterialById,
  type DiffractionMaterial,
} from "@/lib/diffraction-materials";
import { renderGrayscaleToCanvas } from "@/lib/render";
import { exportDiffractionPdf, exportDiffractionCsv } from "@/lib/diffraction-pdf-export";
import type { LoadedImage } from "@/lib/tiff";
import {
  Upload,
  Crosshair,
  Aperture,
  ArrowLeft,
  Download,
  FileText,
  Table,
  Image as ImageIcon,
  AlertCircle,
  Check,
  Loader2,
  Target,
} from "lucide-react";

interface DiffractionCalibrationProps {
  onBack: () => void;
}

type Phase = "upload" | "params" | "center" | "detect" | "match" | "results";

interface MatchAssignment {
  candidateIndex: number;
  refIndex: number; // 0-based index into material.references
}

const RING_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#06b6d4", "#3b82f6", "#a855f7", "#ec4899",
  "#ffffff",
];

const MAX_DISPLAY_WIDTH = 700;

export default function DiffractionCalibration({ onBack }: DiffractionCalibrationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const annotatedRef = useRef<HTMLCanvasElement>(null);

  const [phase, setPhase] = useState<Phase>("upload");
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Instrument params
  const [voltageKv, setVoltageKv] = useState("120");
  const [cameraLengthM, setCameraLengthM] = useState("0.2");
  const [materialId, setMaterialId] = useState("aluminium");

  // Center
  const [center, setCenter] = useState<{ x: number; y: number } | null>(null);

  // Detection
  const [candidates, setCandidates] = useState<RingCandidate[]>([]);
  const [profileData, setProfileData] = useState<{ radii: number[]; intensity: number[] } | null>(null);
  const [detecting, setDetecting] = useState(false);

  // Matching
  const [assignments, setAssignments] = useState<MatchAssignment[]>([]);
  const [showRings, setShowRings] = useState(true);
  const [showLabels, setShowLabels] = useState(true);

  // Results
  const [calibration, setCalibration] = useState<CalibrationResult | null>(null);

  const material = getDiffractionMaterialById(materialId) || DIFFRACTION_MATERIALS[0];

  const displayWidth = image ? Math.min(MAX_DISPLAY_WIDTH, image.cols) : 0;
  const displayHeight = image ? Math.round((displayWidth * image.rows) / image.cols) : 0;
  const scale = image ? displayWidth / image.cols : 1;

  // Render base image
  useEffect(() => {
    if (!image || !canvasRef.current) return;
    renderGrayscaleToCanvas(canvasRef.current, image.data, image.rows, image.cols, displayWidth, displayHeight);
  }, [image, displayWidth, displayHeight]);

  // Draw overlay (center marker, rings, labels)
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!center) return;

    // Center crosshair
    const cx = center.x * scale;
    const cy = center.y * scale;
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy);
    ctx.lineTo(cx + 10, cy);
    ctx.moveTo(cx, cy - 10);
    ctx.lineTo(cx, cy + 10);
    ctx.stroke();
    ctx.fillStyle = "#ef4444";
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, 2 * Math.PI);
    ctx.fill();

    if (!showRings) return;

    // Draw candidate rings (before calibration) or predicted rings (after)
    if (calibration) {
      const predicted = predictedRingRadiiPx(
        calibration.cameraConstantMmA,
        calibration.scaleMmPerPx,
        material.references,
      );
      predicted.forEach((ring, i) => {
        const r = ring.radiusPx * scale;
        if (r < 2 || r > canvas.width) return;
        const color = RING_COLORS[i % RING_COLORS.length];
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, 2 * Math.PI);
        ctx.stroke();

        if (showLabels) {
          const angle = -Math.PI / 4;
          const tx = cx + r * Math.cos(angle) + 4;
          const ty = cy + r * Math.sin(angle) - 6;
          ctx.font = "bold 11px sans-serif";
          const label = `${ring.hkl} d=${ring.dSpacingA.toFixed(3)}Å R=${ring.radiusPx.toFixed(0)}px`;
          ctx.fillStyle = "rgba(0,0,0,0.75)";
          ctx.fillRect(tx - 2, ty - 11, ctx.measureText(label).width + 6, 15);
          ctx.fillStyle = color;
          ctx.fillText(label, tx, ty);
        }
      });
    } else if (candidates.length > 0) {
      candidates.forEach((cand) => {
        const r = cand.radiusPx * scale;
        if (r < 2 || r > canvas.width) return;
        const color = RING_COLORS[(cand.index - 1) % RING_COLORS.length];
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.setLineDash([]);

        if (showLabels) {
          const angle = -Math.PI / 4;
          const tx = cx + r * Math.cos(angle) + 4;
          const ty = cy + r * Math.sin(angle) - 6;
          ctx.font = "bold 11px sans-serif";
          ctx.fillStyle = "rgba(0,0,0,0.75)";
          ctx.fillRect(tx - 2, ty - 11, 30, 15);
          ctx.fillStyle = color;
          ctx.fillText(`#${cand.index}`, tx, ty);
        }
      });
    }
  }, [center, candidates, calibration, material, scale, showRings, showLabels]);

  const handleFileSelect = useCallback(async (file: File) => {
    setError(null);
    setLoading(true);
    const name = file.name.toLowerCase();
    const valid = [".tif", ".tiff", ".png", ".jpg", ".jpeg", ".bmp"];
    if (!valid.some((ext) => name.endsWith(ext))) {
      setError("Format file tidak didukung. Gunakan TIFF, PNG, JPEG, atau BMP.");
      setLoading(false);
      return;
    }
    try {
      const img = await loadDiffractionImage(file);
      setImage(img);
      setFileName(file.name);
      setPhase("params");
      setCenter(null);
      setCandidates([]);
      setProfileData(null);
      setAssignments([]);
      setCalibration(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat gambar.");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect],
  );

  const getPos = useCallback((e: React.PointerEvent) => {
    const canvas = overlayRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * canvas.width,
      y: ((e.clientY - r.top) / r.height) * canvas.height,
    };
  }, []);

  const handleCanvasClick = useCallback(
    (e: React.PointerEvent) => {
      if (phase !== "center" && phase !== "params") return;
      const pos = getPos(e);
      const imgX = pos.x / scale;
      const imgY = pos.y / scale;
      setCenter({ x: imgX, y: imgY });
      setPhase("center");
    },
    [phase, getPos, scale],
  );

  const handleDetectRings = useCallback(() => {
    if (!image || !center) return;
    setDetecting(true);
    setError(null);

    setTimeout(() => {
      try {
        const { radii, intensity } = radialProfile(image.data, image.rows, image.cols, center.x, center.y);
        setProfileData({ radii, intensity });
        const cands = detectRingCandidates(radii, intensity);
        if (cands.length === 0) {
          setError("Tidak ditemukan kandidat cincin. Periksa pusat difraksi atau kualitas citra.");
        } else {
          setCandidates(cands);
          setPhase("match");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Deteksi cincin gagal.");
      } finally {
        setDetecting(false);
      }
    }, 50);
  }, [image, center]);

  const handleAddAssignment = useCallback(
    (candidateIdx: number, refIdx: number) => {
      setAssignments((prev) => {
        const filtered = prev.filter((a) => a.candidateIndex !== candidateIdx && a.refIndex !== refIdx);
        return [...filtered, { candidateIndex: candidateIdx, refIndex: refIdx }];
      });
    },
    [],
  );

  const handleRemoveAssignment = useCallback((candidateIdx: number) => {
    setAssignments((prev) => prev.filter((a) => a.candidateIndex !== candidateIdx));
  }, []);

  const handleComputeCalibration = useCallback(() => {
    if (assignments.length === 0) {
      setError("Pasangkan minimal satu cincin kandidat dengan referensi material.");
      return;
    }
    const matches = assignments.map((a) => {
      const cand = candidates.find((c) => c.index === a.candidateIndex);
      const ref = material.references[a.refIndex];
      return {
        hkl: ref.hkl,
        dSpacingA: ref.dSpacingA,
        radiusPx: cand ? cand.radiusPx : 0,
      };
    }).filter((m) => m.radiusPx > 0);

    if (matches.length === 0) {
      setError("Tidak ada pasangan yang valid.");
      return;
    }

    const result = computeCalibration(parseFloat(voltageKv), parseFloat(cameraLengthM), matches);
    setCalibration(result);
    setPhase("results");
  }, [assignments, candidates, material, voltageKv, cameraLengthM]);

  // Wavelength preview
  const wavelength = electronWavelength(parseFloat(voltageKv) || 0);
  const camConst = cameraConstant(parseFloat(cameraLengthM) || 0, wavelength);

  const handleExportPng = useCallback(() => {
    if (!annotatedRef.current) return;
    const link = document.createElement("a");
    link.download = `Diffraction_${fileName.replace(/\.[^.]+$/, "")}_annotated.png`;
    link.href = annotatedRef.current.toDataURL("image/png");
    link.click();
  }, [fileName]);

  const handleExportCsv = useCallback(() => {
    if (!calibration || !image) return;
    exportDiffractionCsv({
      fileName,
      imageRows: image.rows,
      imageCols: image.cols,
      voltageKv: parseFloat(voltageKv),
      cameraLengthM: parseFloat(cameraLengthM),
      material,
      centerX: center?.x || 0,
      centerY: center?.y || 0,
      result: calibration,
      annotatedCanvas: annotatedRef.current,
    });
  }, [calibration, image, fileName, voltageKv, cameraLengthM, material, center]);

  const handleExportPdf = useCallback(() => {
    if (!calibration || !image) return;
    exportDiffractionPdf({
      fileName,
      imageRows: image.rows,
      imageCols: image.cols,
      voltageKv: parseFloat(voltageKv),
      cameraLengthM: parseFloat(cameraLengthM),
      material,
      centerX: center?.x || 0,
      centerY: center?.y || 0,
      result: calibration,
      annotatedCanvas: annotatedRef.current,
    });
  }, [calibration, image, fileName, voltageKv, cameraLengthM, material, center]);

  const handleReset = useCallback(() => {
    setImage(null);
    setFileName("");
    setCenter(null);
    setCandidates([]);
    setProfileData(null);
    setAssignments([]);
    setCalibration(null);
    setError(null);
    setPhase("upload");
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Home
            </button>
            <div className="w-px h-6 bg-slate-200" />
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center">
                <Aperture className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-slate-800 leading-tight">
                  TEM Diffraction Calibration
                </h1>
                <p className="text-xs text-slate-500 leading-tight">
                  Calibrate diffraction patterns with reference materials
                </p>
              </div>
            </div>
          </div>
          {image && (
            <button
              onClick={handleReset}
              className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition"
            >
              Reset
            </button>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {error && (
          <div className="mb-6 flex items-start gap-2 rounded-lg bg-rose-50 border border-rose-200 px-4 py-3">
            <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-rose-600">{error}</p>
          </div>
        )}

        {/* Phase 1: Upload */}
        {phase === "upload" && (
          <div className="max-w-2xl mx-auto">
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              className="bg-white rounded-2xl border-2 border-dashed border-slate-300 p-12 text-center hover:border-emerald-400 transition cursor-pointer"
              onClick={() => {
                const input = document.createElement("input");
                input.type = "file";
                input.accept = ".tif,.tiff,.png,.jpg,.jpeg,.bmp";
                input.onchange = (e) => {
                  const f = (e.target as HTMLInputElement).files?.[0];
                  if (f) handleFileSelect(f);
                };
                input.click();
              }}
            >
              {loading ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
                  <p className="text-sm text-slate-500">Memuat gambar...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center">
                    <Upload className="w-8 h-8 text-emerald-600" />
                  </div>
                  <p className="text-lg font-semibold text-slate-700">
                    Unggah Citra Pola Difraksi TEM
                  </p>
                  <p className="text-sm text-slate-400">
                    Klik atau drag file ke sini. Format: TIFF, PNG, JPEG, BMP
                  </p>
                </div>
              )}
            </div>
            <p className="mt-4 text-center text-sm text-slate-500">
              Determine the physical calibration scale of TEM diffraction patterns
              using crystallographic reference spacings and instrument parameters.
            </p>
          </div>
        )}

        {/* Phases 2+: Image + controls */}
        {image && phase !== "upload" && (
          <div className="grid lg:grid-cols-[1fr_360px] gap-6">
            {/* Left: Image canvas */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm text-slate-500">
                  {image.cols} × {image.rows} px
                  {center && (
                    <span className="ml-3 text-slate-400">
                      Center: ({center.x.toFixed(1)}, {center.y.toFixed(1)})
                    </span>
                  )}
                </div>
                {phase === "center" && (
                  <div className="flex items-center gap-2 text-sm text-amber-600 font-medium">
                    <Target className="w-4 h-4" />
                    Klik pusat transmitted beam
                  </div>
                )}
              </div>
              <div style={{ display: "flex", justifyContent: "center" }}>
                <div className="relative" style={{ width: displayWidth, height: displayHeight }}>
                  <canvas
                    ref={canvasRef}
                    width={displayWidth}
                    height={displayHeight}
                    className="absolute inset-0 rounded-lg"
                    style={{ pointerEvents: "none", imageRendering: "auto" }}
                  />
                  <canvas
                    ref={overlayRef}
                    width={displayWidth}
                    height={displayHeight}
                    className="absolute inset-0 rounded-lg"
                    style={{
                      touchAction: "none",
                      cursor: phase === "center" || phase === "params" ? "crosshair" : "default",
                    }}
                    onPointerDown={handleCanvasClick}
                  />
                </div>
              </div>

              {/* Ring/label toggles */}
              {(candidates.length > 0 || calibration) && (
                <div className="mt-3 flex items-center gap-4 justify-center">
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={showRings}
                      onChange={(e) => setShowRings(e.target.checked)}
                      className="rounded"
                    />
                    Show rings
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={showLabels}
                      onChange={(e) => setShowLabels(e.target.checked)}
                      className="rounded"
                    />
                    Show labels
                  </label>
                </div>
              )}
            </div>

            {/* Right: Control panel */}
            <div className="space-y-4">
              {/* Instrument parameters */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <h3 className="text-sm font-bold text-slate-800 mb-4">Instrument Parameters</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Accelerating Voltage (kV)
                    </label>
                    <input
                      type="number"
                      value={voltageKv}
                      onChange={(e) => {
                        setVoltageKv(e.target.value);
                        setCalibration(null);
                      }}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Camera Length (m)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={cameraLengthM}
                      onChange={(e) => {
                        setCameraLengthM(e.target.value);
                        setCalibration(null);
                      }}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Reference Material
                    </label>
                    <select
                      value={materialId}
                      onChange={(e) => {
                        setMaterialId(e.target.value);
                        setAssignments([]);
                        setCalibration(null);
                      }}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      {DIFFRACTION_MATERIALS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.formula})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Computed values */}
                <div className="mt-4 pt-4 border-t border-slate-100 space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Electron wavelength</span>
                    <span className="font-mono text-slate-700">
                      {isFinite(wavelength) ? `${wavelength.toFixed(6)} Å` : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Camera constant Lλ</span>
                    <span className="font-mono text-slate-700">
                      {isFinite(camConst) ? `${camConst.toFixed(6)} mm·Å` : "—"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Center selection */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Crosshair className="w-4 h-4 text-slate-600" />
                  <h3 className="text-sm font-bold text-slate-800">Diffraction Center</h3>
                </div>
                {center ? (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500 font-mono">
                      ({center.x.toFixed(1)}, {center.y.toFixed(1)})
                    </span>
                    <button
                      onClick={() => {
                        setCenter(null);
                        setCandidates([]);
                        setAssignments([]);
                        setCalibration(null);
                        setPhase("params");
                      }}
                      className="text-xs text-emerald-600 hover:text-emerald-700 font-medium"
                    >
                      Reset center
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">
                    Klik pada citra untuk menentukan pusat transmitted beam.
                  </p>
                )}
                {center && candidates.length === 0 && !detecting && (
                  <button
                    onClick={handleDetectRings}
                    className="mt-3 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition"
                  >
                    <Aperture className="w-4 h-4" />
                    Detect Ring Candidates
                  </button>
                )}
                {detecting && (
                  <div className="mt-3 flex items-center justify-center gap-2 text-sm text-emerald-600">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Detecting rings...
                  </div>
                )}
              </div>

              {/* Reference table */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <h3 className="text-sm font-bold text-slate-800 mb-3">
                  {material.name} ({material.formula}) — Reference d-spacings
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-400 border-b border-slate-100">
                        <th className="text-left py-1.5 font-medium">hkl</th>
                        <th className="text-right py-1.5 font-medium">d (Å)</th>
                        <th className="text-right py-1.5 font-medium">R (mm)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {material.references.map((ref, i) => {
                        const R = theoreticalRadiusMm(camConst, ref.dSpacingA);
                        const assigned = assignments.some((a) => a.refIndex === i);
                        return (
                          <tr key={ref.hkl} className={assigned ? "bg-emerald-50" : ""}>
                            <td className="py-1.5 font-mono text-slate-700">{ref.hkl}</td>
                            <td className="text-right font-mono text-slate-600">{ref.dSpacingA.toFixed(4)}</td>
                            <td className="text-right font-mono text-slate-500">
                              {isFinite(R) ? R.toFixed(4) : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Ring candidates + matching */}
              {candidates.length > 0 && !calibration && (
                <div className="bg-white rounded-2xl border border-slate-200 p-5">
                  <h3 className="text-sm font-bold text-slate-800 mb-3">
                    Ring Matching ({candidates.length} candidates)
                  </h3>
                  <p className="text-xs text-slate-400 mb-3">
                    Pilih referensi hkl untuk setiap kandidat cincin yang sesuai.
                  </p>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {candidates.map((cand) => {
                      const assigned = assignments.find((a) => a.candidateIndex === cand.index);
                      const color = RING_COLORS[(cand.index - 1) % RING_COLORS.length];
                      return (
                        <div key={cand.index} className="flex items-center gap-2 text-xs">
                          <span
                            className="w-5 h-5 rounded-full flex items-center justify-center font-bold text-white text-[10px] flex-shrink-0"
                            style={{ backgroundColor: color }}
                          >
                            {cand.index}
                          </span>
                          <span className="font-mono text-slate-600 flex-shrink-0 w-20">
                            {cand.radiusPx.toFixed(1)} px
                          </span>
                          <select
                            value={assigned ? assigned.refIndex : -1}
                            onChange={(e) => {
                              const refIdx = parseInt(e.target.value);
                              if (refIdx >= 0) {
                                handleAddAssignment(cand.index, refIdx);
                              } else {
                                handleRemoveAssignment(cand.index);
                              }
                            }}
                            className="flex-1 px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          >
                            <option value={-1}>— unassigned —</option>
                            {material.references.map((ref, i) => (
                              <option key={ref.hkl} value={i}>
                                {ref.hkl} (d={ref.dSpacingA.toFixed(3)} Å)
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                  <button
                    onClick={handleComputeCalibration}
                    disabled={assignments.length === 0}
                    className="mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Check className="w-4 h-4" />
                    Compute Calibration ({assignments.length} rings)
                  </button>
                </div>
              )}

              {/* Results */}
              {calibration && (
                <div className="space-y-4">
                  <div className="bg-white rounded-2xl border border-slate-200 p-5">
                    <h3 className="text-sm font-bold text-slate-800 mb-4">Calibration Results</h3>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-500">Electron wavelength</span>
                        <span className="font-mono text-slate-700">
                          {calibration.wavelengthA.toFixed(6)} Å
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-500">Camera constant</span>
                        <span className="font-mono text-slate-700">
                          {calibration.cameraConstantMmA.toFixed(6)} mm·Å
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-500">Rings used</span>
                        <span className="font-mono text-slate-700">{calibration.ringCount}</span>
                      </div>
                      <div className="border-t border-slate-100 pt-2 mt-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-500">Calibration scale</span>
                          <span className="font-mono text-slate-700">
                            {calibration.scaleMmPerPx.toExponential(4)} mm/px
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-500">Calibration scale</span>
                          <span className="font-mono text-lg font-bold text-emerald-600">
                            {calibration.scaleNmPerPx.toFixed(3)} nm/px
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-500">Pixel density</span>
                          <span className="font-mono text-slate-700">
                            {calibration.pixelPerMm.toFixed(2)} px/mm
                          </span>
                        </div>
                      </div>
                    </div>

                    {calibration.hasWarning && calibration.warningMessage && (
                      <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                        <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-700">{calibration.warningMessage}</p>
                      </div>
                    )}
                  </div>

                  {/* Per-ring table */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-5">
                    <h3 className="text-sm font-bold text-slate-800 mb-3">Per-Ring Calibration</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-slate-400 border-b border-slate-100">
                            <th className="text-left py-1.5 font-medium">hkl</th>
                            <th className="text-right py-1.5 font-medium">d (Å)</th>
                            <th className="text-right py-1.5 font-medium">R th (mm)</th>
                            <th className="text-right py-1.5 font-medium">R px</th>
                            <th className="text-right py-1.5 font-medium">nm/px</th>
                          </tr>
                        </thead>
                        <tbody>
                          {calibration.matches.map((m) => (
                            <tr key={m.hkl}>
                              <td className="py-1.5 font-mono text-slate-700">{m.hkl}</td>
                              <td className="text-right font-mono text-slate-600">{m.dSpacingA.toFixed(4)}</td>
                              <td className="text-right font-mono text-slate-500">{m.theoreticalRadiusMm.toFixed(4)}</td>
                              <td className="text-right font-mono text-slate-600">{m.radiusPx.toFixed(2)}</td>
                              <td className="text-right font-mono text-slate-700">{m.scaleNmPerPx.toFixed(3)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Export buttons */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-5">
                    <h3 className="text-sm font-bold text-slate-800 mb-3">Export Results</h3>
                    <div className="grid grid-cols-1 gap-2">
                      <button
                        onClick={handleExportPng}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-700 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition"
                      >
                        <ImageIcon className="w-4 h-4" />
                        Download Annotated PNG
                      </button>
                      <button
                        onClick={handleExportCsv}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-700 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition"
                      >
                        <Table className="w-4 h-4" />
                        Download CSV
                      </button>
                      <button
                        onClick={handleExportPdf}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition"
                      >
                        <FileText className="w-4 h-4" />
                        Download PDF Report
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Hidden annotated canvas for export */}
        {image && calibration && (
          <canvas
            ref={annotatedRef}
            width={image.cols}
            height={image.rows}
            className="hidden"
          />
        )}
      </main>
    </div>
  );
}
