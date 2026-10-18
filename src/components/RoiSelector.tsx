/**
 * Interactive ROI selector with two-click model:
 *   1. First click  → set start corner
 *   2. Move pointer  → live preview rectangle
 *   3. Second click  → lock end corner
 *   4. "Proses ROI" button appears; user clicks it to confirm
 *
 * Works with mouse, touch, and pen via Pointer Events.
 *
 * Optional Wiener image filtering (Marks, L. D. 1996) can be applied
 * to the cropped ROI before it enters the analysis pipeline.
 */
import { useRef, useState, useCallback, useEffect } from "react";
import { cropRoi, squareCenterCrop, type LoadedImage } from "@/lib/tiff";
import { renderGrayscaleToCanvas } from "@/lib/render";
import { wienerFilterRoi, type WienerMethod } from "@/lib/wiener";
import { Sparkles, Eye, Check, Undo2, AlertCircle } from "lucide-react";

interface RoiSelectorProps {
  image: LoadedImage;
  nmPerPx: number;
  onConfirm: (roi: {
    data: Float64Array;
    rows: number;
    cols: number;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }) => void;
  onBack: () => void;
}

type SelectionPhase = "idle" | "drawing" | "locked";

interface Rect {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

const MAX_DISPLAY_WIDTH = 700;

const FILTER_OPTIONS: { value: WienerMethod; label: string }[] = [
  { value: "conventional", label: "Conventional Wiener Filter" },
  { value: "parametric", label: "Parametric Wiener Filter" },
  { value: "cannon", label: "Cannon Filter" },
  {
    value: "random_phase_parametric",
    label: "Random-Phase Parametric Wiener Filter (Experimental)",
  },
];

export default function RoiSelector({
  image,
  nmPerPx,
  onConfirm,
  onBack,
}: RoiSelectorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const previewOrigRef = useRef<HTMLCanvasElement>(null);
  const previewFilteredRef = useRef<HTMLCanvasElement>(null);

  const [phase, setPhase] = useState<SelectionPhase>("idle");
  const [rect, setRect] = useState<Rect | null>(null);

  // Wiener filter state
  const [filterMethod, setFilterMethod] = useState<WienerMethod | "none">("none");
  const [noiseScale, setNoiseScale] = useState("1.0");
  const [regularization, setRegularization] = useState("1.0");
  const [stabilization, setStabilization] = useState("0.05");
  const [filterError, setFilterError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<Float64Array | null>(null);
  const [previewDims, setPreviewDims] = useState<{ rows: number; cols: number } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [filterApplied, setFilterApplied] = useState(false);
  const [appliedFilterData, setAppliedFilterData] = useState<Float64Array | null>(null);
  const [appliedFilterDims, setAppliedFilterDims] = useState<{ rows: number; cols: number } | null>(null);
  const [filterProcessing, setFilterProcessing] = useState(false);

  // Refs so pointer handlers always see current values without stale closures
  const phaseRef = useRef<SelectionPhase>("idle");
  const rectRef = useRef<Rect | null>(null);

  const displayWidth = Math.min(MAX_DISPLAY_WIDTH, image.cols);
  const displayHeight = Math.round((displayWidth * image.rows) / image.cols);
  const scale = displayWidth / image.cols;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderGrayscaleToCanvas(
      canvas,
      image.data,
      image.rows,
      image.cols,
      displayWidth,
      displayHeight,
    );
  }, [image, displayWidth, displayHeight]);

