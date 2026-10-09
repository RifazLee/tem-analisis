/**
 * Upload step — user selects a TIFF file and enters the pixel scale (nm/pixel).
 * Also offers an optional info-bar row removal setting.
 */
import { useCallback, useState, useRef } from "react";
import { loadTiff, type LoadedImage } from "@/lib/tiff";
import { MATERIALS, type MaterialPreset } from "@/lib/materials";
import { Upload, FileImage, Settings2, Microscope } from "lucide-react";

interface UploadStepProps {
  onImageLoaded: (
    image: LoadedImage,
    fileName: string,
    nmPerPx: number,
    barRow: number,
    latticeReferences: { d1: number | null; d2: number | null },
  ) => void;
  error: string | null;
}

type LatticeMode = "material" | "manual" | "unknown";

export default function UploadStep({ onImageLoaded, error }: UploadStepProps) {
  const [file, setFile] = useState<File | null>(null);
  const [nmPerPx, setNmPerPx] = useState<string>("0.035");
  const [barRow, setBarRow] = useState<string>("0");
  const [latticeMode, setLatticeMode] = useState<LatticeMode>("material");
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>("crocidolite");
  const [d1, setD1] = useState("0.903");
  const [d2, setD2] = useState("0.452");
  const [d1Plane, setD1Plane] = useState("(020)");
  const [d2Plane, setD2Plane] = useState("(021)");
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (f: File) => {
      setFile(f);
      setLocalError(null);
    },
    [],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files[0];
      if (f && (f.name.toLowerCase().endsWith(".tif") || f.name.toLowerCase().endsWith(".tiff"))) {
        handleFile(f);
      } else {
        setLocalError("File harus format .tif atau .tiff");
      }
    },
    [handleFile],
  );

  const handleMaterialSelect = useCallback((id: string) => {
    setSelectedMaterialId(id);
    const mat = MATERIALS.find((m) => m.id === id);
    if (mat) {
      setD1(mat.d1.toString());
      setD2(mat.d2.toString());
      setD1Plane(mat.d1Plane);
      setD2Plane(mat.d2Plane);
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!file) {
      setLocalError("Pilih file gambar TIFF terlebih dahulu");
      return;
    }
    const nm = parseFloat(nmPerPx);
    if (isNaN(nm) || nm <= 0) {
      setLocalError("Nilai nm/piksel harus berupa angka positif");
      return;
    }
    const br = parseInt(barRow) || 0;
    let latticeReferences: { d1: number | null; d2: number | null } = { d1: null, d2: null };
    if (latticeMode !== "unknown") {
      const parsedD1 = parseFloat(d1);
      const parsedD2 = parseFloat(d2);
      if (!Number.isFinite(parsedD1) || parsedD1 <= 0 || !Number.isFinite(parsedD2) || parsedD2 <= 0) {
        setLocalError("Jarak kisi harus berupa angka positif");
        return;
      }
      latticeReferences = { d1: parsedD1, d2: parsedD2 };
    }

    setLoading(true);
    setLocalError(null);
    try {
      const img = await loadTiff(file);
      onImageLoaded(img, file.name, nm, br, latticeReferences);
    } catch (err) {
      setLocalError(
        `Gagal memuat file TIFF: ${err instanceof Error ? err.message : "format tidak dikenali"}`,
      );
    } finally {
      setLoading(false);
    }
  }, [file, nmPerPx, barRow, latticeMode, d1, d2, onImageLoaded]);

  const selectedMaterial: MaterialPreset | undefined = MATERIALS.find((m) => m.id === selectedMaterialId);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
        {/* Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-50 rounded-2xl mb-4">
            <Microscope className="w-8 h-8 text-blue-600" />
          </div>
          <h2 className="text-2xl font-bold text-slate-800">
            Analisis Citra TEM Asbestos (Crocidolite)
          </h2>
          <p className="text-sm text-slate-500 mt-2 max-w-xl mx-auto">
            Unggah gambar TIFF dari mikroskop TEM, masukkan skala piksel (nm/piksel),
            lalu tandai area yang akan dianalisis. Sistem akan menghitung statistik
            domain ruang, FFT, kalibrasi kisi, dan inverse FFT.
          </p>
        </div>

        {/* File upload */}
        <div className="space-y-5">
          <div>
            <label className="text-sm font-medium text-slate-700 mb-2 block">
              1. Unggah File Gambar TIFF
            </label>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition ${
                dragOver
                  ? "border-blue-400 bg-blue-50"
                  : file
                    ? "border-emerald-300 bg-emerald-50"
                    : "border-slate-300 hover:border-slate-400 bg-slate-50"
              }`}
            >
              {file ? (
                <div className="flex items-center justify-center gap-3">
                  <FileImage className="w-8 h-8 text-emerald-600" />
                  <div className="text-left">
                    <p className="text-sm font-semibold text-slate-800">{file.name}</p>
                    <p className="text-xs text-slate-500">
                      {(file.size / 1024).toFixed(0)} KB — Klik untuk ganti
                    </p>
                  </div>
                </div>
              ) : (
                <div>
                  <Upload className="w-10 h-10 text-slate-400 mx-auto mb-3" />
                  <p className="text-sm font-medium text-slate-600">
                    Seret file TIFF ke sini atau klik untuk memilih
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Format .tif atau .tiff
                  </p>
                </div>
              )}
              <input
                ref={inputRef}
                type="file"
                accept=".tif,.tiff,image/tiff"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </div>
          </div>

          {/* Scale input */}
          <div className="grid md:grid-cols-2 gap-5">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-2 block">
                2. Skala Piksel (nm/piksel)
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  value={nmPerPx}
                  onChange={(e) => setNmPerPx(e.target.value)}
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
                  placeholder="0.035"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                  nm/px
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1.5">
                Skala nominal dari scale bar atau header citra. Akan dikalibrasi
                ulang dari puncak kisi.
              </p>
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700 mb-2 block flex items-center gap-1.5">
                <Settings2 className="w-4 h-4 text-slate-400" />
                Info Bar (opsional)
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  value={barRow}
                  onChange={(e) => setBarRow(e.target.value)}
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
                  placeholder="0"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                  baris
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1.5">
                Nomor baris tempat info bar dimulai. Isi 0 jika tidak ada info bar.
              </p>
            </div>
          </div>

          {/* Lattice reference selector */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <p className="text-sm font-medium text-slate-700">3. Referensi jarak kisi</p>
                <p className="text-xs text-slate-500 mt-1">
                  Dipakai untuk mencari puncak FFT dan mengukur d-spacing.
                </p>
              </div>
            </div>

            {/* Mode tabs */}
            <div className="flex gap-2 mb-4">
              {([
                { key: "material", label: "Pilih Material" },
                { key: "manual", label: "Input Manual" },
                { key: "unknown", label: "Belum Diketahui" },
              ] as { key: LatticeMode; label: string }[]).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setLatticeMode(tab.key)}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition ${
                    latticeMode === tab.key
                      ? "bg-blue-600 text-white shadow-sm"
                      : "bg-white text-slate-600 border border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Material selection mode */}
            {latticeMode === "material" && (
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1.5 block">
                  Pilih material dari daftar:
                </label>
                <select
                  value={selectedMaterialId}
                  onChange={(e) => handleMaterialSelect(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white mb-3"
                >
                  {MATERIALS.map((mat) => (
                    <option key={mat.id} value={mat.id}>
                      {mat.name} — {mat.formula}
                    </option>
                  ))}
                </select>
                {selectedMaterial && (
                  <div className="bg-white rounded-lg border border-slate-200 p-3">
                    <p className="text-xs text-slate-500 mb-2">{selectedMaterial.description}</p>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="bg-slate-50 rounded-lg px-3 py-2">
                        <p className="text-xs text-slate-500">{selectedMaterial.d1Plane}</p>
                        <p className="font-mono font-semibold text-slate-800">
                          d₁ = {selectedMaterial.d1.toFixed(3)} nm
                        </p>
                      </div>
                      <div className="bg-slate-50 rounded-lg px-3 py-2">
                        <p className="text-xs text-slate-500">{selectedMaterial.d2Plane}</p>
                        <p className="font-mono font-semibold text-slate-800">
                          d₂ = {selectedMaterial.d2.toFixed(3)} nm
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Manual input mode */}
            {latticeMode === "manual" && (
              <div>
                <p className="text-xs text-slate-500 mb-3">
                  Masukkan jarak kisi dan label bidang kristalografi secara manual.
                </p>
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-600">
                      Bidang 1 — label (mis. (020))
                    </label>
                    <input
                      type="text"
                      value={d1Plane}
                      onChange={(e) => setD1Plane(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="(020)"
                    />
                    <label className="text-xs font-medium text-slate-600">
                      d₁ (nm)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      value={d1}
                      onChange={(e) => setD1(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="0.903"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-600">
                      Bidang 2 — label (mis. (021))
                    </label>
                    <input
                      type="text"
                      value={d2Plane}
                      onChange={(e) => setD2Plane(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="(021)"
                    />
                    <label className="text-xs font-medium text-slate-600">
                      d₂ (nm)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      value={d2}
                      onChange={(e) => setD2(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="0.452"
                    />
                  </div>
                </div>
                <div className="mt-3 bg-slate-50 rounded-lg px-3 py-2 border border-slate-200">
                  <p className="text-xs text-slate-600">
                    Referensi saat ini: <span className="font-mono font-semibold">{d1Plane}</span> d={d1} nm,
                    {" "}
                    <span className="font-mono font-semibold">{d2Plane}</span> d={d2} nm
                  </p>
                </div>
              </div>
            )}

            {/* Unknown mode */}
            {latticeMode === "unknown" && (
              <div className="bg-amber-50 rounded-lg p-4 border border-amber-200">
                <p className="text-sm text-amber-800">
                  Analisis FFT tetap berjalan, tetapi kalibrasi dan deteksi puncak kisi dilewati.
                </p>
                <p className="text-xs text-amber-600 mt-1">
                  Sistem akan tetap menunjukkan pola diffraction dan profil frekuensi,
                  namun tidak akan mencari puncak kisi atau mengkalibrasi skala.
                </p>
              </div>
            )}
          </div>

          {/* Error */}
          {(localError || error) && (
            <div className="bg-rose-50 border border-rose-200 rounded-lg p-4">
              <p className="text-sm text-rose-700">{localError || error}</p>
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={!file || loading}
            className="w-full py-3.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Memuat gambar…" : "Lanjut — Pilih ROI"}
          </button>
        </div>
      </div>

      {/* Info card */}
      <div className="mt-6 bg-slate-50 rounded-2xl border border-slate-200 p-6">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">
          Alur Analisis
        </h3>
        <ol className="space-y-2 text-sm text-slate-600">
          <li className="flex gap-2">
            <span className="flex-shrink-0 w-5 h-5 bg-slate-200 rounded-full flex items-center justify-center text-xs font-bold text-slate-600">
              1
            </span>
            <span>Muat citra TIFF → buang info bar → pilih ROI (dipotong persegi)</span>
          </li>
          <li className="flex gap-2">
            <span className="flex-shrink-0 w-5 h-5 bg-slate-200 rounded-full flex items-center justify-center text-xs font-bold text-slate-600">
              2
            </span>
            <span>Domain ruang: statistik intensitas, kontras, ketajaman, entropi, histogram</span>
          </li>
          <li className="flex gap-2">
            <span className="flex-shrink-0 w-5 h-5 bg-slate-200 rounded-full flex items-center justify-center text-xs font-bold text-slate-600">
              3
            </span>
            <span>Domain frekuensi: FFT, kalibrasi skala dari kisi, profil radial, energi pita</span>
          </li>
          <li className="flex gap-2">
            <span className="flex-shrink-0 w-5 h-5 bg-slate-200 rounded-full flex items-center justify-center text-xs font-bold text-slate-600">
              4
            </span>
            <span>Pengukuran jarak kisi dari puncak FFT sesuai material yang dipilih</span>
          </li>
          <li className="flex gap-2">
            <span className="flex-shrink-0 w-5 h-5 bg-slate-200 rounded-full flex items-center justify-center text-xs font-bold text-slate-600">
              5
            </span>
            <span>Inverse FFT: filter band-pass dan Bragg → tampilkan seluruh hasil</span>
          </li>
        </ol>
      </div>
    </div>
  );
}
