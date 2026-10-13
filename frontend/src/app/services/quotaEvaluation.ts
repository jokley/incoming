import type { SingleRoomStatus, SingleRoomQuotaExemptReason } from '../types';
import type { OfficialQuotaUsage } from './fisRules';
import type { AssignmentGridHotel, RoomBooking } from '../types';

export type QuotaGroupKey = string;

export interface QuotaDefinition {
  nationCode: string;
  discipline: string;
  gender: string;
  singleRoomsAllowed: number;
  singleRoomAllocations?: Array<{ personId?: string | number | null; status: string; context: string[] | null }>;
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
  approvedQuotaDisciplines?: string[];
  approvedQuotaContexts?: Array<{ nationCode: string; discipline: string; gender: string }>;
  singleRoomQuotaExemptReason?: SingleRoomQuotaExemptReason;
}

export interface PersonQuotaEvaluation extends QuotaAssignment {
  groupKey: QuotaGroupKey;
  additionalCost: boolean;
  allocationStatus?: 'COVERED' | 'PENDING' | 'EXEMPT' | 'APPROVED_EXTRA';
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

/** Membership in an authoritative athlete allowance context, for every role. */
export function matchesQuotaAllowanceContext(person: {
  nationCode?: string | null; quotaDisciplines?: string[]; gender?: string | null; function?: string | null;
}, definition: Pick<QuotaDefinition, 'nationCode' | 'discipline' | 'gender'>): boolean {
  return ['M', 'W'].includes(normalizeGender(definition.gender))
    && (person.nationCode || '') === definition.nationCode
    && Boolean(person.quotaDisciplines?.includes(definition.discipline))
    && ((person.function || '').trim().toLowerCase() !== 'athlete'
      || normalizeGender(person.gender) === normalizeGender(definition.gender));
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
    const disciplines = [...new Set(quotaDisciplines)];
    return disciplines.filter(Boolean).map(discipline => ({ personId: athlete.id, bookingId: booking.id,
      nationCode: athlete.nationCode, discipline, gender: athlete.gender, function: athlete.function,
      countsAsSingle: isEvaluatedAsSingle(booking), singleRoomStatus: athlete.single_room_status, approvedQuotaDisciplines: athlete.approvedQuotaDisciplines,
      approvedQuotaContexts: athlete.approvedQuotaContexts,
      singleRoomQuotaExemptReason: athlete.singleRoomQuotaExemptReason }));
  }));
}

