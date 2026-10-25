import type { ImportChangePlan as Plan } from '../types';
import { InfoPanel, OpsButton } from '../design-system';

export function ImportChangePlan({ plan, stale, editable, destructiveConfirmed, onDestructive, onRecheck, busy }: {
  plan?: Plan | null; stale?: boolean; editable: boolean; destructiveConfirmed: boolean;
  onDestructive: (value: boolean) => void; onRecheck: () => void; busy: boolean;
}) {
  return <section aria-labelledby="import-change-plan" className="space-y-3 rounded-xl border border-[var(--ops-border)] p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 id="import-change-plan" className="font-bold">Änderungsplan</h3><OpsButton onClick={onRecheck} disabled={busy}>Erneut prüfen / Reimport vorbereiten</OpsButton></div>
    {stale && <InfoPanel tone="warning" title="Prüfstand veraltet">Der relevante Datenstand wurde geändert. Erneut prüfen und anschließend neu freigeben.</InfoPanel>}
    {!plan ? <p className="text-sm">Vor der Freigabe ist eine erneute Prüfung erforderlich.</p> : <>
      <p className="text-sm">{plan.nation} · Event {plan.eventId} · Version {plan.importVersion} · Vollständiger Nationen-Snapshot</p>
      <p className="text-sm">{plan.people.create.length} neu · {plan.people.update.length} aktualisiert · {plan.people.unchanged.length} unverändert · <strong>{plan.people.remove.length} zu entfernen</strong></p>
      <p className="text-xs text-[var(--ops-text-muted)]">Competitions: {plan.memberships.add.length} hinzufügen · {plan.memberships.remove.length} entfernen. Buchungen: {plan.operations.bookingIds.length} betroffen · {plan.operations.deleteEmptyBookingIds.length} werden leer und entfernt.</p>
      {plan.people.remove.map(person => <details key={person.personId} className="rounded-lg border border-[var(--ops-border)] p-2 text-sm">
        <summary className="cursor-pointer font-semibold">{person.name} · Person {person.personId} · FIS {person.fisCode ?? '—'} · Staff {person.competitorId ?? '—'}</summary>
        <div className="mt-2 space-y-1 break-words text-xs">
          <p>Competitions: {person.competitions?.map(c=>c.name).join(', ') || person.competitionIds?.join(', ') || '—'}. Buchungen: {person.bookingIds?.join(', ') || '—'}.</p>
          <p>Unterkunft: {person.before?.accommodation_requirement} ({person.before?.accommodation_requirement_source}) · Tarif: {person.before?.accommodation_rate_category} ({person.before?.accommodation_rate_source})</p>
          <p>EZ-Status: {person.before?.single_room_status} · Ausnahme: {person.before?.single_room_quota_exempt_reason ?? '—'} · Entscheidung: {person.approvalId ?? '—'}</p>
          <p>Historische Genehmigungs-Evidence bleibt erhalten.</p>
        </div>
      </details>)}
      {(plan.people.update.length > 0 || plan.memberships.remove.length > 0) && <details className="text-sm"><summary className="cursor-pointer">Änderungen und Competition-Zuordnungen anzeigen</summary>
        {plan.people.update.map(person => <div key={person.personId} className="my-2 break-words"><strong>{person.name}</strong>{person.changes?.map(change => <p key={change.field} className="text-xs">{change.field}: {String(change.old ?? '—')} → {String(change.new ?? '—')}</p>)}<p className="text-xs">Bisherige Genehmigung: {person.approvalApplicability ?? '—'}</p></div>)}
        {plan.memberships.remove.map((m,i) => <p key={i} className="text-xs">Person {m.personId ?? m.personKey}: Competition {m.competitionId} entfernen</p>)}
      </details>}
      {[...plan.people.update,...plan.people.unchanged].some(p=>p.approvalId) && <details className="text-sm"><summary className="cursor-pointer">Bestehende Genehmigungen und Anwendbarkeit</summary>{[...plan.people.update,...plan.people.unchanged].filter(p=>p.approvalId).map(p=><p key={p.personId} className="break-words text-xs">{p.name} · Entscheidung {p.approvalId}: {p.approvalApplicability==='APPLICABLE'?'weiterhin anwendbar':'erneut zu prüfen; historische Evidence bleibt erhalten'}</p>)}</details>}
      {plan.operations.bookings.map(booking => <p key={booking.id} className="break-words text-xs">Buchung {booking.id} · {booking.check_in_date}–{booking.check_out_date} · Als EZ werten: {booking.counts_as_single ? 'Ja' : 'Nein'} · {plan.operations.deleteEmptyBookingIds.includes(booking.id) ? 'Nach Entfernung leer: löschen' : 'Verbleibende Belegung und Einstellungen erhalten'}</p>)}
      {plan.operations.legacy?.map(r=><p key={`legacy-${r.id}`} className="text-xs">Legacy-Zuordnung {r.id}: {r.action==='DELETE'?'entfernen':'Partnerbezug aufheben; Hauptperson behalten'}.</p>)}
      {plan.operations.fis?.map(r=><p key={`fis-${r.id}`} className="text-xs">FIS-Zuordnung {r.id}: {r.action==='DELETE'?'entfernen':`Person ${r.survivorId} und Zuordnung behalten; Partnerbezug aufheben`}.</p>)}
      {plan.operations.clearPartnerFields?.length ? <p className="text-xs">Textbezug auf entfernte Zimmerpartner bei Personen {plan.operations.clearPartnerFields.join(', ')} entfernen.</p>:null}
      {plan.operations.partnerIds.length > 0 && <p className="text-xs">Betroffene verbleibende Zimmerpartner: {plan.operations.partners?.map(p=>`${p.name} (${p.id})`).join(', ') || plan.operations.partnerIds.join(', ')}. Nur ausdrücklich aufgeführte Beziehungsänderungen werden angewendet.</p>}
      {editable && <div className="space-y-2 text-sm">
        <p className="text-sm text-muted-foreground">Diese Meldung ersetzt den bisherigen vollständigen Nationenbestand für das ausgewählte Event. Fehlende Personen werden nach Prüfung bei der Importbestätigung entfernt.</p>
        {plan.requiresDestructiveConfirmation && <label className="flex items-start gap-2"><input type="checkbox" checked={destructiveConfirmed} disabled={busy || stale} onChange={e => onDestructive(e.target.checked)} /><span>Ich bestätige die aufgeführten Personen-/Competition-Entfernungen und Buchungsfolgen, einschließlich {plan.operations.deleteEmptyBookingIds.length} leer werdender Buchungen.</span></label>}
      </div>}
    </>}
  </section>;
}
