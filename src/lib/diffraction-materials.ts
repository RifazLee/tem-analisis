/**
 * Reference d-spacings for diffraction calibration standards.
 * Values in Angstrom (Å).
 */
export interface DiffractionReference {
  hkl: string;
  dSpacing: number; // Å
}

export interface DiffractionMaterial {
  id: string;
  name: string;
  formula: string;
  description: string;
  references: DiffractionReference[];
}

export const DIFFRACTION_MATERIALS: DiffractionMaterial[] = [
  {
    id: "aluminium",
    name: "Aluminium",
    formula: "Al",
    description: "FCC, a = 4.0495 Å — standard diffraction calibration material",
    references: [
      { hkl: "111", dSpacing: 2.3380 },
      { hkl: "200", dSpacing: 2.0240 },
      { hkl: "220", dSpacing: 1.4310 },
      { hkl: "311", dSpacing: 1.2210 },
      { hkl: "222", dSpacing: 1.1690 },
      { hkl: "400", dSpacing: 1.0124 },
      { hkl: "331", dSpacing: 0.9289 },
      { hkl: "420", dSpacing: 0.9055 },
      { hkl: "422", dSpacing: 0.8266 },
    ],
  },
  {
    id: "gold",
    name: "Gold",
    formula: "Au",
    description: "FCC, a = 4.0782 Å",
    references: [
      { hkl: "111", dSpacing: 2.3546 },
      { hkl: "200", dSpacing: 2.0391 },
      { hkl: "220", dSpacing: 1.4418 },
      { hkl: "311", dSpacing: 1.2296 },
      { hkl: "222", dSpacing: 1.1773 },
      { hkl: "400", dSpacing: 1.0196 },
      { hkl: "331", dSpacing: 0.9356 },
      { hkl: "420", dSpacing: 0.9120 },
      { hkl: "422", dSpacing: 0.8325 },
    ],
  },
  {
    id: "silver",
    name: "Silver",
    formula: "Ag",
    description: "FCC, a = 4.0862 Å",
    references: [
      { hkl: "111", dSpacing: 2.3592 },
      { hkl: "200", dSpacing: 2.0431 },
      { hkl: "220", dSpacing: 1.4446 },
      { hkl: "311", dSpacing: 1.2320 },
      { hkl: "222", dSpacing: 1.1796 },
      { hkl: "400", dSpacing: 1.0216 },
      { hkl: "331", dSpacing: 0.9375 },
      { hkl: "420", dSpacing: 0.9138 },
      { hkl: "422", dSpacing: 0.8341 },
    ],
  },
  {
    id: "silicon",
    name: "Silicon",
    formula: "Si",
    description: "Diamond cubic, a = 5.4307 Å",
    references: [
      { hkl: "111", dSpacing: 3.1340 },
      { hkl: "220", dSpacing: 1.9194 },
      { hkl: "311", dSpacing: 1.6372 },
      { hkl: "400", dSpacing: 1.3577 },
      { hkl: "331", dSpacing: 1.2455 },
      { hkl: "422", dSpacing: 1.1085 },
      { hkl: "511", dSpacing: 1.0451 },
      { hkl: "440", dSpacing: 0.9597 },
    ],
  },
];

export function getDiffractionMaterialById(id: string): DiffractionMaterial | undefined {
  return DIFFRACTION_MATERIALS.find((m) => m.id === id);
}
