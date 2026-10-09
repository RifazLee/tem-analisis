/**
 * Processing view — shows animated progress as the analysis pipeline runs.
 */
import { CheckCircle2, Loader2, Circle } from "lucide-react";

interface ProcessingViewProps {
  stage: string;
}

const STAGES = [
  { key: "fft", label: "Menghitung FFT 2D", desc: "Transformasi Fourier domain frekuensi" },
  { key: "calibration", label: "Kalibrasi skala", desc: "Kalibrasi nm/piksel dari puncak kisi" },
  { key: "spatial", label: "Metrik domain ruang", desc: "Intensitas, kontras, ketajaman, entropi" },
  { key: "frequency", label: "Analisis domain frekuensi", desc: "Profil radial, energi pita frekuensi" },
  { key: "lattice", label: "Deteksi puncak kisi", desc: "Pengukuran jarak kisi dari FFT" },
  { key: "inverse", label: "Inverse FFT", desc: "Filter band-pass dan Bragg" },
];

export default function ProcessingView({ stage }: ProcessingViewProps) {
  const currentIdx = STAGES.findIndex((s) => s.key === stage);
  const isDone = stage === "done";

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-50 rounded-full mb-4">
            {isDone ? (
              <CheckCircle2 className="w-8 h-8 text-blue-600" />
            ) : (
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
            )}
          </div>
          <h2 className="text-xl font-bold text-slate-800">
            {isDone ? "Analisis Selesai" : "Memproses Analisis TEM"}
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            {isDone
              ? "Hasil siap ditampilkan"
              : "Sedang menjalankan pipeline analisis citra…"}
          </p>
        </div>

        <div className="space-y-3">
          {STAGES.map((s, i) => {
            const isComplete = isDone || i < currentIdx;
            const isActive = !isDone && i === currentIdx;
            return (
              <div
                key={s.key}
                className={`flex items-start gap-3 p-3 rounded-lg transition ${
                  isActive ? "bg-blue-50" : "bg-transparent"
                }`}
              >
                <div className="mt-0.5">
                  {isComplete ? (
                    <CheckCircle2 className="w-5 h-5 text-blue-600" />
                  ) : isActive ? (
                    <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                  ) : (
                    <Circle className="w-5 h-5 text-slate-300" />
                  )}
                </div>
                <div>
                  <p
                    className={`text-sm font-medium ${
                      isComplete || isActive ? "text-slate-800" : "text-slate-400"
                    }`}
                  >
                    {s.label}
                  </p>
                  <p
                    className={`text-xs ${
                      isComplete || isActive ? "text-slate-500" : "text-slate-300"
                    }`}
                  >
                    {s.desc}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {!isDone && (
          <div className="mt-6">
            <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
              <div
                className="bg-blue-600 h-full rounded-full transition-all duration-500"
                style={{
                  width: `${((currentIdx + 1) / STAGES.length) * 100}%`,
                }}
              />
            </div>
            <p className="text-center text-xs text-slate-400 mt-2">
              Langkah {currentIdx + 1} dari {STAGES.length}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