  // Draw overlay whenever rect or phase changes
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!rect) return;

    const x = Math.min(rect.startX, rect.endX);
    const y = Math.min(rect.startY, rect.endY);
    const w = Math.abs(rect.endX - rect.startX);
    const h = Math.abs(rect.endY - rect.startY);

    if (w < 1 || h < 1) {
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(rect.startX - 8, rect.startY);
      ctx.lineTo(rect.startX + 8, rect.startY);
      ctx.moveTo(rect.startX, rect.startY - 8);
      ctx.lineTo(rect.startX, rect.startY + 8);
      ctx.stroke();
      return;
    }

    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.fillRect(0, 0, canvas.width, y);
    ctx.fillRect(0, y, x, h);
    ctx.fillRect(x + w, y, canvas.width - x - w, h);
    ctx.fillRect(0, y + h, canvas.width, canvas.height - y - h);

    ctx.strokeStyle = phase === "locked" ? "#22c55e" : "#f59e0b";
    ctx.lineWidth = phase === "locked" ? 3 : 2;
    ctx.setLineDash(phase === "locked" ? [] : [6, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);

    if (phase === "locked") {
      ctx.fillStyle = "#22c55e";
      for (const [hx, hy] of [
        [x, y],
        [x + w, y],
        [x, y + h],
        [x + w, y + h],
      ]) {
        ctx.beginPath();
        ctx.arc(hx, hy, 4, 0, 2 * Math.PI);
        ctx.fill();
      }
    }

    const imgW = w / scale;
    const imgH = h / scale;
    ctx.fillStyle = phase === "locked" ? "#22c55e" : "#f59e0b";
    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "left";
    const labelY = y > 20 ? y - 6 : y + h + 16;
    ctx.fillText(
      `${Math.round(imgW)}×${Math.round(imgH)} px (square)  (${(imgW * nmPerPx).toFixed(1)}×${(imgH * nmPerPx).toFixed(1)} nm)`,
      x + 4,
      labelY,
    );
  }, [rect, phase, scale, nmPerPx]);

  // Render preview canvases
  useEffect(() => {
    if (!showPreview) return;
    const origCanvas = previewOrigRef.current;
    const filteredCanvas = previewFilteredRef.current;
    if (!origCanvas || !filteredCanvas) return;

    const d = rectRef.current;
    if (!d) return;

    const x1 = Math.min(d.startX, d.endX) / scale;
    const y1 = Math.min(d.startY, d.endY) / scale;
    const x2 = Math.max(d.startX, d.endX) / scale;
    const y2 = Math.max(d.startY, d.endY) / scale;

    const cropped = cropRoi(image.data, image.rows, image.cols, x1, y1, x2, y2);
    const squared = squareCenterCrop(cropped.data, cropped.rows, cropped.cols);

    const dispSize = Math.min(300, squared.rows, squared.cols);
    renderGrayscaleToCanvas(origCanvas, squared.data, squared.rows, squared.cols, dispSize, dispSize);

    if (previewData && previewDims) {
      renderGrayscaleToCanvas(filteredCanvas, previewData, previewDims.rows, previewDims.cols, dispSize, dispSize);
    } else {
      renderGrayscaleToCanvas(filteredCanvas, squared.data, squared.rows, squared.cols, dispSize, dispSize);
    }
  }, [showPreview, previewData, previewDims, image, scale]);

  const getPos = useCallback((e: React.PointerEvent) => {
    const canvas = overlayRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * canvas.width,
      y: ((e.clientY - r.top) / r.height) * canvas.height,
    };
  }, []);

  // Compute a square rect from a start point to a free pointer position.
  // The square size = max(|dx|, |dy|); direction follows the pointer.
  const makeSquare = useCallback(
    (startX: number, startY: number, px: number, py: number): Rect => {
      const dx = px - startX;
      const dy = py - startY;
      const size = Math.max(Math.abs(dx), Math.abs(dy));
      const sx = dx >= 0 ? 1 : -1;
      const sy = dy >= 0 ? 1 : -1;
      let endX = startX + sx * size;
      let endY = startY + sy * size;

      // Clamp within canvas bounds, preserving the square by shrinking both dims
      const canvas = overlayRef.current;
      if (canvas) {
        const cw = canvas.width;
        const ch = canvas.height;
        if (endX < 0) {
          endX = 0;
          endY = startY + sy * (endX - startX === 0 ? 0 : Math.abs(endX - startX));
        }
        if (endX > cw) {
          const clampedSize = cw - startX;
          if (clampedSize < size) {
            endX = cw;
            endY = startY + sy * clampedSize;
          }
        }
        if (endY < 0) {
          endY = 0;
          const clampedSize = Math.abs(endY - startY);
          endX = startX + sx * clampedSize;
        }
        if (endY > ch) {
          const clampedSize = ch - startY;
          endY = ch;
          endX = startX + sx * clampedSize;
        }
      }
      return { startX, startY, endX, endY };
    },
    [],
  );

  const handleClick = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const pos = getPos(e);

      if (phaseRef.current === "idle") {
        const newRect = { startX: pos.x, startY: pos.y, endX: pos.x, endY: pos.y };
        rectRef.current = newRect;
        setRect(newRect);
        phaseRef.current = "drawing";
        setPhase("drawing");
        setFilterApplied(false);
        setAppliedFilterData(null);
        setAppliedFilterDims(null);
        setShowPreview(false);
        setPreviewData(null);
      } else if (phaseRef.current === "drawing") {
        const cur = rectRef.current;
        if (!cur) return;
        const locked = makeSquare(cur.startX, cur.startY, pos.x, pos.y);
        rectRef.current = locked;
        setRect(locked);
        phaseRef.current = "locked";
        setPhase("locked");
        setFilterApplied(false);
        setAppliedFilterData(null);
        setAppliedFilterDims(null);
        setShowPreview(false);
        setPreviewData(null);
      }
    },
    [getPos, makeSquare],
  );

  const handleMove = useCallback(
    (e: React.PointerEvent) => {
      if (phaseRef.current !== "drawing") return;
      e.preventDefault();
      const pos = getPos(e);
      const cur = rectRef.current;
      if (!cur) return;
      const updated = makeSquare(cur.startX, cur.startY, pos.x, pos.y);
      rectRef.current = updated;
      setRect(updated);
    },
    [getPos, makeSquare],
  );

  const handleReset = useCallback(() => {
    rectRef.current = null;
    setRect(null);
    phaseRef.current = "idle";
    setPhase("idle");
    setFilterError(null);
    setPreviewData(null);
    setPreviewDims(null);
    setShowPreview(false);
    setFilterApplied(false);
    setAppliedFilterData(null);
    setAppliedFilterDims(null);
  }, []);

  // ── Wiener filter helpers ──

  const getCroppedRoi = useCallback(() => {
    const d = rectRef.current;
    if (!d) return null;
    const x1 = Math.min(d.startX, d.endX) / scale;
    const y1 = Math.min(d.startY, d.endY) / scale;
    const x2 = Math.max(d.startX, d.endX) / scale;
    const y2 = Math.max(d.startY, d.endY) / scale;
    if (x2 - x1 < 10 || y2 - y1 < 10) return null;

    const cropped = cropRoi(image.data, image.rows, image.cols, x1, y1, x2, y2);
    const squared = squareCenterCrop(cropped.data, cropped.rows, cropped.cols);
    return squared;
  }, [image, scale]);

  const validateParams = useCallback((): string | null => {
    const roi = getCroppedRoi();
    if (!roi) return "ROI belum dipilih.";
    if (roi.rows < 16 || roi.cols < 16) {
      return "Ukuran ROI minimal 16 × 16 piksel.";
    }
    const ns = parseFloat(noiseScale);
    if (isNaN(ns) || ns <= 0) return "Noise Scale harus lebih besar dari 0.";
    if (filterMethod === "parametric" || filterMethod === "random_phase_parametric") {
      const reg = parseFloat(regularization);
      if (isNaN(reg) || reg <= 0) return "Regularization (λ) harus lebih besar dari 0.";
    }
    if (filterMethod === "random_phase_parametric") {
      const stab = parseFloat(stabilization);
      if (isNaN(stab) || stab < 0) return "Stabilization tidak boleh negatif.";
    }
    return null;
  }, [getCroppedRoi, noiseScale, regularization, stabilization, filterMethod]);

  const handlePreviewFilter = useCallback(() => {
    const err = validateParams();
    if (err) {
      setFilterError(err);
      setPreviewData(null);
      setShowPreview(true);
      return;
    }

    const roi = getCroppedRoi();
    if (!roi) return;

    const method = filterMethod as WienerMethod;
    const ns = parseFloat(noiseScale);
    const reg = parseFloat(regularization);
    const stab = parseFloat(stabilization);
    const roiData = roi.data;
    const roiRows = roi.rows;
    const roiCols = roi.cols;

    setFilterProcessing(true);
    setShowPreview(true);
    setPreviewData(null);

    setTimeout(() => {
      try {
        const result = wienerFilterRoi(roiData, roiRows, roiCols, {
          method,
          noiseScale: ns,
          regularization: reg,
          stabilization: stab,
        });
        setPreviewData(result.data);
        setPreviewDims({ rows: result.rows, cols: result.cols });
        setFilterError(null);
      } catch (e) {
        setFilterError(e instanceof Error ? e.message : "Filter gagal dijalankan.");
        setPreviewData(null);
      } finally {
        setFilterProcessing(false);
      }
    }, 50);
  }, [validateParams, getCroppedRoi, filterMethod, noiseScale, regularization, stabilization]);

  const handleApplyFilter = useCallback(() => {
    const err = validateParams();
    if (err) {
      setFilterError(err);
      return;
    }

    const roi = getCroppedRoi();
    if (!roi) return;

    // If we already have preview data, use it; otherwise compute
    if (previewData && previewDims) {
      setAppliedFilterData(previewData);
      setAppliedFilterDims(previewDims);
      setFilterApplied(true);
      setFilterError(null);
      return;
    }

    const method = filterMethod as WienerMethod;
    const ns = parseFloat(noiseScale);
    const reg = parseFloat(regularization);
    const stab = parseFloat(stabilization);
    const roiData = roi.data;
    const roiRows = roi.rows;
    const roiCols = roi.cols;

    setFilterProcessing(true);

    setTimeout(() => {
      try {
        const result = wienerFilterRoi(roiData, roiRows, roiCols, {
          method,
          noiseScale: ns,
          regularization: reg,
          stabilization: stab,
        });
        setAppliedFilterData(result.data);
        setAppliedFilterDims({ rows: result.rows, cols: result.cols });
        setFilterApplied(true);
        setFilterError(null);
      } catch (e) {
        setFilterError(e instanceof Error ? e.message : "Filter gagal dijalankan.");
      } finally {
        setFilterProcessing(false);
      }
    }, 50);
  }, [validateParams, getCroppedRoi, filterMethod, noiseScale, regularization, stabilization, previewData, previewDims]);

  const handleResetFilter = useCallback(() => {
    setFilterApplied(false);
    setAppliedFilterData(null);
    setAppliedFilterDims(null);
    setPreviewData(null);
    setPreviewDims(null);
    setShowPreview(false);
    setFilterError(null);
    setFilterProcessing(false);
  }, []);

  const handleConfirm = useCallback(() => {
    const d = rectRef.current;
    if (!d) return;
    const x1 = Math.min(d.startX, d.endX) / scale;
    const y1 = Math.min(d.startY, d.endY) / scale;
    const x2 = Math.max(d.startX, d.endX) / scale;
    const y2 = Math.max(d.startY, d.endY) / scale;

    if (x2 - x1 < 10 || y2 - y1 < 10) return;

    // If filter was applied, use the filtered data; otherwise crop from original
    if (filterApplied && appliedFilterData && appliedFilterDims) {
      onConfirm({
        data: appliedFilterData,
        rows: appliedFilterDims.rows,
        cols: appliedFilterDims.cols,
        x1,
        y1,
        x2,
        y2,
      });
    } else {
      const cropped = cropRoi(image.data, image.rows, image.cols, x1, y1, x2, y2);
      const squared = squareCenterCrop(cropped.data, cropped.rows, cropped.cols);
      onConfirm({
        data: squared.data,
        rows: squared.rows,
        cols: squared.cols,
        x1,
        y1,
        x2,
        y2,
      });
    }
  }, [scale, image, onConfirm, filterApplied, appliedFilterData, appliedFilterDims]);

  const hasValidSelection =
    rect &&
    Math.abs(rect.endX - rect.startX) > 10 &&
    Math.abs(rect.endY - rect.startY) > 10;

  const cursorStyle =
    phase === "idle"
      ? "crosshair"
      : phase === "drawing"
        ? "crosshair"
        : "default";

  const needsRegularization = filterMethod === "parametric" || filterMethod === "random_phase_parametric";
  const needsStabilization = filterMethod === "random_phase_parametric";
  const validationError = validateParams();
  const canApply = !validationError && phase === "locked" && hasValidSelection && filterMethod !== "none";

  return (
    <div className="max-w-5xl mx-auto">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-800">
              Pilih Region of Interest (ROI)
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Klik kiri untuk menentukan titik awal, gerakkan kursor untuk
              melihat preview, lalu klik kiri lagi untuk mengunci ROI.
            </p>
          </div>
          <button
            onClick={onBack}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition"
          >
            Kembali
          </button>
        </div>

        {/* Instruction banner */}
        <div
          className={`mb-3 rounded-lg px-4 py-2 text-sm font-medium text-center transition ${
            phase === "idle"
              ? "bg-amber-50 text-amber-700"
              : phase === "drawing"
                ? "bg-blue-50 text-blue-700"
                : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {phase === "idle" &&
            "Klik kiri pada gambar untuk menentukan titik awal ROI"}
          {phase === "drawing" &&
            "Gerakkan kursor untuk atur ukuran, lalu klik kiri lagi untuk mengunci"}
          {phase === "locked" && "ROI terkunci — klik tombol Proses ROI untuk lanjut"}
        </div>

        <div style={{ display: "flex", justifyContent: "center" }}>
          <div
            className="relative"
            style={{ width: displayWidth, height: displayHeight }}
          >
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
              style={{ touchAction: "none", cursor: cursorStyle }}
              onPointerDown={handleClick}
              onPointerMove={handleMove}
            />
          </div>
        </div>

        {/* Action buttons */}
        <div className="mt-4 flex items-center justify-center gap-3">
          {phase === "locked" && hasValidSelection && (
            <>
              <button
                onClick={handleConfirm}
                className="px-6 py-2.5 bg-amber-600 text-white font-semibold rounded-lg hover:bg-amber-700 transition shadow-sm"
              >
                Proses ROI
              </button>
              <button
                onClick={handleReset}
                className="px-4 py-2.5 bg-white border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition"
              >
                Ulangi Pilihan
              </button>
            </>
          )}
          {phase === "locked" && !hasValidSelection && (
            <>
              <p className="text-sm text-rose-600">
                ROI terlalu kecil. Silakan ulangi pilihan.
              </p>
              <button
                onClick={handleReset}
                className="px-4 py-2.5 bg-white border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition"
              >
                Ulangi Pilihan
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Wiener Filter Panel ── */}
      {phase === "locked" && hasValidSelection && (
        <div className="mt-6 bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-5 h-5 text-blue-600" />
            <h3 className="text-lg font-semibold text-slate-800">
              Image Filter (Wiener)
            </h3>
            {filterApplied && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                <Check className="w-3 h-3" /> Filter aktif
              </span>
            )}
          </div>

          <p className="text-sm text-slate-500 mb-4">
            Pilih filter untuk meningkatkan kualitas citra ROI sebelum analisis.
            Filter bersifat opsional — pilih "None" untuk mempertahankan citra asli.
          </p>

          {/* Filter method dropdown */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Image Filter
            </label>
            <select
              value={filterMethod}
              onChange={(e) => {
                setFilterMethod(e.target.value as WienerMethod | "none");
                setFilterError(null);
                setShowPreview(false);
                setPreviewData(null);
                setFilterApplied(false);
                setAppliedFilterData(null);
                setAppliedFilterDims(null);
              }}
              className="w-full max-w-md px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="none">None</option>
              {FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Filter parameters */}
          {filterMethod !== "none" && (
            <div className="grid sm:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  Noise Scale
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={noiseScale}
                  onChange={(e) => {
                    setNoiseScale(e.target.value);
                    setFilterError(null);
                  }}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
              </div>
              {needsRegularization && (
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">
                    Regularization (λ)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={regularization}
                    onChange={(e) => {
                      setRegularization(e.target.value);
                      setFilterError(null);
                    }}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                </div>
              )}
              {needsStabilization && (
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">
                    Stabilization
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={stabilization}
                    onChange={(e) => {
                      setStabilization(e.target.value);
                      setFilterError(null);
                    }}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                </div>
              )}
            </div>
          )}

          {/* Experimental notice */}
          {filterMethod === "random_phase_parametric" && (
            <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
              <p className="text-xs text-amber-700">
                <strong>Experimental:</strong> Random-Phase Parametric Wiener
                menggunakan pendekatan stabilisasi, bukan implementasi penuh
                formulasi variational random-phase.
              </p>
            </div>
          )}

          {/* Validation error */}
          {filterError && filterMethod !== "none" && (
            <div className="mb-4 flex items-start gap-2 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2">
              <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-rose-600">{filterError}</p>
            </div>
          )}

          {/* Filter action buttons */}
          {filterMethod !== "none" && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handlePreviewFilter}
                disabled={phase !== "locked" || !hasValidSelection || filterProcessing}
                className="inline-flex items-center gap-2 px-4 py-2 bg-slate-700 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Eye className="w-4 h-4" />
                Preview Filter
              </button>
              <button
                onClick={handleApplyFilter}
                disabled={!canApply || filterProcessing}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Check className="w-4 h-4" />
                Apply Filter
              </button>
              {filterApplied && (
                <button
                  onClick={handleResetFilter}
                  disabled={filterProcessing}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Undo2 className="w-4 h-4" />
                  Reset Filter
                </button>
              )}
            </div>
          )}

          {/* Processing indicator */}
          {filterProcessing && (
            <div className="mt-4 flex items-center gap-2 text-sm text-blue-600">
              <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              Memproses filter Wiener...
            </div>
          )}

          {/* Preview comparison */}
          {showPreview && filterMethod !== "none" && !filterProcessing && (
            <div className="mt-6">
              <h4 className="text-sm font-semibold text-slate-700 mb-3">
                Perbandingan Citra
              </h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-2 text-center">
                    ROI Asli
                  </p>
                  <div className="flex justify-center">
                    <canvas
                      ref={previewOrigRef}
                      className="rounded-lg border border-slate-200"
                      style={{ imageRendering: "pixelated", maxWidth: "100%" }}
                    />
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-2 text-center">
                    Hasil Filter
                  </p>
                  <div className="flex justify-center">
                    <canvas
                      ref={previewFilteredRef}
                      className="rounded-lg border border-slate-200"
                      style={{ imageRendering: "pixelated", maxWidth: "100%" }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
