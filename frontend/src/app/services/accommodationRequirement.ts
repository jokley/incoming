import type { AccommodationRequirementFields } from '../types.ts';
export const requiresAccommodation = (person?: AccommodationRequirementFields | null) => person?.accommodationRequirement !== 'NO_ROOM';
export const requirementLabel = (value?:string|null) => value==='NO_ROOM' ? 'Kein Zimmer benötigt' : 'Unterkunft benötigt';
export const requirementSourceLabel = (value?:string) => value==='MANUAL' ? 'Manuell' : value==='IMPORT' ? 'Import' : 'Standardvorgabe';
