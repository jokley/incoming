import {createContext,useContext} from 'react';
import {Tooltip} from '@mui/material';
import {AlertTriangle,Bed,CheckCircle2,CircleHelp,Clock,Home} from 'lucide-react';
import type {PersonDispositionStatus,PersonDispositionSummary} from '../../services/fisRules';
import {accommodationStatusText,preferenceStatusText,singleStatusText,personStatusIndicators,personTaskCategories,type PersonTaskCategory} from '../../services/assignmentPresentation';
import {periodLabel} from '../../services/dispositionItems';
import {sportAreaLabel} from '../../services/competitionPresentation';

const reportedRoomLabels:Record<string,string>={'single':'Einzelzimmer','double':'Doppelzimmer','double shared':'Doppelzimmer (geteilt)','twin':'Zweibettzimmer'};

export const PersonDispositionContext=createContext<{people:Map<string,PersonDispositionStatus>;ready:boolean;onOpen:(id:string)=>void}|null>(null);

export function PersonStatusIcons({personId,interactive=true}:{personId:string;interactive?:boolean}) {
 const context=useContext(PersonDispositionContext);
 if(!context)return null;
 const person=context.ready?context.people.get(personId):undefined;
 const explanation=person?[accommodationStatusText[person.accommodation.coverageStatus],preferenceStatusText[person.roomPreference.status],singleStatusText[person.singleRoom.status],person.singleRoom.reason].filter(Boolean).join(' · '):'Personenstatus wird neu bewertet oder ist nicht verfügbar';
 return <span className="inline-flex shrink-0 items-center gap-1 align-middle" aria-label="Personenstatus">{personStatusIndicators(person).map(indicator=>{
  const Icon=indicator.kind==='unknown'?CircleHelp:indicator.tone==='warning'?AlertTriangle:indicator.kind==='single'?Bed:indicator.tone==='success'?CheckCircle2:Clock;
  const icon=<Icon className="h-3.5 w-3.5" aria-hidden="true"/>;
  const label=`${indicator.label} · ${person?.name??'Person'}: ${explanation}`;
  const style=`inline-flex rounded p-0.5 ${indicator.tone==='warning'?'text-[var(--ops-warning)]':indicator.tone==='success'?'text-[var(--ops-success)]':'text-[var(--ops-text-muted)]'}`;
  return <Tooltip key={indicator.kind} title={label}>{interactive?<button type="button" aria-label={label} className={style} disabled={!person} onClick={event=>{event.stopPropagation();context.onOpen(personId);}} onDragStart={event=>{event.preventDefault();event.stopPropagation();}}>{icon}</button>:<span title={label} className={style}>{icon}</span>}</Tooltip>;
 })}</span>;
}

export function PersonWorkSummary({summary,ready,loading,error,scope,family,onFamily,onCategory,onRetry}:{summary?:PersonDispositionSummary;ready:boolean;loading:boolean;error?:string|null;scope:string;family:string;onFamily:(value:string)=>void;onCategory:(key:PersonTaskCategory)=>void;onRetry:()=>void}) {
 return <section aria-label="Personen Soll/Ist" aria-busy={loading} className="mx-3 my-1 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface)] px-2 py-1.5 text-[11px]">
  <span title="Personenübersicht: Kategorien können sich überschneiden. Warteschlangensuche, Zimmer- und Hotelfilter ändern diesen Bezug nicht." className="font-semibold">{scope}</span>
  <label>Bereich <select aria-label="Bereich der Personenübersicht" value={family} onChange={event=>onFamily(event.target.value)} className="rounded border border-[var(--ops-border)] bg-[var(--ops-background)] p-1"><option value="">Alle Bereiche</option>{['Snowboard','Freestyle'].map(value=><option key={value} value={value}>{sportAreaLabel(value)}</option>)}</select></label>
  {personTaskCategories.map(category=>category.key==='accommodationConflicts'&&ready&&!summary?.accommodationConflicts?null:<button key={category.key} type="button" disabled={!ready} title={`${category.hint} ${scope} Kategorien können sich überschneiden.`} onClick={()=>onCategory(category.key)} className="rounded border border-[var(--ops-border)] px-2 py-1 text-[var(--ops-text)] hover:bg-[var(--ops-surface-elevated)] disabled:text-[var(--ops-text-muted)]"><span>{category.label}</span> <strong>{ready&&summary?category.key==='fullyAssigned'?`${summary.fullyAssigned} / ${summary.planningConflicts?'Klärung':summary.operationalAccommodationDemand??summary.accommodationPeopleRequired}`:summary[category.key]:'—'}</strong></button>)}
  {ready&&summary?.virtualGroups? <span className="text-[var(--ops-warning)]">{summary.virtualPlaces} virtuelle Plätze · {summary.virtualGroups} vorläufige Gruppen · noch nicht disponierbar{summary.planningConflicts?` · ${summary.planningConflicts} Klärungsfälle`:''}</span>:null}
  {!ready&&<span role="status" className="text-[var(--ops-text-muted)]">{loading?'Personenstatus wird aktualisiert …':error??'Personenstatus noch nicht verfügbar'}</span>}
  {error&&<button type="button" disabled={loading} onClick={onRetry} className="text-[var(--ops-primary)] underline">Erneut laden</button>}
 </section>;
}

