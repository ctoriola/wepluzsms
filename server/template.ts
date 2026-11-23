// Nigerian starter template: class levels and a common subject list per section.
// Schools edit the result to match their own curriculum.
export type Section = "nursery" | "primary" | "junior_secondary" | "senior_secondary";
export const SECTIONS: Section[] = ["nursery", "primary", "junior_secondary", "senior_secondary"];
export const SECTION_BASE: Record<Section, number> = { nursery: 0, primary: 100, junior_secondary: 200, senior_secondary: 300 };

export const TEMPLATE_LEVELS: Record<Section, string[]> = {
  nursery: ["Creche", "Nursery 1", "Nursery 2"],
  primary: ["Primary 1", "Primary 2", "Primary 3", "Primary 4", "Primary 5", "Primary 6"],
  junior_secondary: ["JSS 1", "JSS 2", "JSS 3"],
  senior_secondary: ["SS 1", "SS 2", "SS 3"],
};

// [name, short code, category, compulsory]
type T = [string, string, string, boolean];
export const TEMPLATE_SUBJECTS: Record<Section, T[]> = {
  nursery: [
    ["Literacy", "LIT", "early_years", true],
    ["Numeracy", "NUM", "early_years", true],
    ["Phonics", "PHON", "early_years", true],
    ["Basic Science", "BSC", "science", true],
    ["Social Habits", "SOCH", "early_years", true],
    ["Health Habits", "HLTH", "early_years", true],
    ["Creative Arts", "CART", "early_years", true],
    ["Rhymes and Songs", "RHYM", "early_years", true],
    ["Handwriting", "HWR", "early_years", true],
  ],
  primary: [
    ["English Studies", "ENG", "core", true],
    ["Mathematics", "MTH", "core", true],
    ["Basic Science and Technology", "BST", "science", true],
    ["Social Studies", "SOS", "core", true],
    ["Civic Education", "CVE", "core", true],
    ["History", "HIS", "arts", true],
    ["Christian Religious Studies", "CRS", "religious", false],
    ["Islamic Religious Studies", "IRS", "religious", false],
    ["Cultural and Creative Arts", "CCA", "arts", true],
    ["Nigerian Language", "NGL", "language", true],
    ["French", "FRE", "language", true],
    ["Physical and Health Education", "PHE", "core", true],
    ["Computer Studies", "CMP", "core", true],
    ["Pre-Vocational Studies", "PVS", "vocational", true],
    ["Verbal Reasoning", "VR", "core", true],
    ["Quantitative Reasoning", "QR", "core", true],
  ],
  junior_secondary: [
    ["English Studies", "ENG", "core", true],
    ["Mathematics", "MTH", "core", true],
    ["Basic Science", "BSC", "science", true],
    ["Basic Technology", "BTE", "science", true],
    ["Social Studies", "SOS", "core", true],
    ["Civic Education", "CVE", "core", true],
    ["History", "HIS", "arts", true],
    ["Christian Religious Studies", "CRS", "religious", false],
    ["Islamic Religious Studies", "IRS", "religious", false],
    ["Cultural and Creative Arts", "CCA", "arts", true],
    ["Nigerian Language", "NGL", "language", true],
    ["French", "FRE", "language", true],
    ["Physical and Health Education", "PHE", "core", true],
    ["Computer Studies", "CMP", "core", true],
    ["Agricultural Science", "AGR", "vocational", true],
    ["Home Economics", "HEC", "vocational", true],
    ["Business Studies", "BUS", "commercial", true],
  ],
  senior_secondary: [
    ["English Language", "ENGL", "core", true],
    ["General Mathematics", "GMTH", "core", true],
    ["Civic Education", "CVE", "core", true],
    ["Data Processing", "DP", "trade", true],
    ["Biology", "BIO", "science", false],
    ["Chemistry", "CHE", "science", false],
    ["Physics", "PHY", "science", false],
    ["Further Mathematics", "FMTH", "science", false],
    ["Agricultural Science", "AGR", "vocational", false],
    ["Geography", "GEO", "arts", false],
    ["Technical Drawing", "TD", "science", false],
    ["Literature in English", "LIT2", "arts", false],
    ["Government", "GOV", "arts", false],
    ["History", "HIS", "arts", false],
    ["Christian Religious Studies", "CRS", "religious", false],
    ["Islamic Religious Studies", "IRS", "religious", false],
    ["Nigerian Language", "NGL", "language", false],
    ["French", "FRE", "language", false],
    ["Economics", "ECO", "commercial", false],
    ["Financial Accounting", "ACC", "commercial", false],
    ["Commerce", "COM", "commercial", false],
    ["Marketing", "MKT", "trade", false],
  ],
};
