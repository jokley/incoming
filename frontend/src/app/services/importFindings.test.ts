import test from 'node:test';
import assert from 'node:assert/strict';
import {importFindings,sourceComparison,findingNextStep,personFamilies} from './importFindings.ts';
import {personMatchesImportFilter} from './importHints.ts';
import type {FisImportPreview,ImportControl} from '../types.ts';

const person=(key:string,rowNumber=2)=>({matchKey:key,firstname:key,lastname:'Official',rowNumber,accommodationRequirement:'REQUIRED',sourceRows:[{versionId:11,version:1,row:rowNumber},{versionId:12,version:2,row:rowNumber}]});
const preview=(extra:object={})=>({people:[person('a'),person('b',3)],rooms:[],errors:[],warnings:[],submissionSources:{Freestyle:11,Snowboard:12},...extra}) as unknown as FisImportPreview;
const control=(issues:object[])=>({issues,people:[],competitions:[]}) as unknown as ImportControl;
const shared=(key='a',code='IMPORT_SHARED_ACCOMMODATION_CONFLICT')=>({code,message:'Explizite Unterkunft widersprüchlich',details:{personKey:key,requirements:['REQUIRED','NO_ROOM'],periods:[{arrivalDate:'2027-03-09',departureDate:'2027-03-15'},{arrivalDate:'2027-03-16',departureDate:'2027-03-21'}],sourceRows:[{versionId:11,row:8},{versionId:12,row:9}]}});

test('raw error and backend projection are one finding; identical duplicate errors do not add counts',()=>{
 const e=shared();const p=preview({errors:[e,structuredClone(e)]});
 const c=control([{code:e.code,kind:'error',message:e.message,personKeys:['a'],source:'Bestehende Bewertung',row:null}]);
 const before=JSON.stringify({p,c});const findings=importFindings(p,c);
 assert.equal(findings.length,1);assert.equal(findings[0].kind,'error');assert.deepEqual(findings[0].personKeys,['a']);
 assert.equal(JSON.stringify({p,c}),before);
});
test('same code on distinct people or different facts remains distinct',()=>{
 const findings=importFindings(preview({errors:[shared(),shared('b'),{...shared(),details:{...shared().details,fields:['roomType']}}]}));
 assert.equal(findings.length,3);
});
test('95-person AUT-shaped review keeps seven blockers, four housing contradictions and one disjoint stay',()=>{
 const errors=[...Array.from({length:4},(_,i)=>shared(`p${i}`)),shared('p4','IMPORT_SHARED_STAY_SECTIONS'),{code:'ROOM_PERSON_NOT_FOUND',message:'Room row 1',details:{row:99}},{code:'ROOM_PERSON_NOT_FOUND',message:'Room row 2',details:{row:100}}];
 const p=preview({people:Array.from({length:95},(_,i)=>person(`p${i}`,i+2)),errors});
 const findings=importFindings(p);
 assert.equal(findings.filter(f=>f.kind==='error').length,7);
 assert.equal(findings.filter(f=>f.code==='IMPORT_SHARED_ACCOMMODATION_CONFLICT').length,4);
 assert.equal(findings.filter(f=>f.code==='IMPORT_SHARED_STAY_SECTIONS').length,1);
 assert.equal(p.people.filter(p=>personMatchesImportFilter(p,'error',preview({people:[p],errors}),undefined)).length,5);
});
test('source comparison uses stored order and actual source families without filling gaps',()=>{
 const p=preview({errors:[shared('a','IMPORT_SHARED_STAY_SECTIONS')]});const f=importFindings(p)[0];
 const rows=sourceComparison(f,p);
 assert.equal(rows[0].family,'Freestyle/Freeski (FS)');assert.equal(rows[1].family,'Snowboard (SB)');
 assert.equal(rows[0].departure,'2027-03-15');assert.equal(rows[1].arrival,'2027-03-16');
 assert.match(rows[1].requirement,/NO_ROOM/);assert.match(findingNextStep(f),/Excel/);
});
test('informative warnings stay informative; backend clarification is preserved',()=>{
 const p=preview({warnings:[{code:'INFO_OFFICIALS_OVER_BASIS',message:'Informativ'}]});
 const c=control([{code:'SHARED_PARTNER_NOT_EVIDENCED',kind:'clarification',message:'Partner fehlt',personKeys:['a']}]);
 const f=importFindings(p,c);assert.deepEqual(f.map(f=>f.kind),['clarification','info']);
 assert.equal(personMatchesImportFilter(p.people[0],'error',p,c),false);
 assert.equal(personMatchesImportFilter(p.people[0],'housing',p,c),true);
});
test('ambiguous entry row numbers never guess a person; a source version can disambiguate',()=>{
 const p=preview({people:[{...person('a'),sourceRows:[{versionId:11,row:2}]},{...person('b'),sourceRows:[{versionId:12,row:2}]}],errors:[{code:'ENTRY_INVALID',message:'Bad row',details:{row:2}}]});
 assert.deepEqual(importFindings(p)[0].personKeys,[]);
 p.errors[0].sourceVersionId=12;assert.deepEqual(importFindings(p)[0].personKeys,['b']);
});
test('shared-family filter uses source evidence, not multiple competitions; missing housing is never NO_ROOM',()=>{
 const p=preview();assert.deepEqual(personFamilies(p.people[0],p),['Freestyle','Snowboard']);
 assert.equal(personMatchesImportFilter(p.people[0],'shared',p),true);
 assert.equal(personMatchesImportFilter(p.people[0],'withoutRoom',p),true);
 assert.equal(personMatchesImportFilter(p.people[0],'noRoom',p),false);
 p.people[0].sourceRows=[{versionId:11,version:1,row:2}];assert.equal(personMatchesImportFilter(p.people[0],'shared',p),false);
});
