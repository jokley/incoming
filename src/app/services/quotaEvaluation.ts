import type { SingleRoomStatus, SingleRoomQuotaExemptReason } from '../types';
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
  singleRoomStatus?: SingleRoomStatus;
  singleRoomQuotaExemptReason?: SingleRoomQuotaExemptReason;
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
export const isEvaluatedAsSingle = (booking?: { countsAsSingle?: boolean } | null) =>
  Boolean(booking?.countsAsSingle);

/** An active surcharge requires both approval and current operational use. */
export const hasSingleRoomSurcharge = (person?: {
  single_room_status?: string | null;
  assignment?: { countsAsSingle?: boolean } | null;
} | null) => person?.single_room_status === 'APPROVED_EXTRA'
  && Boolean(person.assignment?.countsAsSingle);

/** Labels for operational use, durable approval, and active surcharge. */
export const singleRoomBadgeLabels = (countsAsSingle: boolean, singleRoomStatus?: string | null, exemptReason?: string | null) => [
  ...(exemptReason === 'WORLD_CHAMPION' ? ['👑 WM'] : []),
  ...(exemptReason === 'OTHER' ? ['EZ ✓'] : []),
  ...(singleRoomStatus === 'APPROVED_EXTRA' ? ['EZ genehmigt'] : []),
  ...(countsAsSingle ? ['Einzelzimmer'] : []),
  ...(countsAsSingle && singleRoomStatus === 'APPROVED_EXTRA' ? ['Mehrpreis'] : []),
];

export const singleRoomSpecialStatusLabel = (singleRoomStatus?: string | null, exemptReason?: string | null) =>
  exemptReason === 'WORLD_CHAMPION' ? 'Weltmeister'
    : exemptReason === 'OTHER' ? 'EZ-Ausnahme'
      : singleRoomStatus === 'APPROVED_EXTRA' ? 'Mehrpreis genehmigt' : '—';

export const quotaUsageKey = (nation?: string | null, discipline?: string | null, gender?: string | null) =>
  `${nation || ''}|${discipline || ''}|${normalizeGender(gender)}`;

export const quotaRequiresAction = (row: Pick<OfficialQuotaUsage, 'quotaStatus' | 'openApprovals'>) =>
  row.quotaStatus === 'DECISION_REQUIRED' || row.openApprovals > 0;

export const actionableQuotaCaseCount = (rows: Array<Pick<OfficialQuotaUsage, 'quotaStatus' | 'openApprovals'>>) =>
  rows.filter(quotaRequiresAction).length;

/** Numeric quota KPIs are meaningful only for one nation/discipline/gender context. */
export function uniqueQuotaContext<T extends Pick<OfficialQuotaUsage, 'nationCode' | 'discipline' | 'gender'>>(rows: T[]): T | null {
  if (rows.length !== 1) return null;
  return rows[0];
}

/** Converts live room assignments into the calculation's room-type-independent input. */
export function quotaAssignmentsFromBookings(bookings: RoomBooking[]): QuotaAssignment[] {
  return bookings.flatMap(booking => booking.occupants.flatMap(({ athlete }) => {
    const quotaDisciplines = athlete.competitions?.map(item => item.quotaDiscipline) || [];
    const disciplines = [...new Set(quotaDisciplines.length
      ? quotaDisciplines : [athlete.discipline || athlete.disciplines?.[0]])];
    return disciplines.filter(Boolean).map(discipline => ({ personId: athlete.id, bookingId: booking.id,
      nationCode: athlete.nationCode, discipline, gender: athlete.gender, function: athlete.function,
      countsAsSingle: isEvaluatedAsSingle(booking), singleRoomStatus: athlete.single_room_status,
      singleRoomQuotaExemptReason: athlete.singleRoomQuotaExemptReason }));
  }));
}

export function quotaAssignmentsFromPlanning(hotels: AssignmentGridHotel[]): QuotaAssignment[] {
  return hotels.flatMap(hotel => hotel.slots.flatMap(slot => slot.bookings.flatMap(booking =>
    booking.occupants.flatMap(person => [...new Set(person.quotaDisciplines?.length
      ? person.quotaDisciplines : [person.discipline])].filter(Boolean).map(discipline => ({
        personId: person.athleteId, bookingId: booking.bookingId,
        nationCode: person.nationCode, discipline, gender: person.gender,
        function: person.function, countsAsSingle: Boolean(booking.countsAsSingle),
        singleRoomStatus: person.single_room_status,
        singleRoomQuotaExemptReason: person.singleRoomQuotaExemptReason,
      }))))));
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
  return assignments.filter(assignment => assignment.countsAsSingle
    && !assignment.singleRoomQuotaExemptReason).length;
}

/**
 * Marks currently consumed approved exceptions as active additional cost.
 * Physical room type deliberately does not determine surcharge status.
 */
export function calculateAdditionalCosts(assignments: QuotaAssignment[], _allowedSingleRooms: number): PersonQuotaEvaluation[] {
  return assignments.map(assignment => ({
    ...assignment,
    groupKey: quotaUsageKey(assignment.nationCode, assignment.discipline, assignment.gender),
    additionalCost: assignment.countsAsSingle
      && assignment.singleRoomStatus === 'APPROVED_EXTRA',
  }));
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
