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
 nation?:string;role:'officials'|'athletes'|'people';group?:string;multipleGroups?:boolean;family?:string;gender?:'M'|'F';personKeys?:string[];competition?:string;
}
export function personMatchesQuotaFilter(person:FisImportPreviewPerson,filter:QuotaPeopleFilter|null) {
 if(!filter)return true;
 const athlete=person.function?.trim().toLowerCase()==='athlete';
 const groups=new Set(person.quotaDisciplines??[]);
 return (!filter.nation||person.nationCode===filter.nation)&&(filter.role==='people'||(filter.role==='athletes'?athlete:!athlete&&groups.size>0))
  &&(!filter.personKeys||filter.personKeys.includes(person.matchKey))&&(!filter.group||groups.has(filter.group))&&(!filter.multipleGroups||groups.size>1)
  &&(!filter.family||person.athleteQuotaFamilies?.includes(filter.family))
  &&(!filter.gender||(filter.gender==='F'?['F','W'].includes(person.gender??''):person.gender==='M'));
}

/** Count table positions, never athletes or additive SS/BA quota excess. */
export function sportClarifications(control?:ImportControl,nation?:string) {
 const positions=new Map<string,{id:string;name:string;gender:string|null;nation:string}>();
 for(const competition of control?.competitions??[])for(const entry of competition.sportEntries??[]){
  if((entry.reported??1)>0&&(entry.status==='REVIEW_REQUIRED'||entry.status==='INCOMPLETE'||entry.unverifiedAdditional>0)&&(!nation||entry.nation===nation))positions.set(`${entry.nation}/${competition.id}`,{id:competition.id,name:competition.name,gender:competition.gender,nation:entry.nation});
 }
 return [...positions.values()];
}
export function officialsSummary(nation:QuotaOverview['nations'][number],fixed:boolean) {
 const review=!fixed||nation.incomplete||nation.coverageReviewRequired||nation.officialsWithoutContext>0||nation.groups.some(group=>group.coverageReviewRequired);
 const pending=nation.ezDecisionsOpen>0||nation.groups.some(group=>group.totals.singleRoomsPending>0);
 return {label:pending?(review?'Entscheidung offen · Abdeckung prüfen':'Entscheidung offen'):review?'Abdeckung prüfen':'OK',tone:pending||review?'warning' as const:'success' as const};
}

/** Counts the existing personal allocation; never assigns entitlement or quota. */
export function singleRoomSummary(preview:FisImportPreview,nation?:string) {
 const people=preview.people.filter(p=>!nation||p.nationCode===nation);
 const categories={COVERED:[] as string[],APPROVED_EXTRA:[] as string[],EXEMPT:[] as string[],PENDING:[] as string[]};
 const byKey=new Map(people.map(p=>[p.matchKey,p]));
 const members=new Map<string,{keys:Set<string>;statuses:Set<string>;reasons:Set<string>;contexts:Set<string>}>();
 let available=people.every(p=>'singleRoomAllocation' in p);
 let complete=available;
 for(const person of people){
  const allocation=person.singleRoomAllocation;
  if(!allocation)continue;
  const identity=person.existingAthleteId!=null?`persisted:${person.existingAthleteId}`:allocation.identity??person.matchKey;
  if(!identity){available=false;continue;}
  const member=members.get(`${person.nationCode}:${identity}`)??{keys:new Set<string>(),statuses:new Set<string>(),reasons:new Set<string>(),contexts:new Set<string>()};
  if(person.matchKey)member.keys.add(person.matchKey);else available=false;
  member.reasons.add(person.singleRoomQuotaExemptReason??'');
  member.contexts.add(JSON.stringify(allocation.context));
  member.statuses.add(allocation.status??'');members.set(`${person.nationCode}:${identity}`,member);
  if(!allocation.context)complete=false;
 }
 const counts={COVERED:0,APPROVED_EXTRA:0,EXEMPT:0,PENDING:0};
 const exemptions={WORLD_CHAMPION:{count:0,personKeys:[] as string[]},OTHER:{count:0,personKeys:[] as string[]},UNKNOWN:{count:0,personKeys:[] as string[]}};
 for(const member of members.values()){
  const status=[...member.statuses][0];
  if(member.contexts.size!==1)complete=false;
  if(member.statuses.size!==1||!(status in categories)){available=false;continue;}
  counts[status as keyof typeof counts]++;
  categories[status as keyof typeof categories].push(...member.keys);
  if(status==='EXEMPT'){
   const reason=[...member.reasons][0];
   const group=member.reasons.size===1&&(reason==='WORLD_CHAMPION'||reason==='OTHER')?reason:'UNKNOWN';
   exemptions[group].count++;exemptions[group].personKeys.push(...member.keys);
  }
 }
 for(const room of preview.rooms??[]){
  if(room.roomType.trim().toLowerCase()!=='single')continue;
  for(const key of [room.person1Key,room.person2Key].filter(Boolean)){
   const person=byKey.get(key);
   if(person&&person.accommodationRequirement!=='NO_ROOM'&&!person.singleRoomAllocation)available=false;
  }
 }
 return {requested:members.size,counts,exemptions,personKeys:categories,allPersonKeys:[...new Set([...members.values()].flatMap(m=>[...m.keys]))],complete:complete&&available,available};
}
