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
  const isSingleRoom = /single|einzel|\bsr\b/i.test(`${approval.type} ${approval.description}`);
  const quotaCheck = session.preview?.quotaChecks?.find(check => check.nationCode === approval.nation
    && check.discipline === approval.quotaDetails?.discipline && check.gender === approval.quotaDetails?.gender);
  const singleRoomCandidates = approval.quotaDetails?.singleRoomCandidates ?? [];
  return {
    approval,
    nation: session.nation,
    discipline: approval.quotaDetails?.discipline,
    people,
    rule: isSingleRoom ? 'Die gemeldeten Einzelzimmer überschreiten die aktuell verfügbare Quote.' : 'Die aktuell gültige Nationenquote wird durch die Meldung überschritten.',
    impact: 'Die bestehende Planung muss fachlich geprüft werden. Hotel- und Zimmerzuweisungen bleiben unverändert.',
    recommendation: isSingleRoom ? 'Mehrkosten abstimmen' : 'Neue Meldeliste anfordern',
    gender: approval.quotaDetails?.gender || quotaCheck?.gender || '—',
    quota: quotaCheck ? { current: Number(isSingleRoom ? quotaCheck.singleRooms : quotaCheck.officials), allowed: Number(isSingleRoom ? quotaCheck.singleRoomsAllowed : quotaCheck.officialQuota), label: isSingleRoom ? 'Single Rooms' : 'Officials' } : undefined,
    singleRoomCandidates,
    singleRoomReviewPeople: approval.quotaDetails?.singleRoomReviewPeople ?? singleRoomCandidates,
    excessCount: Number(approval.quotaDetails?.excessCount ?? 0),
  };
}
