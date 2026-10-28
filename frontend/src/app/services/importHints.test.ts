import test from 'node:test';
import type {FisImportPreview} from '../types.ts';
import assert from 'node:assert/strict';
import { importHintCategories } from './importHints.ts';

test('hint categories preserve the existing count without making Officials a decision', () => {
  const categories = importHintCategories([
    {code:'INFO_OFFICIALS_OVER_BASIS',message:'Officials 9 / 6'},
    {code:'INFO_OFFICIALS_OVER_BASIS',message:'Officials 8 / 6'},
    {code:'QUOTA_SINGLE_ROOMS_EXCEEDED',message:'EZ exceeded'},
    {code:'ROOM_NO_DAY_OVERLAP',message:'Aufenthalt außerhalb des gemeldeten Zeitraums'},
  ]);
  assert.equal(categories.reduce((sum,item)=>sum+item.count,0),4);
  assert.deepEqual(categories[0],{code:'INFO_OFFICIALS_OVER_BASIS',label:'Officials über Basis (informativ)',count:2});
  assert.equal(categories[2].label,'Aufenthalt außerhalb des gemeldeten Zeitraums');
  assert.deepEqual(importHintCategories([]),[]);
});

test('direct filters count people and room rows without treating missing partners as import errors',async()=>{
 const {personMatchesImportFilter,roomMatchesImportFilter}=await import('./importHints.ts');
 const people=[{matchKey:'a',rowNumber:2,accommodationRequirement:'NO_ROOM'},{matchKey:'b',rowNumber:3,accommodationRateCategory:'SPECIAL'}];
 const rooms=[{rowNumber:4,person1Key:'b',roomType:'Double shared'},{rowNumber:5,person1Key:'a',person2Key:'b',roomType:'Double shared'}];
 const preview={people,rooms,errors:[]} as unknown as FisImportPreview;
 assert.equal(preview.people.filter(p=>personMatchesImportFilter(p,'noRoom',preview)).length,1);
 assert.equal(preview.people.filter(p=>personMatchesImportFilter(p,'special',preview)).length,1);
 assert.equal(preview.rooms.filter(r=>roomMatchesImportFilter(r,'partner',preview)).length,1);
 assert.equal(preview.rooms.filter(r=>roomMatchesImportFilter(r,'error',preview)).length,0);
 assert.equal(preview.rooms.filter(r=>roomMatchesImportFilter(r,'noRoom',preview)).length,1);
});


test('entry-only partner clarifications remain accessible without inventing room rows',async()=>{
 const {personMatchesImportFilter}=await import('./importHints.ts');
 const preview={people:[{matchKey:'a'}],rooms:[],errors:[]} as unknown as FisImportPreview;
 const control={issues:[{kind:'clarification',code:'SHARED_PARTNER_NOT_EVIDENCED',personKeys:['a']}]} as unknown as import('../types.ts').ImportControl;
 assert.equal(personMatchesImportFilter(preview.people[0],'clarification',preview,control),true);
 assert.equal(preview.rooms.length,0);
});

test('quota navigation uses exact declared groups and unique officials rather than For_gender contexts',async()=>{
 const {personMatchesQuotaFilter}=await import('./importHints.ts');
 const people=[
  {matchKey:'one',nationCode:'ITA',function:'NSA Coach',quotaDisciplines:['A','B','A'],forGender:'M'},
  {matchKey:'two',nationCode:'ITA',function:'NSA Coach',quotaDisciplines:['B'],forGender:'W'},
  {matchKey:'athlete',nationCode:'ITA',function:'Athlete',quotaDisciplines:['A','B'],athleteQuotaFamilies:['Snowboard'],gender:'W'},
  {matchKey:'foreign',nationCode:'CAN',function:'NSA Coach',quotaDisciplines:['A','B']},
  {matchKey:'unmapped',nationCode:'ITA',function:'NSA Coach',quotaDisciplines:[]},
 ] as FisImportPreview['people'];
 assert.deepEqual(people.filter(p=>personMatchesQuotaFilter(p,{nation:'ITA',role:'officials',group:'A'})).map(p=>p.matchKey),['one']);
 assert.deepEqual(people.filter(p=>personMatchesQuotaFilter(p,{nation:'ITA',role:'officials',group:'B'})).map(p=>p.matchKey),['one','two']);
 assert.deepEqual(people.filter(p=>personMatchesQuotaFilter(p,{nation:'ITA',role:'officials',multipleGroups:true})).map(p=>p.matchKey),['one']);
 assert.deepEqual(people.filter(p=>personMatchesQuotaFilter(p,{nation:'ITA',role:'athletes',family:'Snowboard',gender:'F'})).map(p=>p.matchKey),['athlete']);
 assert.equal(people.filter(p=>personMatchesQuotaFilter(p,null)).length,5);
});

test('competition plausibility links filter the exact roster in the existing person list',async()=>{
 const {personMatchesQuotaFilter}=await import('./importHints.ts');
 const people=[{matchKey:'one',nationCode:'CAN',function:'Athlete'},{matchKey:'two',nationCode:'CAN',function:'Athlete'},{matchKey:'staff',nationCode:'CAN',function:'NSA Coach',quotaDisciplines:['Snowboard Park & Pipe']} ] as FisImportPreview['people'];
 const filter={nation:'CAN',role:'athletes' as const,personKeys:['one','staff'],competition:'Synthetic Big Air'};
 assert.deepEqual(people.filter(p=>personMatchesQuotaFilter(p,filter)).map(p=>p.matchKey),['one']);
});

test('sport summary counts affected competition/gender positions, excluding proved personal titles',async()=>{
 const {sportClarifications}=await import('./importHints.ts');
 const competition=(id:string,name:string,unverifiedAdditional:number)=>({id,name,gender:'M',sportEntries:[{nation:'CAN',unverifiedAdditional}]});
 const control={competitions:[competition('ss','Slopestyle',0),competition('ba','Big Air',1)]} as unknown as import('../types.ts').ImportControl;
 assert.deepEqual(sportClarifications(control).map(row=>row.id),['ba']);
 control.competitions[0].sportEntries![0].unverifiedAdditional=5;
 control.competitions[1].sportEntries![0].unverifiedAdditional=5;
 assert.equal(sportClarifications(control).length,2); // two positions, not ten athletes
 control.competitions.push(control.competitions[0]);
 assert.equal(sportClarifications(control).length,2);
 assert.equal(sportClarifications(control,'GER').length,0);
});

test('officials total cannot turn green because EZ decisions are zero; overlaps alone are not an error',async()=>{
 const {officialsSummary}=await import('./importHints.ts');
 const nation={ezDecisionsOpen:0,officialsInMultipleGroups:1,groups:[{coverageReviewRequired:true,totals:{singleRoomsPending:0}}]} as unknown as import('../types.ts').QuotaOverview['nations'][number];
 assert.deepEqual(officialsSummary(nation,true),{label:'Abdeckung prüfen',tone:'warning'});
 nation.groups[0].coverageReviewRequired=false;
 assert.deepEqual(officialsSummary(nation,true),{label:'OK',tone:'success'});
 nation.ezDecisionsOpen=1;
 assert.equal(officialsSummary(nation,true).label,'Entscheidung offen');
 nation.groups[0].coverageReviewRequired=true;
 assert.equal(officialsSummary(nation,true).label,'Entscheidung offen · Abdeckung prüfen');
 assert.equal(officialsSummary({...nation,ezDecisionsOpen:0},false).tone,'warning');
});
