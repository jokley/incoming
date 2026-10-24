import type { SingleRoomQuotaExemptReason } from '../types.ts';
import type { ImportApproval, ImportSession } from '../data/importSessions.ts';

export type OperationsTask = {
  approval: ImportApproval;
  nation: string;
  discipline?: string;
  people: string[];
  rule: string;
  impact: string;
  recommendation: string;
  gender: string;
  quota?: { current: number; allowed: number; label: string };
  singleRoomCandidates: Array<{ personKey: string; name: string; function?: string; singleRoomQuotaExemptReason?: SingleRoomQuotaExemptReason }>;
  singleRoomReviewPeople: Array<{ personKey: string; name: string; function?: string; singleRoomQuotaExemptReason?: SingleRoomQuotaExemptReason }>;
  excessCount: number;
};

export function quotaViolationLabel(label: string, current: number, allowed: number) {
  return `${label} überschritten (${current} / ${allowed})`;
}

export function buildOperationsTask(session: ImportSession, approval: ImportApproval): OperationsTask {
  const quotaRecord = session.preview?.dispositionAnalysis?.categories.quotaAffected.records.find(record =>
    String(record.nation ?? '') === approval.nation,
  );
  const people = [quotaRecord?.athlete, quotaRecord?.person, quotaRecord?.name]
    .filter((value): value is string => typeof value === 'string' && Boolean(value));
  const details = approval.quotaDetails;
  const isSingleRoom = details?.decisionKind === 'SINGLE_ROOM' || details?.singleRoomCandidates !== undefined || details?.singleRoomsAllowed !== undefined;
  const quotaCheck = session.preview?.quotaChecks?.find(check => check.nationCode === approval.nation
    && check.discipline === approval.quotaDetails?.discipline && check.gender === approval.quotaDetails?.gender);
  const singleRoomCandidates = approval.quotaDetails?.singleRoomCandidates ?? [];
  return {
    approval,
    nation: session.nation,
    discipline: approval.quotaDetails?.family ?? approval.quotaDetails?.discipline,
    people,
    rule: isSingleRoom ? 'Die gemeldeten Einzelzimmer überschreiten die aktuell verfügbare Quote.' : 'Die aktuell gültige Nationenquote wird durch die Meldung überschritten.',
    impact: 'Die bestehende Planung muss fachlich geprüft werden. Hotel- und Zimmerzuweisungen bleiben unverändert.',
    recommendation: details?.decisionKind==='ATHLETE_QUOTA' ? 'Ausnahmeumfang je Grenze abstimmen; keine automatische Tarifentscheidung.' : isSingleRoom ? 'Mehrkosten abstimmen' : 'Neue Meldeliste anfordern',
    gender: approval.quotaDetails?.gender || quotaCheck?.gender || '—',
    quota: details?.decisionKind==='ATHLETE_QUOTA' ? undefined : isSingleRoom ? { current: Number(details?.ezRequested ?? details?.singleRoomsRequested ?? details?.importedSingleRooms ?? quotaCheck?.singleRoomsRequested ?? quotaCheck?.singleRooms ?? 0), allowed: Number(details?.ezEntitlement ?? details?.singleRoomsAllowed ?? quotaCheck?.singleRoomsAllowed ?? 0), label: 'Single Rooms' } : quotaCheck ? {current:quotaCheck.officials,allowed:quotaCheck.officialQuota,label:'Officials'} : undefined,
    singleRoomCandidates,
    singleRoomReviewPeople: approval.quotaDetails?.singleRoomReviewPeople ?? singleRoomCandidates,
    excessCount: Number(details?.ezExcess ?? details?.excessCount ?? 0),
  };
}
