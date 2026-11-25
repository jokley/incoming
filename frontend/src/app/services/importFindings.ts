import type {FisImportPreview,FisImportPreviewPerson,ImportControl,ImportControlKind} from '../types.ts';
import type {ImportSession} from '../data/importSessions.ts';

export interface ImportFinding {
 id:string;code:string;message:string;kind:ImportControlKind;personKeys:string[];
 category:'technical'|'accommodation'|'stay';details?:Record<string,unknown>;source?:string;row?:number;
}
const category=(code:string):ImportFinding['category']=>/STAY|ARRIVAL|DEPARTURE/.test(code)?'stay':/ROOM|ACCOMMODATION|PARTNER/.test(code)?'accommodation':'technical';
const stable=(value:unknown):string=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const versionOf=(details?:Record<string,unknown>)=>details?.sourceVersionId==null?null:String(details.sourceVersionId);

/** Presentation of existing findings only. Errors remain errors, never approval rules. */
export function importFindings(preview:FisImportPreview,control?:ImportControl):ImportFinding[] {
 const result:ImportFinding[]=[],used=new Set<number>(),seen=new Set<string>();
 const people=preview.people??[],rooms=preview.rooms??[];
 for(const [kind,issues] of [['error',preview.errors??[]],['info',preview.warnings??[]]] as const)for(const issue of issues){
  const id=stable([kind,issue]);if(seen.has(id))continue;seen.add(id);
  const d:Record<string,unknown>={...issue.details,...(issue.sourceVersionId!=null?{sourceVersionId:issue.sourceVersionId}:{})};
  const row=Number(d.row??d.rowNumber)||undefined,version=versionOf(d);
  let keys=people.filter(p=>d.personKey!=null&&d.personKey===p.matchKey||(d.personId!=null&&String(p.existingAthleteId)===String(d.personId))).map(p=>p.matchKey!);
  if(!keys.length&&row){
   if(issue.code.startsWith('ROOM_')||version&&rooms.some(r=>r.sourceRows?.some(s=>String(s.versionId)===version&&s.row===row))){
    const relevant=rooms.filter(r=>version?r.sourceRows?.some(s=>String(s.versionId)===version&&s.row===row):r.rowNumber===row);
    keys=relevant.flatMap(r=>[r.person1Key,r.person2Key]).filter((k):k is string=>Boolean(k));
   }else if(!issue.code.startsWith('ROOM_')){
    const relevant=people.filter(p=>version?p.sourceRows?.some(s=>String(s.versionId)===version&&s.row===row):p.rowNumber===row);
    if(relevant.length===1)keys=relevant.map(p=>p.matchKey!);
   }
  }
  const matches=(control?.issues??[]).map((item,index)=>({item,index})).filter(({item,index})=>!used.has(index)&&item.code===issue.code&&
   (row?item.row===row:keys.length?item.personKeys.some(k=>keys.includes(k)):!item.row));
  // A single backend projection can use a friendlier message than its raw issue.
  const projected=matches.length===1?matches[0]:undefined;
  if(projected)used.add(projected.index);
  if(!keys.length&&projected&&!version)keys=projected.item.personKeys;
  result.push({id,code:issue.code,message:issue.message,kind:kind==='error'?'error':projected?.item.kind??'info',
   personKeys:[...new Set(keys)].filter(k=>people.some(p=>p.matchKey===k)),category:category(issue.code),details:d,source:projected?.item.source??undefined,row});
 }
 (control?.issues??[]).forEach((issue,index)=>{
  if(used.has(index)||issue.code==='MULTIPLE_MEMBERSHIPS')return;
  // Already represented raw occurrences must not be counted again via control.
  if(result.some(r=>r.code===issue.code&&(issue.row?r.row===issue.row:issue.personKeys.length?issue.personKeys.every(k=>r.personKeys.includes(k)):!r.row)))return;
  const id=stable(['control',issue]);if(seen.has(id))return;seen.add(id);
  result.push({...issue,id,category:category(issue.code),source:issue.source??undefined,row:issue.row??undefined});
 });
 return result.sort((a,b)=>({error:0,clarification:1,info:2}[a.kind]-{error:0,clarification:1,info:2}[b.kind]));
}

export function sourceFamily(preview:FisImportPreview,versionId:number|string,session?:ImportSession):string {
 return Object.entries(preview.submissionSources??{}).find(([,id])=>String(id)===String(versionId))?.[0]
  ??session?.submissions?.find(s=>s.versionId===String(versionId))?.family??`Quelle ${versionId}`;
}
export const familyLabel=(family:string)=>family==='Snowboard'?'Snowboard (SB)':family==='Freestyle'?'Freestyle/Freeski (FS)':family;
export function personFamilies(person:FisImportPreviewPerson,preview:FisImportPreview){
 return [...new Set([...(person.sourceIdentities??[]).map(i=>i.family),...(person.sourceRows??[]).map(s=>sourceFamily(preview,s.versionId)).filter(s=>!s.startsWith('Quelle '))])];
}
export function findingFamilies(finding:ImportFinding,preview:FisImportPreview,session?:ImportSession){
 const rows=Array.isArray(finding.details?.sourceRows)?finding.details.sourceRows as Array<{versionId:number}>:undefined;
 const ids=rows?.map(r=>r.versionId)??(finding.details?.sourceVersionId!=null?[String(finding.details.sourceVersionId)]:[]);
 return [...new Set(ids.map(id=>sourceFamily(preview,id,session)))].map(familyLabel);
}
export const findingNextStep=(finding:ImportFinding)=>finding.kind==='info'?'Hinweis prüfen; keine zusätzliche Importsperre.':
 finding.kind==='error'?'Angaben mit der Nation klären und korrigierte Excel-Meldung hochladen. Danach erneut prüfen.':
 'Quelldaten und Personendetails prüfen; bei Bedarf eine Rückfrage an die Nation dokumentieren.';

/** Paired evidence exists on shared-person errors; never reconstruct missing facts. */
export function sourceComparison(finding:ImportFinding,preview:FisImportPreview,session?:ImportSession){
 const d=finding.details??{},rows=Array.isArray(d.sourceRows)?d.sourceRows as Array<{versionId:number;row?:number}>:undefined;
 const requirements=Array.isArray(d.requirements)?d.requirements as Array<string|null>:undefined;
 const periods=Array.isArray(d.periods)?d.periods as Array<{arrivalDate?:string|null;departureDate?:string|null}>:undefined;
 if(!rows||(!requirements&&!periods))return [];
 return rows.slice(0,Math.max(requirements?.length??0,periods?.length??0)).map((r,index)=>({
  family:familyLabel(sourceFamily(preview,r.versionId,session)),row:r.row,
  requirement:requirements?.[index]==='NO_ROOM'?'Ausdrücklich kein Zimmer (NO_ROOM)':requirements?.[index]==='REQUIRED'?'Unterkunft benötigt':requirements?.[index]?'Unterkunftsangabe ungeklärt':'Keine Unterkunftsinformation',
  arrival:periods?.[index]?.arrivalDate??'Nicht angegeben',departure:periods?.[index]?.departureDate??'Nicht angegeben',
 }));
}