export function quotaAssignmentsFromPlanning(hotels: AssignmentGridHotel[]): QuotaAssignment[] {
  return hotels.flatMap(hotel => hotel.slots.flatMap(slot => slot.bookings.flatMap(booking =>
    booking.occupants.flatMap(person => [...new Set(person.quotaDisciplines || [])].filter(Boolean).map(discipline => ({
        personId: person.athleteId, bookingId: booking.bookingId,
        nationCode: person.nationCode, discipline, gender: person.gender,
        function: person.function, countsAsSingle: Boolean(booking.countsAsSingle),
        singleRoomStatus: person.single_room_status, approvedQuotaDisciplines: person.approvedQuotaDisciplines,
        approvedQuotaContexts: person.approvedQuotaContexts,
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
  return new Set(assignments.filter(assignment => assignment.countsAsSingle
    && !assignment.singleRoomQuotaExemptReason).map(assignment => assignment.personId)).size;
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
      && assignment.singleRoomStatus === 'APPROVED_EXTRA'
      && (assignment.approvedQuotaContexts !== undefined
        ? assignment.approvedQuotaContexts.some(context => quotaUsageKey(context.nationCode, context.discipline, context.gender)
          === quotaUsageKey(assignment.nationCode, assignment.discipline, assignment.gender))
        : Boolean(assignment.discipline && assignment.approvedQuotaDisciplines?.includes(assignment.discipline))),
  }));
}

/** Distinct physical singles include exempt people and require no quota membership. */
export function physicalSingleRoomPersonIdsFromBookings(bookings: RoomBooking[]): Set<string> {
  return new Set(bookings.filter(isEvaluatedAsSingle).flatMap(booking =>
    booking.occupants.map(({ athlete }) => athlete.id)));
}

export function physicalSingleRoomUsageFromBookings(bookings: RoomBooking[]): number {
  return physicalSingleRoomPersonIdsFromBookings(bookings).size;
}

const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Same sorted augmenting-path maximum matching as backend.allocate_single_rooms. */
export function allocateSingleRoomPeople(definitions: QuotaDefinition[], assignments: QuotaAssignment[]): PersonQuotaEvaluation[] {
  const contexts = [...definitions].sort((a, b) => compareText(a.nationCode, b.nationCode)
    || compareText(a.discipline, b.discipline) || compareText(normalizeGender(a.gender), normalizeGender(b.gender)));
  contexts.forEach(context => {
    if (!['M', 'W'].includes(normalizeGender(context.gender))) throw new Error('Quota allowance context requires athlete gender M/W');
  });
  const members = new Map<string, { entries: QuotaAssignment[]; eligible: number[]; approved: number[] }>();
  assignments.filter(p => p.countsAsSingle).forEach(person => {
    let item = members.get(person.personId);
    if (!item) { item = { entries: [], eligible: [], approved: [] }; members.set(person.personId, item); }
    item.entries.push(person);
    contexts.forEach((context, index) => {
      if (!matchesQuotaAllowanceContext({ ...person, quotaDisciplines: person.discipline ? [person.discipline] : [] }, context)) return;
      if (!item.eligible.includes(index)) item.eligible.push(index);
      const approved = person.singleRoomStatus === 'APPROVED_EXTRA' && (person.approvedQuotaContexts !== undefined
        ? person.approvedQuotaContexts.some(c => quotaUsageKey(c.nationCode, c.discipline, c.gender)
          === quotaUsageKey(context.nationCode, context.discipline, context.gender))
        : person.approvedQuotaDisciplines?.includes(context.discipline));
      if (approved && !item.approved.includes(index)) item.approved.push(index);
    });
    item.eligible.sort((a, b) => a - b); item.approved.sort((a, b) => a - b);
  });
  const ordered = [...members.keys()].sort((a, b) => members.get(a)!.eligible.length - members.get(b)!.eligible.length || compareText(a, b));
  const slots = contexts.map((context, index) => Array.from({ length: Math.max(0, Math.trunc(context.singleRoomsAllowed)) }, (_, slot) => `${index}:${slot}`));
  const owners = new Map<string, string>(), assigned = new Map<string, number>();
  function augment(id: string, seen: Set<string>): boolean {
    for (const context of members.get(id)!.eligible) {
      for (const slot of slots[context]) {
        if (seen.has(slot)) continue;
        seen.add(slot);
        const owner = owners.get(slot);
        if (owner === undefined || augment(owner, seen)) { owners.set(slot, id); assigned.set(id, context); return true; }
      }
    }
    return false;
  }
  ordered.forEach(id => {
    const item = members.get(id)!;
    if (!item.entries.some(p => p.singleRoomQuotaExemptReason) && !item.approved.length) augment(id, new Set());
  });
  return ordered.flatMap(id => {
    const item = members.get(id)!;
    const exempt = item.entries.some(p => p.singleRoomQuotaExemptReason);
    const index = exempt ? item.eligible[0] : item.approved.length ? item.approved[0] : assigned.get(id) ?? item.eligible[0];
    if (index === undefined) return [];
    const context = contexts[index];
    const entry = item.entries.find(p => matchesQuotaAllowanceContext({ ...p,
      quotaDisciplines: p.discipline ? [p.discipline] : [] }, context))!;
    const allocationStatus = exempt ? 'EXEMPT' : item.approved.length ? 'APPROVED_EXTRA' : assigned.has(id) ? 'COVERED' : 'PENDING';
    return [{ ...calculateAdditionalCosts([{ ...entry, discipline: context.discipline, gender: normalizeGender(context.gender) }], 0)[0], allocationStatus }];
  });
}

export function evaluateQuotaGroup(definition: QuotaDefinition, assignments: QuotaAssignment[]): QuotaGroupEvaluation {
  return evaluateAllQuotaGroups([definition], assignments)[0];
}

export function evaluateAllQuotaGroups(definitions: QuotaDefinition[], assignments: QuotaAssignment[]): QuotaGroupEvaluation[] {
  definitions.forEach(definition => {
    if (!['M', 'W'].includes(normalizeGender(definition.gender))) {
      throw new Error('Quota allowance context requires athlete gender M/W');
    }
  });
  // API allocation is authoritative even when the displayed definitions are a
  // filtered subset. Re-matching that subset could charge a person a second time.
  let allocated: PersonQuotaEvaluation[];
  if (definitions.length && definitions.every(d => d.singleRoomAllocations !== undefined)) {
    const seen = new Set<string>();
    allocated = definitions.flatMap(definition => (definition.singleRoomAllocations || []).flatMap(record => {
      const id = String(record.personId);
      if (seen.has(id)) return [];
      const entry = assignments.find(p => p.personId === id && p.countsAsSingle
        && matchesQuotaAllowanceContext({ ...p, quotaDisciplines: p.discipline ? [p.discipline] : [] }, definition));
      if (!entry) return [];
      seen.add(id);
      return [{ ...calculateAdditionalCosts([{ ...entry, gender: normalizeGender(definition.gender) }], 0)[0],
        allocationStatus: record.status as PersonQuotaEvaluation['allocationStatus'] }];
    }));
  } else allocated = allocateSingleRoomPeople(definitions, assignments);
  return definitions.map(definition => {
    const key = quotaUsageKey(definition.nationCode, definition.discipline, definition.gender);
    const people = allocated.filter(person => person.groupKey === key);
    const usedSingleRooms = calculateQuotaUsage(people);
    const overflow = Math.max(0, usedSingleRooms - Math.max(0, definition.singleRoomsAllowed));
    return { key, allowedSingleRooms: definition.singleRoomsAllowed, usedSingleRooms, overflow, hasViolation: overflow > 0, people };
  });
}

/** Central interpretation for authoritative usage rows returned by the API. */
export function evaluateQuotaUsageRow(row: Pick<OfficialQuotaUsage, 'nationCode' | 'discipline' | 'gender' | 'singleRoomsUsed' | 'singleRoomsAllowed'>): QuotaGroupEvaluation {
  const overflow = Math.max(0, row.singleRoomsUsed - row.singleRoomsAllowed);
  return { key: quotaUsageKey(row.nationCode, row.discipline, row.gender), allowedSingleRooms: row.singleRoomsAllowed, usedSingleRooms: row.singleRoomsUsed, overflow, hasViolation: overflow > 0, people: [] };
}

/** Sums disjoint allocation rows, not overlapping eligibility views. Exempt and
 * unresolved people are excluded: use physicalSingleRoomUsageFromBookings for
 * overall booked physical capacity. */
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
  if (['M', 'MALE', 'MAN', 'MEN', 'HERR', 'HERREN'].includes(value)) return 'M';
  if (['F', 'W', 'FEMALE', 'WOMAN', 'WOMEN', 'DAME', 'DAMEN'].includes(value)) return 'W';
  return value;
};