export function PersonStatusDetails({person,onDetails,onBooking,onDecision}:{person:PersonDispositionStatus;onDetails:()=>void;onBooking:(id:string)=>void;onDecision:(id:string)=>void}) {
 const {accommodation:coverage,roomPreference:preference,singleRoom:single}=person;
 return <div className="space-y-4 p-4 text-sm text-[var(--ops-text)]">
  <p>{person.nationCode} · Person {person.personId} · Persönliches Geschlecht: {person.personalGender||'unbekannt'}</p>
  {!person.matchesContextFilters&&<p className="text-[var(--ops-warning)]">Kontextloser EZ-Fall außerhalb des gewählten Kontextfilters – weiterhin eingeblendet.</p>}
  <section><h3 className="font-bold"><Home className="mr-1 inline h-4 w-4"/>{accommodationStatusText[coverage.coverageStatus]}</h3><p>Erforderlicher Aufenthalt: {periodLabel(coverage.overallInterval)}</p>{coverage.coveredIntervals.map((interval,index)=><p key={index}>Abgedeckt: {periodLabel(interval)}</p>)}{coverage.openIntervals.map((interval,index)=><p key={index}>Offen: {periodLabel(interval)}</p>)}{coverage.conflicts.length>0&&<p className="text-[var(--ops-warning)]">Aufenthaltsdaten oder Zuweisungen sind widersprüchlich. {coverage.conflicts.map(c=>c.code).join(' · ')}</p>}</section>
  <section><h3 className="font-bold">{preferenceStatusText[preference.status]}</h3><p>Gemeldeter Zimmerwunsch: {reportedRoomLabels[preference.reportedValue?.trim().toLowerCase()??'']??(preference.reportedValue||'Nicht angegeben')}</p><h4 className="mt-2 font-semibold">Tatsächliche Unterbringung</h4><ul className="mt-1 space-y-2">{preference.segments.map(segment=><li key={segment.bookingId}><button type="button" className="text-[var(--ops-primary)] underline" onClick={()=>onBooking(segment.bookingId)}>{periodLabel(segment)} · {segment.hotelName??'Unterkunft'} · Buchung {segment.bookingId}</button><p>{segment.roomTypeName??'Zimmerkategorie unklar'} · {segment.occupantCount} Personen · EZ-Wertung {segment.countsAsSingle?'Ja':'Nein'} · {preferenceStatusText[segment.comparison]}</p></li>)}</ul></section>
  <section><h3 className="font-bold">EZ-Deckung</h3><p>{singleStatusText[single.status]}</p>{single.reason&&<p className="text-[var(--ops-warning)]">{single.reason}</p>}{single.context&&<p>Verwendeter Deckungskontext: {single.context.join(' · ')}</p>}{single.eligibleContexts.length>0&&<p>Zulässige Kontexte: {single.eligibleContexts.map(c=>c.join(' · ')).join(' / ')}</p>}{single.exemptionReason&&<p>Ausnahmegrund: {single.exemptionReason==='WORLD_CHAMPION'?'Weltmeister':single.exemptionReason==='OTHER'?'Kostenfreie Ausnahme':single.exemptionReason}</p>}{(single.applicableApprovalId||single.storedApprovalId)&&<button type="button" onClick={()=>onDecision((single.applicableApprovalId||single.storedApprovalId)!)} className="text-[var(--ops-primary)] underline">Entscheidung {single.applicableApprovalId||single.storedApprovalId}{single.applicableApprovalId?single.hasSingleUse?' · anwendbar und genutzt':' · anwendbar, ohne aktive EZ-Nutzung':' · historisch / aktuell nicht anwendbar'}</button>}</section>
  <button type="button" className="rounded border border-[var(--ops-border)] px-3 py-2" onClick={onDetails}>Unterkunfts- / Personendetails öffnen</button>
 </div>;
}
