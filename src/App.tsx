import { useState, useCallback, useRef } from "react";
import { Microscope } from "lucide-react";
import UploadStep from "@/components/UploadStep";
import RoiSelector from "@/components/RoiSelector";
import ProcessingView from "@/components/ProcessingView";
import ResultsView from "@/components/ResultsView";
import { removeInfoBar, type LoadedImage } from "@/lib/tiff";
import { runAnalysis } from "@/lib/analysis";
import type { AnalysisResult, AnalysisStage } from "@/lib/types";

type Step = "upload" | "roi" | "processing" | "results";

interface RoiData {
  data: Float64Array;
  rows: number;
  cols: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function App() {
  const [step, setStep] = useState<Step>("upload");
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [processedImage, setProcessedImage] = useState<{
    data: Float64Array;
    rows: number;
    cols: number;
  } | null>(null);
  const [fileName, setFileName] = useState("");
  const [nmPerPx, setNmPerPx] = useState(0.035);
  const [latticeReferences, setLatticeReferences] = useState<{
    d1: number | null;
    d2: number | null;
  }>({ d1: 0.903, d2: 0.452 });
  const [stage, setStage] = useState<AnalysisStage>("idle");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [roiData, setRoiData] = useState<RoiData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resultRef = useRef<AnalysisResult | null>(null);

  const handleImageLoaded = useCallback(
    (
      img: LoadedImage,
      name: string,
      nm: number,
      barRow: number,
      references: { d1: number | null; d2: number | null },
    ) => {
      // Remove info bar if specified
      if (barRow > 0 && barRow < img.rows) {
        const { data, rows } = removeInfoBar(img.data, img.rows, img.cols, barRow);
        setImage({ ...img, data, rows });
        setProcessedImage({ data, rows, cols: img.cols });
      } else {
        setImage(img);
        setProcessedImage({ data: img.data, rows: img.rows, cols: img.cols });
      }
      setFileName(name);
      setNmPerPx(nm);
      setLatticeReferences(references);
      setError(null);
      setStep("roi");
    },
    [],
  );

  const handleRoiConfirmed = useCallback(
    async (roi: RoiData) => {
      setRoiData(roi);
      setStep("processing");
      setStage("fft");

      try {
        const res = await runAnalysis({
          roiData: roi.data,
          roiRows: roi.rows,
          roiCols: roi.cols,
          nmPerPx,
          useLatticeCalibration: latticeReferences.d1 !== null || latticeReferences.d2 !== null,
          latticeReferences,
          onStage: (s) => setStage(s as AnalysisStage),
        });

        // Fill in image dimensions
        if (processedImage) {
          res.imageRows = processedImage.rows;
          res.imageCols = processedImage.cols;
        }

        resultRef.current = res;
        setResult(res);
        // Small delay so the "done" state shows briefly
        setTimeout(() => setStep("results"), 600);
      } catch (err) {
        setError(
          `Analisis gagal: ${err instanceof Error ? err.message : "kesalahan tidak dikenal"}`,
        );
        setStep("upload");
      }
    },
    [nmPerPx, processedImage, latticeReferences],
  );

  const handleReset = useCallback(() => {
    setStep("upload");
    setImage(null);
    setProcessedImage(null);
    setResult(null);
    setRoiData(null);
    setStage("idle");
    setError(null);
    resultRef.current = null;
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top bar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center">
              <Microscope className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-800 leading-tight">
                TEM Analyzer
              </h1>
              <p className="text-xs text-slate-500 leading-tight">
                Analisis Citra Asbestos Crocidolite
              </p>
            </div>
          </div>

          {/* Step indicator */}
          <div className="flex items-center gap-1.5 text-xs">
            {[
              { key: "upload", label: "Upload" },
              { key: "roi", label: "ROI" },
              { key: "processing", label: "Proses" },
              { key: "results", label: "Hasil" },
            ].map((s, i) => {
              const stepOrder = ["upload", "roi", "processing", "results"];
              const currentIdx = stepOrder.indexOf(step);
              const sIdx = i;
              const isActive = sIdx === currentIdx;
              const isComplete = sIdx < currentIdx;
              return (
                <div key={s.key} className="flex items-center gap-1.5">
                  {i > 0 && (
                    <div
                      className={`w-6 h-px ${isComplete ? "bg-blue-400" : "bg-slate-200"}`}
                    />
                  )}
                  <div
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full ${
                      isActive
                        ? "bg-blue-100 text-blue-700 font-medium"
                        : isComplete
                          ? "text-blue-600"
                          : "text-slate-400"
                    }`}
                  >
                    <span
                      className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${
                        isActive
                          ? "bg-blue-600 text-white"
                          : isComplete
                            ? "bg-blue-200 text-blue-700"
                            : "bg-slate-200 text-slate-400"
                      }`}
                    >
                      {sIdx + 1}
                    </span>
                    {s.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="py-8 px-4">
        {step === "upload" && (
          <UploadStep onImageLoaded={handleImageLoaded} error={error} />
        )}
        {step === "roi" && image && processedImage && (
          <RoiSelector
            image={{ ...image, data: processedImage.data, rows: processedImage.rows }}
            nmPerPx={nmPerPx}
            onConfirm={handleRoiConfirmed}
            onBack={() => setStep("upload")}
          />
        )}
        {step === "processing" && <ProcessingView stage={stage} />}
        {step === "results" && result && roiData && processedImage && (
          <ResultsView
            result={result}
            imageDisplayData={processedImage.data}
            imageRows={processedImage.rows}
            imageCols={processedImage.cols}
            roiRect={{
              x1: roiData.x1,
              y1: roiData.y1,
              x2: roiData.x2,
              y2: roiData.y2,
            }}
            fileName={fileName}
            onReset={handleReset}
          />
        )}
      </main>
    </div>
  );
}

export default App;
