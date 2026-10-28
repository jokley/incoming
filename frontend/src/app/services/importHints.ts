import type { FisImportIssue } from '../types.ts';

const labels: Record<string,string> = {
  INFO_OFFICIALS_OVER_BASIS: 'Officials über Basis (informativ)',
  QUOTA_SINGLE_ROOMS_EXCEEDED: 'Zusätzliche Einzelzimmer (Entscheidungsbedarf siehe offene Entscheidungen)',
};

/** Display the existing warning categories; never infer workflow requirements. */
export function importHintCategories(issues: FisImportIssue[]) {
  const grouped = new Map<string,{code:string;label:string;count:number}>();
  for (const issue of issues) {
    const category = grouped.get(issue.code);
    if (category) category.count += 1;
    else grouped.set(issue.code,{code:issue.code,label:labels[issue.code] ?? issue.message,count:1});
  }
  return [...grouped.values()];
}

export type ImportListFilter = 'all'|'error'|'clarification'|'partner'|'noRoom'|'singleRoom'|'special'|'stay'|'stayUnclear';
export const importListFilters:Record<ImportListFilter,string>={all:'Alle Einträge',error:'Importfehler',clarification:'Klärungsbedarf',partner:'Zimmerpartner fehlt oder unklar',noRoom:'No Room',singleRoom:'Einzelzimmer / EZ-Status',special:'Sondertarif',stay:'Aufenthaltsabweichungen',stayUnclear:'Aufenthalt nicht prüfbar'};


import type {FisImportPreview,ImportControl,FisImportPreviewPerson,QuotaOverview} from '../types.ts';
type Room=FisImportPreview['rooms'][number];
const partnerCode=(code:string)=>/PARTNER|SHARED_PARTNER/.test(code);
export function roomNeedsPartner(room:Room,control?:ImportControl) {
 return Boolean((/^double/i.test(room.roomType)&&!room.person2Key)||control?.issues.some(i=>partnerCode(i.code)&&i.source==='Room List'&&i.row===room.rowNumber));
}
export function personMatchesImportFilter(person:FisImportPreviewPerson,filter:ImportListFilter,preview:FisImportPreview,control?:ImportControl) {
 switch(filter){
  case 'all':return true;
  case 'stay':return (control?.people.find(p=>p.personKey===person.matchKey)?.stayWindow?.outsideNights??0)>0;
  case 'stayUnclear':{const reason=control?.people.find(p=>p.personKey===person.matchKey)?.stayWindow?.reason;return Boolean(reason&&reason!=='NO_ROOM');}
  case 'clarification':return Boolean(control?.issues.some(i=>i.kind==='clarification'&&i.personKeys.includes(person.matchKey)&&(!partnerCode(i.code)||!preview.rooms.some(r=>[r.person1Key,r.person2Key].includes(person.matchKey)))));
  case 'noRoom':return person.accommodationRequirement==='NO_ROOM';
  case 'special':return person.accommodationRateCategory==='SPECIAL';
  case 'singleRoom':return ['IN_QUOTA','APPROVED_EXTRA','APPROVAL_REQUIRED','QUOTA_EXEMPT'].includes(person.singleRoomEntitlement??'')||preview.rooms.some(r=>[r.person1Key,r.person2Key].includes(person.matchKey)&&r.roomType.toLowerCase()==='single');
  case 'partner':return Boolean(control?.issues.some(i=>partnerCode(i.code)&&i.personKeys.includes(person.matchKey)))||preview.rooms.some(r=>[r.person1Key,r.person2Key].includes(person.matchKey)&&roomNeedsPartner(r,control));
  case 'error':return Boolean(control?.issues.some(i=>i.kind==='error'&&i.personKeys.includes(person.matchKey)))||preview.errors.some(i=>!i.code.startsWith('ROOM_')&&(i.details?.personKey===person.matchKey||i.details?.row===person.rowNumber||i.details?.rowNumber===person.rowNumber));
 }
}
export function roomMatchesImportFilter(room:Room,filter:ImportListFilter,preview:FisImportPreview,control?:ImportControl) {
 if(filter==='all')return true;
 if(filter==='partner')return roomNeedsPartner(room,control);
 if(filter==='clarification')return Boolean(control?.issues.some(i=>i.kind==='clarification'&&i.source==='Room List'&&i.row===room.rowNumber&&!partnerCode(i.code)));
 if(filter==='error')return preview.errors.some(i=>i.code.startsWith('ROOM_')&&(i.details?.row===room.rowNumber||i.details?.rowNumber===room.rowNumber))||Boolean(control?.issues.some(i=>i.kind==='error'&&i.source==='Room List'&&i.row===room.rowNumber));
 return preview.people.some(p=>[room.person1Key,room.person2Key].includes(p.matchKey)&&personMatchesImportFilter(p,filter,preview,control));
}

/** Scope for direct navigation from existing quota aggregates to the person list. */
export interface QuotaPeopleFilter {
 nation:string;role:'officials'|'athletes';group?:string;multipleGroups?:boolean;family?:string;gender?:'M'|'F';personKeys?:string[];competition?:string;
}
export function personMatchesQuotaFilter(person:FisImportPreviewPerson,filter:QuotaPeopleFilter|null) {
 if(!filter)return true;
 const athlete=person.function?.trim().toLowerCase()==='athlete';
 const groups=new Set(person.quotaDisciplines??[]);
 return person.nationCode===filter.nation&&(filter.role==='athletes'?athlete:!athlete&&groups.size>0)
  &&(!filter.personKeys||filter.personKeys.includes(person.matchKey))&&(!filter.group||groups.has(filter.group))&&(!filter.multipleGroups||groups.size>1)
  &&(!filter.family||person.athleteQuotaFamilies?.includes(filter.family))
  &&(!filter.gender||(filter.gender==='F'?['F','W'].includes(person.gender??''):person.gender==='M'));
}

/** Count table positions, never athletes or additive SS/BA quota excess. */
export function sportClarifications(control?:ImportControl,nation?:string) {
 const positions=new Map<string,{id:string;name:string;gender:string|null;nation:string}>();
 for(const competition of control?.competitions??[])for(const entry of competition.sportEntries??[]){
  if(entry.unverifiedAdditional>0&&(!nation||entry.nation===nation))positions.set(`${entry.nation}/${competition.id}`,{id:competition.id,name:competition.name,gender:competition.gender,nation:entry.nation});
 }
 return [...positions.values()];
}
export function officialsSummary(nation:QuotaOverview['nations'][number],fixed:boolean) {
 const review=!fixed||nation.incomplete||nation.coverageReviewRequired||nation.officialsWithoutContext>0||nation.groups.some(group=>group.coverageReviewRequired);
 const pending=nation.ezDecisionsOpen>0||nation.groups.some(group=>group.totals.singleRoomsPending>0);
 return {label:pending?(review?'Entscheidung offen · Abdeckung prüfen':'Entscheidung offen'):review?'Abdeckung prüfen':'OK',tone:pending||review?'warning' as const:'success' as const};
}
