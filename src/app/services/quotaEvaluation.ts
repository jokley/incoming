import type { OfficialQuotaUsage } from './fisRules';
import type { AssignmentGridHotel, RoomBooking } from '../types';

export type QuotaGroupKey = string;

export interface QuotaDefinition {
  nationCode: string;
  discipline: string;
  gender: string;
  singleRoomsAllowed: number;
}

export interface QuotaAssignment {
  personId: string;
  bookingId: string;
  nationCode?: string | null;
  discipline?: string | null;
  gender?: string | null;
  function?: string | null;
  countsAsSingle: boolean;
}

export interface PersonQuotaEvaluation extends QuotaAssignment {
  groupKey: QuotaGroupKey;
  additionalCost: boolean;
}

export interface QuotaGroupEvaluation {
  key: QuotaGroupKey;
  allowedSingleRooms: number;
  usedSingleRooms: number;
  overflow: number;
  hasViolation: boolean;
  people: PersonQuotaEvaluation[];
}

export interface QuotaSummary {
  allowedSingleRooms: number;
  usedSingleRooms: number;
  overflow: number;
  groupsWithViolation: number;
}

/** Persisted `countsAsSingle` is the only operational quota classification. */
export const isEvaluatedAsSingle = (booking?: Pick<RoomBooking, 'countsAsSingle'> | null) =>
  Boolean(booking?.countsAsSingle);

export const quotaUsageKey = (nation?: string | null, discipline?: string | null, gender?: string | null) =>
  `${nation || ''}|${discipline || ''}|${normalizeGender(gender)}`;

export const isAdditionalCostQuota = (row?: Pick<OfficialQuotaUsage, 'singleRoomsUsed' | 'singleRoomsAllowed'> | null) =>
  Boolean(row && evaluateQuotaUsageRow(row).hasViolation);

/** Converts live room assignments into the calculation's room-type-independent input. */
export function quotaAssignmentsFromBookings(bookings: RoomBooking[]): QuotaAssignment[] {
  return bookings.flatMap(booking => booking.occupants.map(({ athlete }) => ({
    personId: athlete.id,
    bookingId: booking.id,
    nationCode: athlete.nationCode,
    discipline: athlete.discipline || athlete.disciplines?.[0],
    gender: athlete.gender,
    function: athlete.function,
    countsAsSingle: isEvaluatedAsSingle(booking),
  })));
}

export function quotaAssignmentsFromPlanning(hotels: AssignmentGridHotel[]): QuotaAssignment[] {
  return hotels.flatMap(hotel => hotel.slots.flatMap(slot => slot.bookings.flatMap(booking =>
    booking.occupants.map(person => ({ personId: person.athleteId, bookingId: booking.bookingId,
      nationCode: person.nationCode, discipline: person.discipline, gender: person.gender,
      function: person.function, countsAsSingle: Boolean(booking.countsAsSingle) })))));
}

/** Reconciles quota definitions with the current disposition for every consumer. */
export function evaluateCurrentQuotaUsage(rows: OfficialQuotaUsage[], assignments: QuotaAssignment[]): OfficialQuotaUsage[] {
  const evaluated = new Map(evaluateAllQuotaGroups(rows, assignments).map(group => [group.key, group]));
  return rows.map(row => {
    const group = evaluated.get(quotaUsageKey(row.nationCode, row.discipline, row.gender));
    return group ? { ...row, singleRoomsUsed: group.usedSingleRooms, requiredSingleRooms: group.usedSingleRooms,
      remainingSingleRooms: Math.max(0, group.usedSingleRooms - (row.implementedSingleRooms || 0)) } : row;
  });
}

export function calculateQuotaUsage(assignments: QuotaAssignment[]): number {
  return assignments.filter(assignment => assignment.countsAsSingle).length;
}

/**
 * Marks only the deterministic overflow tail as additional cost. Input order is
 * disposition order, so an existing assignment keeps its result when new ones
 * are appended. No approval status or physical room type participates.
 */
export function calculateAdditionalCosts(assignments: QuotaAssignment[], allowedSingleRooms: number): PersonQuotaEvaluation[] {
  let used = 0;
  const allowance = Math.max(0, allowedSingleRooms);
  return assignments.map(assignment => {
    const additionalCost = assignment.countsAsSingle && used >= allowance;
    if (assignment.countsAsSingle) used += 1;
    return { ...assignment, groupKey: quotaUsageKey(assignment.nationCode, assignment.discipline, assignment.gender), additionalCost };
  });
}

export function evaluateQuotaGroup(definition: QuotaDefinition, assignments: QuotaAssignment[]): QuotaGroupEvaluation {
  const key = quotaUsageKey(definition.nationCode, definition.discipline, definition.gender);
  const matching = assignments.filter(assignment => quotaUsageKey(assignment.nationCode, assignment.discipline, assignment.gender) === key);
  const people = calculateAdditionalCosts(matching, definition.singleRoomsAllowed);
  const usedSingleRooms = calculateQuotaUsage(matching);
  const overflow = Math.max(0, usedSingleRooms - Math.max(0, definition.singleRoomsAllowed));
  return { key, allowedSingleRooms: definition.singleRoomsAllowed, usedSingleRooms, overflow, hasViolation: overflow > 0, people };
}

export function evaluateAllQuotaGroups(definitions: QuotaDefinition[], assignments: QuotaAssignment[]): QuotaGroupEvaluation[] {
  return definitions.map(definition => evaluateQuotaGroup(definition, assignments));
}

/** Central interpretation for authoritative usage rows returned by the API. */
export function evaluateQuotaUsageRow(row: Pick<OfficialQuotaUsage, 'nationCode' | 'discipline' | 'gender' | 'singleRoomsUsed' | 'singleRoomsAllowed'>): QuotaGroupEvaluation {
  const overflow = Math.max(0, row.singleRoomsUsed - row.singleRoomsAllowed);
  return { key: quotaUsageKey(row.nationCode, row.discipline, row.gender), allowedSingleRooms: row.singleRoomsAllowed, usedSingleRooms: row.singleRoomsUsed, overflow, hasViolation: overflow > 0, people: [] };
}

export function getQuotaSummary(groups: QuotaGroupEvaluation[]): QuotaSummary {
  return groups.reduce((summary, group) => ({
    allowedSingleRooms: summary.allowedSingleRooms + group.allowedSingleRooms,
    usedSingleRooms: summary.usedSingleRooms + group.usedSingleRooms,
    overflow: summary.overflow + group.overflow,
    groupsWithViolation: summary.groupsWithViolation + Number(group.hasViolation),
  }), { allowedSingleRooms: 0, usedSingleRooms: 0, overflow: 0, groupsWithViolation: 0 });
}

const normalizeGender = (gender?: string | null) => {
  const value = (gender || '').trim().toUpperCase();
  if (value.startsWith('M')) return 'M';
  if (value.startsWith('F') || value.startsWith('W')) return 'F';
  return value;
};
