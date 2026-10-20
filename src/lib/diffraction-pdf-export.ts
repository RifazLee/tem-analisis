/**
 * PDF export for TEM Diffraction Calibration results.
 * Uses jsPDF (already a project dependency).
 */
import { jsPDF } from "jspdf";
import type { CalibrationResult } from "./diffraction";
import type { DiffractionMaterial } from "./diffraction-materials";

interface ExportParams {
  fileName: string;
  imageRows: number;
  imageCols: number;
  voltageKv: number;
  cameraLengthM: number;
  material: DiffractionMaterial;
  centerX: number;
  centerY: number;
  result: CalibrationResult;
  annotatedCanvas: HTMLCanvasElement | null;
}

export function exportDiffractionPdf(p: ExportParams): void {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const margin = 15;
  const pageW = 210;
  const pageH = 297;
  const contentW = pageW - margin * 2;
  let y = margin;

  const ensureSpace = (h: number) => {
    if (y + h > pageH - 15) {
      doc.addPage();
      y = margin;
    }
  };

  const heading = (text: string, size = 14) => {
    ensureSpace(size + 4);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(size);
    doc.text(text, margin, y + size * 0.35);
    y += size + 4;
  };

  const paragraph = (text: string, size = 10) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(text, contentW);
    for (const line of lines) {
      ensureSpace(size + 2);
      doc.text(line, margin, y + size * 0.35);
      y += size + 2;
    }
  };

  const keyValue = (pairs: [string, string][], size = 10) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    for (const [k, v] of pairs) {
      ensureSpace(size + 2);
      doc.setFont("helvetica", "bold");
      doc.text(`${k}: `, margin, y + size * 0.35);
      const kw = doc.getTextWidth(`${k}: `);
      doc.setFont("helvetica", "normal");
      doc.text(v, margin + kw, y + size * 0.35);
      y += size + 2;
    }
  };

  const table = (headers: string[], rows: string[][], colWidths: number[]) => {
    ensureSpace(8);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    let x = margin;
    for (let i = 0; i < headers.length; i++) {
      doc.text(headers[i], x, y + 3);
      x += colWidths[i];
    }
    y += 5;
    doc.setDrawColor(200);
    doc.line(margin, y, margin + colWidths.reduce((a, b) => a + b, 0), y);
    y += 3;

    doc.setFont("helvetica", "normal");
    for (const row of rows) {
      ensureSpace(5);
      x = margin;
      for (let i = 0; i < row.length; i++) {
        doc.text(row[i], x, y + 3);
        x += colWidths[i];
      }
      y += 5;
    }
  };

  // Title
  heading("TEM Diffraction Calibration Report", 16);
  paragraph(`Generated: ${new Date().toLocaleString()}`);
  y += 2;

  // Image info
  heading("Image Information", 12);
  keyValue([
    ["File", p.fileName],
    ["Dimensions", `${p.imageCols} × ${p.imageRows} px`],
    ["Diffraction center", `(${p.centerX.toFixed(1)}, ${p.centerY.toFixed(1)}) px`],
  ]);
  y += 2;

  // Instrument parameters
  heading("Instrument Parameters", 12);
  keyValue([
    ["Accelerating voltage", `${p.voltageKv} kV`],
    ["Camera length", `${p.cameraLengthM} m`],
    ["Electron wavelength", `${p.result.wavelengthA.toFixed(6)} Å (${p.result.wavelengthNm.toFixed(4)} nm)`],
    ["Camera constant Lλ", `${p.result.cameraConstantMmA.toFixed(6)} mm·Å`],
  ]);
  y += 2;

  // Reference material
  heading(`Reference Material: ${p.material.name} (${p.material.formula})`, 12);
  paragraph(p.material.description);
  y += 2;

  table(
    ["hkl", "d-ref (Å)", "R theory (mm)", "R measured (px)", "Scale (nm/px)"],
    p.result.matches.map((m) => [
      m.hkl,
      m.dSpacingA.toFixed(4),
      m.theoreticalRadiusMm.toFixed(4),
      m.radiusPx.toFixed(2),
      m.scaleNmPerPx.toFixed(3),
    ]),
    [20, 25, 30, 35, 30],
  );
  y += 4;

  // Calibration results
  heading("Calibration Results", 12);
  keyValue([
    ["Reference rings used", String(p.result.ringCount)],
    ["Calibration scale", `${p.result.scaleMmPerPx.toExponential(4)} mm/px`],
    ["Calibration scale", `${p.result.scaleNmPerPx.toFixed(3)} nm/px`],
    ["Pixel density", `${p.result.pixelPerMm.toFixed(2)} px/mm`],
  ]);

  if (p.result.hasWarning && p.result.warningMessage) {
    y += 2;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(200, 100, 0);
    paragraph(`Warning: ${p.result.warningMessage}`);
    doc.setTextColor(0, 0, 0);
  }
  y += 4;

  // Annotated image
  if (p.annotatedCanvas) {
    heading("Annotated Diffraction Pattern", 12);
    const imgData = p.annotatedCanvas.toDataURL("image/png");
    const imgW = contentW;
    const imgH = (p.annotatedCanvas.height / p.annotatedCanvas.width) * imgW;
    ensureSpace(imgH + 4);
    doc.addImage(imgData, "PNG", margin, y, imgW, Math.min(imgH, pageH - y - 15));
  }

  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`${p.fileName} — page ${i}/${pageCount}`, margin, pageH - 8);
    doc.setTextColor(0);
  }

  const safeName = p.fileName.replace(/[^a-zA-Z0-9_-]/g, "_");
  doc.save(`Diffraction_Calibration_${safeName}.pdf`);
}

/**
 * Export calibration table as CSV.
 */
export function exportDiffractionCsv(p: ExportParams): void {
  const lines: string[] = [];
  lines.push("hkl,d_reference_A,R_theoretical_mm,R_measured_px,scale_nm_per_px");
  for (const m of p.result.matches) {
    lines.push(
      `${m.hkl},${m.dSpacingA.toFixed(4)},${m.theoreticalRadiusMm.toFixed(6)},${m.radiusPx.toFixed(2)},${m.scaleNmPerPx.toFixed(4)}`,
    );
  }
  lines.push("");
  lines.push(`# Electron wavelength (A),${p.result.wavelengthA.toFixed(6)}`);
  lines.push(`# Camera constant (mm·A),${p.result.cameraConstantMmA.toFixed(6)}`);
  lines.push(`# Calibration scale (mm/px),${p.result.scaleMmPerPx.toExponential(6)}`);
  lines.push(`# Calibration scale (nm/px),${p.result.scaleNmPerPx.toFixed(4)}`);
  lines.push(`# Pixel density (px/mm),${p.result.pixelPerMm.toFixed(2)}`);
  lines.push(`# Voltage (kV),${p.voltageKv}`);
  lines.push(`# Camera length (m),${p.cameraLengthM}`);
  lines.push(`# Center (px),${p.centerX.toFixed(1)},${p.centerY.toFixed(1)}`);

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safeName = p.fileName.replace(/[^a-zA-Z0-9_-]/g, "_");
  a.download = `Diffraction_Calibration_${safeName}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
