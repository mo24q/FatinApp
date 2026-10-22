import content from '../../content/game-content.json' with { type: 'json' };
// Common object names, original selection and artwork. No commercial card assets.
export type CrimeCard = { id: string; name: string; art: string; kind: 'weapon' | 'evidence' };
export const crimeCards = content.crime as CrimeCard[];
export const crimeCardById = Object.fromEntries(crimeCards.map(c=>[c.id,c])) as Record<string,CrimeCard>;
// The narrator chooses associations, never an automatically generated factual claim.
export const clueBoards = content.crimeClues;
export type ClueId = typeof clueBoards[number]['id'];
