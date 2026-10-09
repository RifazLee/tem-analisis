/**
 * Interactive ROI selector with two-click model:
 *   1. First click  → set start corner
 *   2. Move pointer  → live preview rectangle
 *   3. Second click  → lock end corner
 *   4. "Proses ROI" button appears; user clicks it to confirm
 *
 * Works with mouse, touch, and pen via Pointer Events.
 */
import { useRef, useState, useCallback, useEffect } from "react";
import { cropRoi, squareCenterCrop, type LoadedImage } from "@/lib/tiff";
import { renderGrayscaleToCanvas } from "@/lib/render";

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

export default function RoiSelector({
  image,
  nmPerPx,
  onConfirm,
  onBack,
}: RoiSelectorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  const [phase, setPhase] = useState<SelectionPhase>("idle");
  const [rect, setRect] = useState<Rect | null>(null);

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
      // Draw a small crosshair at the start point
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

    // Dim outside region
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.fillRect(0, 0, canvas.width, y);
    ctx.fillRect(0, y, x, h);
    ctx.fillRect(x + w, y, canvas.width - x - w, h);
    ctx.fillRect(0, y + h, canvas.width, canvas.height - y - h);

    // Selection border — solid when locked, dashed when drawing
    ctx.strokeStyle = phase === "locked" ? "#22c55e" : "#f59e0b";
    ctx.lineWidth = phase === "locked" ? 3 : 2;
    ctx.setLineDash(phase === "locked" ? [] : [6, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);

    // Corner handles when locked
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

    // Dimension label
    const imgW = w / scale;
    const imgH = h / scale;
    ctx.fillStyle = phase === "locked" ? "#22c55e" : "#f59e0b";
    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "left";
    const labelY = y > 20 ? y - 6 : y + h + 16;
    ctx.fillText(
      `${Math.round(imgW)}×${Math.round(imgH)} px  (${(imgW * nmPerPx).toFixed(1)}×${(imgH * nmPerPx).toFixed(1)} nm)`,
      x + 4,
      labelY,
    );
  }, [rect, phase, scale, nmPerPx]);

  const getPos = useCallback((e: React.PointerEvent) => {
    const canvas = overlayRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * canvas.width,
      y: ((e.clientY - r.top) / r.height) * canvas.height,
    };
  }, []);

  // First click: set start. Second click while drawing: lock end.
  const handleClick = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const pos = getPos(e);

      if (phaseRef.current === "idle") {
        // First click — set start point, enter drawing mode
        const newRect = { startX: pos.x, startY: pos.y, endX: pos.x, endY: pos.y };
        rectRef.current = newRect;
        setRect(newRect);
        phaseRef.current = "drawing";
        setPhase("drawing");
      } else if (phaseRef.current === "drawing") {
        // Second click — lock the rectangle
        const cur = rectRef.current;
        if (!cur) return;
        const locked = { ...cur, endX: pos.x, endY: pos.y };
        rectRef.current = locked;
        setRect(locked);
        phaseRef.current = "locked";
        setPhase("locked");
      }
    },
    [getPos],
  );

  // Live preview while drawing
  const handleMove = useCallback(
    (e: React.PointerEvent) => {
      if (phaseRef.current !== "drawing") return;
      e.preventDefault();
      const pos = getPos(e);
      const cur = rectRef.current;
      if (!cur) return;
      const updated = { ...cur, endX: pos.x, endY: pos.y };
      rectRef.current = updated;
      setRect(updated);
    },
    [getPos],
  );

  const handleReset = useCallback(() => {
    rectRef.current = null;
    setRect(null);
    phaseRef.current = "idle";
    setPhase("idle");
  }, []);

  const handleConfirm = useCallback(() => {
    const d = rectRef.current;
    if (!d) return;
    const x1 = Math.min(d.startX, d.endX) / scale;
    const y1 = Math.min(d.startY, d.endY) / scale;
    const x2 = Math.max(d.startX, d.endX) / scale;
    const y2 = Math.max(d.startY, d.endY) / scale;

    if (x2 - x1 < 10 || y2 - y1 < 10) return;

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
  }, [scale, image, onConfirm]);

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
    </div>
  );
}
