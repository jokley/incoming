import type { Athlete, AuditEvent, Event, Hotel, RoomType } from '../types';
import type { ImportSession } from '../data/importSessions';

export interface AuditActivity {
  category: 'Import' | 'Disposition' | 'Hotels' | 'Stammdaten' | 'Entscheidungen';
  activity: string;
  entity: string;
  details: string[];
  openLabel?: string;
  href?: string;
}

export interface AuditActivityContext {
  athletes?: Athlete[];
  hotels?: Hotel[];
  roomTypes?: RoomType[];
  events?: Event[];
  importSessions?: ImportSession[];
}

export type AssignmentWorkspaceRefs = {
  bookingId?: string | null;
  hotelId?: string | null;
  roomTypeId?: string | null;
  personId?: string | null;
};

/** The single deep-link contract for opening an assignment in the operations workspace. */
export function assignmentWorkspaceHref(refs: AssignmentWorkspaceRefs): string {
  const params = new URLSearchParams();
  if (refs.bookingId) params.set('assignmentId', refs.bookingId);
  if (refs.hotelId) params.set('hotelId', refs.hotelId);
  if (refs.roomTypeId) params.set('roomTypeId', refs.roomTypeId);
  if (refs.personId) params.set('athleteId', refs.personId);
  return `/assignments${params.size ? `?${params}` : ''}`;
}

export function auditActivityHref(event: AuditEvent): string | undefined {
  const refs = event.entityRefs ?? {};
  const value = (key: string) => refs[key] ? encodeURIComponent(refs[key]) : undefined;
  if (refs.decisionId) return `/import?decisionId=${value('decisionId')}`;
  if (event.category === 'Disposition' || refs.bookingId || refs.roomId) {
    return assignmentWorkspaceHref(refs);
  }
  if (refs.importSessionId) return `/import?sessionId=${value('importSessionId')}`;
  if (refs.personId) return `/athletes?athleteId=${value('personId')}`;
  if (refs.hotelId) return `/hotels?hotelId=${value('hotelId')}${refs.inventoryId ? `&inventoryId=${value('inventoryId')}` : ''}`;
  if (refs.eventId) return `/events?eventId=${value('eventId')}`;
  if (refs.roomTypeId) return `/room-types?roomTypeId=${value('roomTypeId')}`;
}

const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const id = (value: unknown) => value == null ? undefined : String(value);

function pathIds(path: string): string[] {
  return path.split('/').filter(part => /^\d+$/.test(part));
}

function personName(athlete: Athlete): string {
  return `${athlete.firstname} ${athlete.lastname}`.trim();
}

