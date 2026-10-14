import test from 'node:test';
import assert from 'node:assert/strict';
import { personFunctionOptions, matchesPersonFunction } from './personFunctions.ts';

test('all accommodation functions are available and default filter includes staff',()=>{
  const composition: Record<string,number> = {Athlete:22,'NSA Coach':12,'NSA Guest':10,'NSA Professional':8,'NSA Medical':6,'NSA Media':2,'NSA President':1};
  const people=Object.entries(composition).flatMap(([role,count])=>Array.from({length:count},(_,i)=>({id:`${role}-${i}`,function:role})));
  assert.equal(people.filter(p=>matchesPersonFunction(p,'')).length,61);
  const options=personFunctionOptions([...people,people[22]]);
  assert.equal(options.reduce((sum,option)=>sum+option.count,0),61);
  for (const [role,count] of Object.entries(composition)) {
    assert.equal(options.find(option=>option.value===role)?.count,count);
    assert.equal(people.filter(p=>matchesPersonFunction(p,role)).length,count);
  }
});
