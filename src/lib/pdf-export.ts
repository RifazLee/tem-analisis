/**
 * PDF export module — generates a multi-page PDF report containing all
 * analysis results: images, tables, charts, and validation data.
 */
import { jsPDF } from "jspdf";
import type { AnalysisResult } from "./types";

interface CanvasEntry {
  canvas: HTMLCanvasElement;
  title: string;
  caption?: string;
}

const PAGE_W = 210; // A4 mm
const PAGE_H = 297;
const MARGIN = 15;
const CONTENT_W = PAGE_W - MARGIN * 2;

function canvasToImageData(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/png");
}

function fitImageDims(
  imgW: number,
  imgH: number,
  maxW: number,
  maxH: number,
): { w: number; h: number } {
  const ratio = imgW / imgH;
  let w = maxW;
  let h = w / ratio;
  if (h > maxH) {
    h = maxH;
    w = h * ratio;
  }
  return { w, h };
}

export function exportToPdf(
  result: AnalysisResult,
  canvases: Record<string, HTMLCanvasElement | null>,
  fileName: string,
): void {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  let y = MARGIN;

  function ensureSpace(needed: number) {
    if (y + needed > PAGE_H - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  }

  function addHeading(text: string, size = 14) {
    ensureSpace(size + 4);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(size);
    doc.setTextColor(30, 41, 59);
    doc.text(text, MARGIN, y + size * 0.35);
    y += size * 0.5 + 3;
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
    y += 3;
  }

  function addSubHeading(text: string) {
    ensureSpace(8);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(51, 65, 85);
    doc.text(text, MARGIN, y + 3);
    y += 6;
  }

  function addParagraph(text: string, fontSize = 9) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(fontSize);
    doc.setTextColor(100, 116, 139);
    const lines = doc.splitTextToSize(text, CONTENT_W);
    for (const line of lines) {
      ensureSpace(fontSize * 0.5 + 1);
      doc.text(line, MARGIN, y + fontSize * 0.35);
      y += fontSize * 0.5 + 1;
    }
  }

  function addCanvasImage(
    canvas: HTMLCanvasElement,
    title: string,
    caption?: string,
    maxH = 90,
  ) {
    if (!canvas || canvas.width === 0) return;
    addSubHeading(title);
    const imgData = canvasToImageData(canvas);
    const { w, h } = fitImageDims(canvas.width, canvas.height, CONTENT_W, maxH);
    ensureSpace(h + 4);
    const x = MARGIN + (CONTENT_W - w) / 2;
    doc.addImage(imgData, "PNG", x, y, w, h);
    y += h + 2;
    if (caption) {
      addParagraph(caption, 8);
    }
    y += 2;
  }

  function addKeyValueTable(
    headers: string[],
    rows: (string | number)[][],
    colAligns: ("left" | "right" | "center")[],
  ) {
    const colCount = headers.length;
    const colW = CONTENT_W / colCount;
    const rowH = 7;

    ensureSpace(rowH * (rows.length + 1) + 2);

    // Header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setFillColor(241, 245, 249);
    doc.rect(MARGIN, y, CONTENT_W, rowH, "F");
    doc.setTextColor(71, 85, 105);
    for (let c = 0; c < colCount; c++) {
      const tx =
        colAligns[c] === "right"
          ? MARGIN + colW * c + colW - 2
          : colAligns[c] === "center"
            ? MARGIN + colW * c + colW / 2
            : MARGIN + colW * c + 2;
      doc.text(String(headers[c]), tx, y + 4.5, {
        align: colAligns[c] === "right" ? "right" : colAligns[c] === "center" ? "center" : "left",
      });
    }
    y += rowH;

    // Rows
    doc.setFont("helvetica", "normal");
    for (let r = 0; r < rows.length; r++) {
      ensureSpace(rowH);
      if (r % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(MARGIN, y, CONTENT_W, rowH, "F");
      }
      doc.setTextColor(51, 65, 85);
      for (let c = 0; c < colCount; c++) {
        const tx =
          colAligns[c] === "right"
            ? MARGIN + colW * c + colW - 2
            : colAligns[c] === "center"
              ? MARGIN + colW * c + colW / 2
              : MARGIN + colW * c + 2;
        doc.text(String(rows[r][c]), tx, y + 4.5, {
          align: colAligns[c] === "right" ? "right" : colAligns[c] === "center" ? "center" : "left",
        });
      }
      y += rowH;
    }
    y += 3;
  }

  // ── Title page ──
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(30, 41, 59);
  doc.text("Laporan Analisis TEM", MARGIN, y + 8);
  y += 14;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  const dateStr = new Date().toLocaleString("id-ID", {
    dateStyle: "long",
    timeStyle: "short",
  });
  addParagraph(`File: ${fileName}`);
  addParagraph(`Tanggal: ${dateStr}`);
  addParagraph(
    `ROI: ${result.roiRows}\u00d7${result.roiCols} px (${(result.roiRows * result.nmPerPx).toFixed(1)} nm)  |  Skala: ${result.nmPerPx.toFixed(5)} nm/px`,
  );
  y += 4;

  // ── Section 1: Images ──
  addHeading("1. Citra & ROI");
  addCanvasImage(
    canvases.fullImg,
    "Citra lengkap (kotak kuning = ROI)",
    undefined,
    80,
  );
  addCanvasImage(
    canvases.roi,
    `ROI persegi (${result.roiRows}\u00d7${result.roiCols} px = ${(result.roiRows * result.nmPerPx).toFixed(1)} nm)`,
    undefined,
    80,
  );

  // ── Section 2: Spatial Metrics ──
  addHeading("2. Domain Ruang \u2014 Metrik Statistik");
  addKeyValueTable(
    ["Metrik", "Nilai"],
    [
      ["Mean intensity", result.spatial.meanIntensity.toFixed(4)],
      ["RMS contrast / std", result.spatial.rmsContrast.toFixed(4)],
      ["Mean gradient (Sobel)", result.spatial.meanGradient.toFixed(4)],
      ["Laplacian variance", result.spatial.laplacianVariance.toExponential(3)],
      ["Entropy (bits)", result.spatial.entropy.toFixed(4)],
    ],
    ["left", "right"],
  );
  addCanvasImage(
    canvases.hist,
    "Histogram intensitas ROI",
    "Sumbu-Y: probability density P(x). Sumbu-X: intensitas asli level detektor.",
    75,
  );

  // ── Section 3: Frequency Domain ──
  addHeading("3. Domain Frekuensi \u2014 FFT / Diffraction Pattern");
  addCanvasImage(
    canvases.fft,
    "FFT magnitude (log) \u2014 pola diffraction & puncak kisi",
    undefined,
    80,
  );
  const legendParts: string[] = [];
  if (result.latticeReferences.d1 !== null) {
    legendParts.push(`${result.peaks[0]?.plane ?? "d\u2081"}: ${result.latticeReferences.d1.toFixed(3)} nm`);
  }
  if (result.latticeReferences.d2 !== null) {
    legendParts.push(`${result.peaks[1]?.plane ?? "d\u2082"}: ${result.latticeReferences.d2.toFixed(3)} nm`);
  }
  if (legendParts.length > 0) {
    addParagraph(`Acuan kisi: ${legendParts.join(", ")}`);
  }
  y += 2;

  addCanvasImage(
    canvases.fftClean,
    "FFT magnitude (log) \u2014 tanpa penanda (sumbu fx / fy)",
    "Sumbu horizontal = fx, sumbu vertikal = fy (frekuensi spasial nm\u207b\u00b9). Pusat = DC.",
    80,
  );
  addCanvasImage(
    canvases.radial,
    "Profil frekuensi radial (log scale)",
    "Rata-rata magnitude FFT per radius. Garis putus-putus = frekuensi acuan kisi.",
    75,
  );
  addCanvasImage(
    canvases.band,
    "Energi per pita frekuensi",
    undefined,
    70,
  );
  addKeyValueTable(
    ["Pita", "Rentang d", "Energi (%)"],
    [
      ["Low", "d > 2 nm", result.bandEnergy.low.toFixed(2)],
      ["Lattice", "0.29\u20132 nm", result.bandEnergy.lattice.toFixed(2)],
      ["High", "d < 0.29 nm", result.bandEnergy.high.toFixed(2)],
    ],
    ["left", "left", "right"],
  );

  // ── Section 4: Lattice Peaks ──
  addHeading("4. Pengukuran Jarak Kisi dari Puncak FFT");

  addSubHeading("Kalibrasi");
  addKeyValueTable(
    ["Parameter", "Nilai"],
    [
      ["Skala nominal", `${result.calibration.nominal.toFixed(5)} nm/px`],
      ["Skala terkalibrasi", `${result.calibration.calibrated.toFixed(5)} nm/px`],
      ["Perubahan", `${result.calibration.changePercent >= 0 ? "+" : ""}${result.calibration.changePercent.toFixed(2)}%`],
    ],
    ["left", "right"],
  );
  addParagraph(
    `Skala dikalibrasi dari puncak kisi yang terdeteksi (SNR \u2265 ${result.peakSnrThreshold} dB) sesuai material yang dipilih.`,
  );
  y += 2;

  addSubHeading("Tabel Puncak Kisi");
  addKeyValueTable(
    ["Bidang", "d acuan (nm)", "d terukur (nm)", "Error (%)", "Frek (nm\u207b\u00b9)", "Sudut (\u00b0)", "SNR (dB)", "Terdeteksi"],
    result.peaks.map((p) => [
      p.plane,
      p.dRef.toFixed(3),
      p.dMeasured.toFixed(4),
      p.errorPercent.toFixed(2),
      p.frequency.toFixed(4),
      p.angleDeg.toFixed(1),
      p.snrDb.toFixed(1),
      p.detected ? "Ya" : "Tidak",
    ]),
    ["left", "right", "right", "right", "right", "right", "right", "center"],
  );

  addSubHeading("Validasi");
  if (result.angleDiff !== null) {
    addKeyValueTable(
      ["Parameter", "Nilai"],
      [
        ["Sudut antar reflektor", `${result.angleDiff.toFixed(1)}\u00b0`],
        ["Rasio frekuensi", result.freqRatio?.toFixed(3) ?? "N/A"],
      ],
      ["left", "right"],
    );
  } else {
    addParagraph(
      "Kedua reflektor tidak terdeteksi pada ROI ini \u2014 sudut dan rasio frekuensi tidak dapat dihitung.",
    );
  }

  // ── Section 5: Inverse FFT ──
  addHeading("5. Inverse FFT \u2014 Filter Band-pass & Bragg");
  addCanvasImage(
    canvases.origPatch,
    "ROI asli (patch pusat)",
    undefined,
    70,
  );
  addCanvasImage(
    canvases.bandpass,
    `Band-pass (350\u00d7350 px)`,
    `Daya: ${result.filters.bandpassEnergy.toFixed(1)}%`,
    70,
  );
  addCanvasImage(
    canvases.bragg,
    "Bragg filter",
    `Daya: ${result.filters.braggEnergy.toFixed(1)}%`,
    70,
  );
  addParagraph(
    `Hasil inverse FFT memakai bagian real (bukan |nilai|) untuk menghindari rektifikasi sinyal. Patch 350\u00d7350 px diambil dari pusat ROI agar fringe kisi terlihat jelas.`,
  );

  // ── Footer on each page ──
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Laporan Analisis TEM \u2014 ${fileName} \u2014 Halaman ${i}/${pageCount}`,
      MARGIN,
      PAGE_H - 8,
    );
  }

  const safeName = fileName.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_");
  doc.save(`TEM_Analysis_${safeName}.pdf`);
}