export function describeAuditEvent(event: AuditEvent, context: AuditActivityContext = {}): AuditActivity {
  // New records already contain their immutable fachliche description.  The
  // mappings below intentionally remain as compatibility for existing history.
  if (event.activity && event.category && event.entityLabel) {
    const refs = event.entityRefs ?? {};
    const href = auditActivityHref(event);
    const openLabel = refs.decisionId ? 'Entscheidung anzeigen' : refs.importSessionId ? 'Importsession öffnen'
      : event.category === 'Disposition' || refs.bookingId || refs.roomId ? 'Zuweisungen öffnen' : refs.personId ? 'Athlet öffnen'
      : refs.inventoryId ? 'Zimmerkontingent öffnen' : refs.hotelId ? 'Hotel öffnen'
      : refs.eventId ? 'Event öffnen' : refs.roomTypeId ? 'Zimmertyp öffnen' : undefined;
    return {
      category: event.category,
      activity: event.activity,
      entity: event.entityLabel,
      details: event.details ?? [],
      openLabel,
      href,
    };
  }
  const changes = event.changes ?? {};
  const ids = pathIds(event.path);
  const athleteIds = Array.isArray(changes.athleteIds) ? changes.athleteIds.map(String) : [];
  const occupantId = event.path.includes('/occupants/') ? ids.at(-1) : undefined;
  const people = [...athleteIds, ...(occupantId ? [occupantId] : [])]
    .map(athleteId => context.athletes?.find(athlete => athlete.id === athleteId))
    .filter((athlete): athlete is Athlete => Boolean(athlete));
  const peopleLabel = people.map(personName).join(', ');

  if (event.entityType === 'assignments') {
    const hotel = context.hotels?.find(item => item.id === id(changes.hotelId));
    const roomType = context.roomTypes?.find(item => item.id === id(changes.roomTypeId));
    const room = [roomType?.name, text(changes.roomNumber) && `Zimmer ${text(changes.roomNumber)}`].filter(Boolean).join(' – ');
    const isUnassign = event.action === 'unassign';
    return {
      category: 'Disposition',
      activity: isUnassign ? 'Zimmerzuweisung entfernt' : event.action === 'update' ? 'Zimmerzuweisung geändert' : 'Zimmer zugewiesen',
      entity: peopleLabel || (isUnassign ? 'Zimmerzuweisung' : 'Personenzuweisung'),
      details: [hotel?.name && `Hotel: ${hotel.name}`, room && `Zimmer: ${room}`].filter((value): value is string => Boolean(value)),
      openLabel: 'Zuweisungen öffnen',
      href: assignmentWorkspaceHref({
        bookingId: event.entityId ?? ids[0],
        hotelId: id(changes.hotelId),
        roomTypeId: id(changes.roomTypeId),
        personId: people[0]?.id,
      }),
    };
  }

  if (event.entityType === 'import') {
    const sessionId = event.path.includes('/sessions/') ? ids[0] : undefined;
    const session = context.importSessions?.find(item => item.id === sessionId);
    const sessionLabel = session ? [session.nation, session.discipline].filter(Boolean).join(' – ') : '';
    const version = session?.currentVersion?.version;
    const isApproval = event.path.includes('/approvals/');
    const approvedPeople = Array.isArray(changes.approvedPersonKeys)
      ? changes.approvedPersonKeys.map(key => String(key).split('|').filter(Boolean).slice(-2).join(' ')).filter(Boolean).join(', ')
      : '';
    let activity = 'Importdaten verarbeitet';
    if (event.path.endsWith('/import')) activity = 'Importsession abgeschlossen';
    else if (event.path.endsWith('/approve')) activity = 'Importsession freigegeben';
    else if (event.path.endsWith('/archive')) activity = 'Importsession archiviert';
    else if (event.path.endsWith('/history')) activity = 'Rücksprache dokumentiert';
    else if (isApproval && changes.decision === 'APPROVED') activity = 'Einzelzimmer-Ausnahme genehmigt';
    else if (isApproval && changes.decision === 'NEW_LIST_ANNOUNCED') activity = 'Neue Meldeliste angekündigt';
    return {
      category: isApproval ? 'Entscheidungen' : 'Import',
      activity,
      entity: approvedPeople || sessionLabel || text(changes.nation) || 'Importsession',
      details: [sessionLabel && approvedPeople && sessionLabel, version && `Version ${version}`, text(changes.costCoverage) && 'Mehrpreis genehmigt'].filter((value): value is string => Boolean(value)),
      openLabel: isApproval ? 'Entscheidung anzeigen' : 'Importsession öffnen', href: sessionId ? `/import?sessionId=${sessionId}` : '/import',
    };
  }

  const entityId = event.entityId ?? ids[0];
  if (event.entityType === 'hotels') {
    const hotel = context.hotels?.find(item => item.id === entityId);
    const name = text(changes.name) || hotel?.name || 'Hotel';
    const inventory = event.path.includes('/inventory');
    return {
      category: 'Hotels',
      activity: inventory
        ? ({ create: 'Zimmerkontingent angelegt', update: 'Zimmerkontingent geändert', delete: 'Zimmerkontingent entfernt' }[event.action] || 'Zimmerkontingent geändert')
        : ({ create: 'Hotel angelegt', update: 'Hotel geändert', delete: 'Hotel entfernt' }[event.action] || 'Hotel bearbeitet'),
      entity: name,
      details: [],
      openLabel: inventory ? 'Zimmerkontingent öffnen' : 'Hotel öffnen', href: `/hotels?hotelId=${entityId || ''}${inventory ? `&inventoryId=${ids.at(-1) || ''}` : ''}`,
    };
  }

  if (event.entityType === 'athletes') {
    const athlete = context.athletes?.find(item => item.id === entityId);
    const name = athlete ? personName(athlete) : [text(changes.firstname), text(changes.lastname)].filter(Boolean).join(' ');
    return { category: 'Stammdaten', activity: event.path.includes('acknowledge-roomlist-change') ? 'Meldelistenänderung bestätigt' : event.action === 'create' ? 'Athlet angelegt' : 'Athlet bearbeitet', entity: name || 'Person', details: [], openLabel: 'Athlet öffnen', href: `/athletes?athleteId=${entityId || ''}` };
  }

  if (event.entityType === 'events') {
    const item = context.events?.find(candidate => candidate.id === entityId);
    return { category: 'Stammdaten', activity: ({ create: 'Veranstaltung angelegt', update: 'Veranstaltung geändert', delete: 'Veranstaltung entfernt' }[event.action] || 'Veranstaltung bearbeitet'), entity: text(changes.discipline) || item?.discipline || 'Veranstaltung', details: [], openLabel: 'Event öffnen', href: `/events?eventId=${entityId || ''}` };
  }

  const labels: Record<string, string> = { 'room-types': 'Zimmerkategorie', admin: 'Testdaten' };
  const entity = labels[event.entityType] || 'Einstellung';
  return { category: 'Stammdaten', activity: ({ create: `${entity} angelegt`, update: `${entity} geändert`, delete: `${entity} entfernt` }[event.action] || `${entity} bearbeitet`), entity, details: [], openLabel: `${entity} öffnen`, href: event.entityType === 'room-types' ? '/room-types' : undefined };
}
