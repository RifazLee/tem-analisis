/**
 * Known crystalline materials with their characteristic d-spacings.
 * Used as presets for the lattice reference selector in the upload step.
 * Only materials with two known reflectors are listed since the analysis
 * pipeline needs d1 and d2 to compute the inter-reflector angle and frequency
 * ratio for validation.
 */

export interface MaterialPreset {
  id: string;
  name: string;
  formula: string;
  description: string;
  d1: number;
  d1Plane: string;
  d2: number;
  d2Plane: string;
}

export const MATERIALS: MaterialPreset[] = [
  {
    id: "crocidolite",
    name: "Crocidolite (Asbestos)",
    formula: "Na₂Fe₃Fe₂Si₈O₂₂(OH)₂",
    description: "Amphibole asbestos (blue asbestos), common in TEM asbestos analysis.",
    d1: 0.903,
    d1Plane: "(020)",
    d2: 0.452,
    d2Plane: "(021)",
  },
  {
    id: "graphite",
    name: "Graphite",
    formula: "C",
    description: "Graphite interlayer spacing and in-plane reflection.",
    d1: 0.335,
    d1Plane: "(002)",
    d2: 0.213,
    d2Plane: "(100)",
  },
  {
    id: "gold",
    name: "Gold (Au)",
    formula: "Au",
    description: "FCC gold — common TEM calibration standard.",
    d1: 0.235,
    d1Plane: "(111)",
    d2: 0.204,
    d2Plane: "(200)",
  },
  {
    id: "silver",
    name: "Silver (Ag)",
    formula: "Ag",
    description: "FCC silver — common TEM calibration standard.",
    d1: 0.236,
    d1Plane: "(111)",
    d2: 0.204,
    d2Plane: "(200)",
  },
  {
    id: "silicon",
    name: "Silicon (Si)",
    formula: "Si",
    description: "Diamond cubic silicon wafer calibration standard.",
    d1: 0.314,
    d1Plane: "(111)",
    d2: 0.192,
    d2Plane: "(220)",
  },
  {
    id: "quartz",
    name: "Quartz (α-SiO₂)",
    formula: "SiO₂",
    description: "Alpha-quartz — common mineralogical reference.",
    d1: 0.334,
    d1Plane: "(101)",
    d2: 0.182,
    d2Plane: "(112)",
  },
  {
    id: "muscovite",
    name: "Muscovite (Mica)",
    formula: "KAl₂(AlSi₃O₁₀)(OH)₂",
    description: "Mica group — common sheet silicate for TEM calibration.",
    d1: 1.0,
    d1Plane: "(002)",
    d2: 0.336,
    d2Plane: "(006)",
  },
  {
    id: "calcite",
    name: "Calcite (CaCO₃)",
    formula: "CaCO₃",
    description: "Rhombohedral calcite carbonate.",
    d1: 0.304,
    d1Plane: "(104)",
    d2: 0.228,
    d2Plane: "(113)",
  },
  {
    id: "haematite",
    name: "Haematite (α-Fe₂O₃)",
    formula: "Fe₂O₃",
    description: "Iron oxide — rhombohedral hematite.",
    d1: 0.270,
    d1Plane: "(104)",
    d2: 0.184,
    d2Plane: "(024)",
  },
  {
    id: "anatase",
    name: "Anatase (TiO₂)",
    formula: "TiO₂",
    description: "Tetragonal anatase — common TiO₂ polymorph.",
    d1: 0.352,
    d1Plane: "(101)",
    d2: 0.189,
    d2Plane: "(200)",
  },
];

/** Find a material preset by its id. */
export function getMaterialById(id: string): MaterialPreset | undefined {
  return MATERIALS.find((m) => m.id === id);
}
