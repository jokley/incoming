import type { Athlete, AuditEvent, Event, Hotel, RoomType } from '../types';
import type { ImportSession } from '../data/importSessions';

export interface AuditActivity {
  category: 'Import' | 'Assignments' | 'Hotels' | 'Nationen' | 'Administration';
  activity: string;
  entity: string;
  details: string[];
}

export interface AuditActivityContext {
  athletes?: Athlete[];
  hotels?: Hotel[];
  roomTypes?: RoomType[];
  events?: Event[];
  importSessions?: ImportSession[];
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
      category: 'Assignments',
      activity: isUnassign ? 'Zimmerzuweisung entfernt' : event.action === 'update' ? 'Zimmerzuweisung geändert' : 'Zimmer zugewiesen',
      entity: peopleLabel || (isUnassign ? 'Zimmerzuweisung' : 'Personenzuweisung'),
      details: [hotel?.name && `Hotel: ${hotel.name}`, room && `Zimmer: ${room}`].filter((value): value is string => Boolean(value)),
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
      category: 'Import',
      activity,
      entity: approvedPeople || sessionLabel || text(changes.nation) || 'Importsession',
      details: [sessionLabel && approvedPeople && sessionLabel, version && `Version ${version}`, text(changes.costCoverage) && 'Mehrpreis genehmigt'].filter((value): value is string => Boolean(value)),
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
    };
  }

  if (event.entityType === 'athletes') {
    const athlete = context.athletes?.find(item => item.id === entityId);
    const name = athlete ? personName(athlete) : [text(changes.firstname), text(changes.lastname)].filter(Boolean).join(' ');
    return { category: 'Nationen', activity: event.path.includes('acknowledge-roomlist-change') ? 'Meldelistenänderung bestätigt' : event.action === 'create' ? 'Person angelegt' : 'Personendaten geändert', entity: name || 'Person', details: [] };
  }

  if (event.entityType === 'events') {
    const item = context.events?.find(candidate => candidate.id === entityId);
    return { category: 'Administration', activity: ({ create: 'Veranstaltung angelegt', update: 'Veranstaltung geändert', delete: 'Veranstaltung entfernt' }[event.action] || 'Veranstaltung bearbeitet'), entity: text(changes.discipline) || item?.discipline || 'Veranstaltung', details: [] };
  }

  const labels: Record<string, string> = { 'room-types': 'Zimmerkategorie', admin: 'Testdaten' };
  const entity = labels[event.entityType] || 'Einstellung';
  return { category: 'Administration', activity: ({ create: `${entity} angelegt`, update: `${entity} geändert`, delete: `${entity} entfernt` }[event.action] || `${entity} bearbeitet`), entity, details: [] };
}
