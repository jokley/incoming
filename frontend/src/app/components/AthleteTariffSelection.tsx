import type { AccommodationRateFields, QuotaExtent } from '../types';
import { InfoPanel } from '../design-system';
type Candidate={personKey:string;name?:string;gender?:string};
type Effect='NONE'|'SPECIAL_SELECTED';
export function tariffSelectionValid(extent:QuotaExtent,candidates:Candidate[],selected:string[],effect:Effect) {
  if(effect==='NONE')return true;
  const genders=selected.map(key=>candidates.find(p=>p.personKey===key)?.gender);
  return Math.max(extent.total,extent.M+extent.F)>0 && selected.length===Math.max(extent.total,extent.M+extent.F) && new Set(selected).size===selected.length && genders.every(g=>g==='M'||g==='F') && genders.filter(g=>g==='M').length>=extent.M && genders.filter(g=>g==='F').length>=extent.F;
}
export function AthleteTariffSelection({extent,candidates,selected,effect,onEffect,onSelected}:{extent:QuotaExtent;candidates:Candidate[];selected:string[];effect:Effect;onEffect:(value:Effect)=>void;onSelected:(keys:string[])=>void}) {
  const count=Math.max(extent.total,extent.M+extent.F);
  return <div className="mt-3 space-y-3"><label className="block text-sm font-bold">Tarifwirkung<select className="mt-1 block w-full rounded-lg border border-[var(--ops-border)] bg-[var(--ops-background)] p-2 text-[var(--ops-text)]" value={effect} onChange={e=>onEffect(e.target.value as Effect)}><option value="NONE">Keine automatische Tarifänderung</option><option value="SPECIAL_SELECTED">Kostenpflichtige Zusatzathleten: Sondertarif</option></select></label>
  <InfoPanel tone="info" title="Wirkung vor dem Speichern">{effect==='SPECIAL_SELECTED'?`Genau ${count} unterschiedliche Zusatzathleten auswählen, darunter mindestens ${extent.M} Männer und ${extent.F} Frauen. Gesamt- und Geschlechtergrenzen überlappen: Jede Person erhält höchstens einmal Sondertarif. Bei Teilgenehmigungen kann dieselbe Person unterschiedliche Grenzen abdecken, dieselbe Grenze aber nur einmal. Beim Import wird SPECIAL mit Genehmigungsherkunft gespeichert. Manuelle Tarife bleiben erhalten und müssen bei Abweichungen ausdrücklich geprüft werden.`:'Die Genehmigung verändert keine Unterkunftstarife. Für kostenpflichtige Zusatzathleten Sondertarif und konkrete Personen ausdrücklich auswählen.'} Preisliche Festlegung offen; es wird kein Betrag berechnet. EZ-Genehmigungen bleiben unabhängig.</InfoPanel>
  {effect==='SPECIAL_SELECTED'&&<fieldset className="max-h-64 overflow-y-auto rounded-lg border border-[var(--ops-border)] p-3"><legend className="px-1 text-sm font-bold">Betroffene Zusatzathleten · {selected.length} / {count}</legend>{candidates.map(p=><label key={p.personKey} className="flex items-center gap-2 py-1 text-sm"><input type="checkbox" checked={selected.includes(p.personKey)} onChange={e=>onSelected(e.target.checked?[...selected,p.personKey]:selected.filter(k=>k!==p.personKey))}/>{p.name || p.personKey} · {p.gender==='M'?'Mann':p.gender==='F'?'Frau':'Geschlecht prüfen'}</label>)}</fieldset>}</div>;
}
export function AccommodationRateProvenance({person}:{person:AccommodationRateFields}) {
  const ids=person.accommodationRateApprovalIds ?? (person.accommodationRateApprovalId?[person.accommodationRateApprovalId]:[]);
  if(!ids.length&&!person.accommodationRateExplanation)return null;
  return <p className="text-xs text-[var(--ops-text-muted)]">{person.accommodationRateSource==='MANUAL'?'Manueller Tarif hat Vorrang. ':''}Athletenquoten-Genehmigung {ids.map(id=>`#${id}`).join(', ')}. {person.accommodationRateExplanation || 'Gespeicherter Sondertarif aus Genehmigung. Preisliche Festlegung offen.'}</p>;
}
