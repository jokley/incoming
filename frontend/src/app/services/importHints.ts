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
export const importListFilters:Record<ImportListFilter,string>={all:'Alle Einträge',error:'Importfehler',clarification:'Klärungsbedarf',partner:'Zimmerpartner fehlt oder unklar',noRoom:'No Room',singleRoom:'Einzelzimmer / EZ-Entscheidungen',special:'Sondertarif',stay:'Aufenthaltsabweichungen',stayUnclear:'Aufenthalt nicht prüfbar'};

import type {FisImportPreview,ImportControl,FisImportPreviewPerson} from '../types.ts';
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
