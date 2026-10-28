// Compatibiliteitsschil.
//
// De integriteitscontrole op de compacte wedstrijdopslag staat in
// shared/matchStore.js, vlak bij de build die hem gebruikt. Er heeft hier een
// tweede kopie van dezelfde logica gestaan; twee kopieën van dezelfde regel
// lopen vroeg of laat uiteen, en dan verschillen de build en de rapportage van
// mening over wat een geldig record is.
//
// Deze module blijft bestaan zodat bestaande imports blijven werken, maar wijst
// door naar de enige echte implementatie.
export { sanitizeMatchStore } from "./matchStore.js";
