import { Microscope, Aperture, ChevronRight } from "lucide-react";

interface HomePageProps {
  onSelectModule: (module: "analyzer" | "diffraction") => void;
}

export default function HomePage({ onSelectModule }: HomePageProps) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 py-12 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4">
            <Microscope className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-slate-800 tracking-tight">
            TEM Analysis Studio
          </h1>
          <p className="text-lg text-slate-500 mt-2">
            Transmission Electron Microscopy Analysis Platform
          </p>
          <p className="text-sm text-slate-400 mt-1 max-w-2xl mx-auto">
            Platform untuk analisis citra TEM, pengukuran kisi kristal,
            dan kalibrasi pola difraksi.
          </p>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-12">
        <div className="grid md:grid-cols-2 gap-6">
          {/* TEM Analyzer */}
          <div className="group bg-white rounded-2xl border border-slate-200 p-8 hover:shadow-lg hover:border-blue-300 transition-all duration-300 cursor-pointer flex flex-col">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center">
                <Microscope className="w-7 h-7 text-blue-600" />
              </div>
              <h2 className="text-xl font-bold text-slate-800">TEM Analyzer</h2>
            </div>
            <p className="text-sm text-slate-500 mb-5 leading-relaxed">
              Analyze high-resolution TEM images using FFT, measure lattice
              spacing, inspect spatial frequencies, perform calibration, and
              generate analysis reports.
            </p>
            <ul className="text-sm text-slate-600 space-y-2 mb-6 flex-1">
              {[
                "Image and ROI analysis",
                "2D FFT analysis",
                "Lattice spacing measurement",
                "Reference-based calibration",
                "Inverse FFT and Bragg filtering",
                "Analysis report generation",
              ].map((feat) => (
                <li key={feat} className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-blue-400 rounded-full flex-shrink-0" />
                  {feat}
                </li>
              ))}
            </ul>
            <button
              onClick={() => onSelectModule("analyzer")}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition group-hover:gap-3"
            >
              Open TEM Analyzer
              <ChevronRight className="w-5 h-5 transition-transform" />
            </button>
          </div>

          {/* TEM Diffraction Calibration */}
          <div className="group bg-white rounded-2xl border border-slate-200 p-8 hover:shadow-lg hover:border-emerald-300 transition-all duration-300 cursor-pointer flex flex-col">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center">
                <Aperture className="w-7 h-7 text-emerald-600" />
              </div>
              <h2 className="text-xl font-bold text-slate-800">
                TEM Diffraction Calibration
              </h2>
            </div>
            <p className="text-sm text-slate-500 mb-5 leading-relaxed">
              Calibrate TEM diffraction patterns using known crystallographic
              reference materials, electron accelerating voltage, and camera
              length.
            </p>
            <ul className="text-sm text-slate-600 space-y-2 mb-6 flex-1">
              {[
                "Diffraction image upload",
                "Electron wavelength calculation",
                "Camera constant calculation",
                "Diffraction ring detection",
                "Miller index reference matching",
                "Calibration scale in nm/pixel",
              ].map((feat) => (
                <li key={feat} className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full flex-shrink-0" />
                  {feat}
                </li>
              ))}
            </ul>
            <button
              onClick={() => onSelectModule("diffraction")}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition group-hover:gap-3"
            >
              Open Diffraction Calibration
              <ChevronRight className="w-5 h-5 transition-transform" />
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
