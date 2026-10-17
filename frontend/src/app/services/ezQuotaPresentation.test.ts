import test from 'node:test';
import assert from 'node:assert/strict';
import {ezQuotaLabel,ezQuotaTooltip,ezQuotaTooltipStyle,ezQuotaReason} from './ezQuotaPresentation.ts';
test('operator wording describes only quota and surcharge evaluation',()=>{
 assert.equal(ezQuotaLabel,'Auf EZ-Quote anrechnen');
 assert.equal(ezQuotaTooltip,'Bestimmt ausschließlich die EZ-Quoten- und Mehrpreisbewertung. Zimmerart und tatsächliche Belegung bleiben unverändert.');
});
test('secondary explanations use current room/request/approval context',()=>{
 assert.equal(ezQuotaReason(true,1,[{}]),'Automatisch: EZ-Zimmer');
 assert.equal(ezQuotaReason(true,2,[{roomType:'Single'}]),'Automatisch: EZ-Wunsch');
 assert.equal(ezQuotaReason(true,2,[{single_room_status:'APPROVED_EXTRA'}]),'Automatisch: genehmigte Ausnahme');
 assert.equal(ezQuotaReason(false,2,[{}]),undefined);
 assert.equal(ezQuotaReason(true,2,[{},{}]),undefined);
 assert.equal(ezQuotaReason(true,2,[{}]),undefined);
});
test('confirmed manual override takes precedence for either switch position',()=>{
 assert.equal(ezQuotaReason(false,1,[{}],false),'Manuell geändert');
 assert.equal(ezQuotaReason(true,2,[{roomType:'Single'}],true),'Manuell geändert');
 assert.equal(ezQuotaReason(true,1,[{}],false),'Automatisch: EZ-Zimmer');
});
test('tooltip uses explicit light-mode-safe colors with at least 7:1 text contrast',()=>{
 const luminance=(hex:string)=>{const c=hex.slice(1).match(/../g)!.map(n=>parseInt(n,16)/255).map(n=>n<=0.04045 ? n/12.92 : ((n+0.055)/1.055)**2.4);return c[0]*0.2126+c[1]*0.7152+c[2]*0.0722;};
 const ratio=(luminance(ezQuotaTooltipStyle.color)+0.05)/(luminance(ezQuotaTooltipStyle.backgroundColor)+0.05);
 assert.ok(ratio>=7,`${ratio}:1`);
 assert.equal(ezQuotaTooltipStyle.color,'#ffffff');
 assert.match(ezQuotaTooltipStyle.border,/1px solid/);assert.match(ezQuotaTooltipStyle.boxShadow,/rgba/);
});
