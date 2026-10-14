import test from 'node:test';
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
