import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyNativeApparelRuntime} from './verify-native-apparel-runtime.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const dir=path.join(root,'docs/research/rimworld/evidence');
const source=JSON.parse(readFileSync(path.join(dir,'native-apparel-runtime.json'),'utf8'));
verifyNativeApparelRuntime({root});
const mutations=[
 ['unsupported-long-term-claim',(r)=>{r.outcomes.long_term_durability_tested=true;}],
 ['altered-snapshot-cloth',(r)=>{r.snapshots[8].save.cloth[0].count=54;}],
 ['altered-action-ledger',(_r,d)=>{const p=path.join(d,'native-apparel-actions.jsonl');writeFileSync(p,readFileSync(p,'utf8').replace('29920','29921'));}],
 ['altered-png',(_r,d)=>{const p=path.join(d,source.screenshots[0].image),b=readFileSync(p);b[b.length-20]^=1;writeFileSync(p,b);}]
];
const results=[];
for(const [name,mutate] of mutations){
 const sandbox=mkdtempSync(path.join(root,'.local-research/apparel-verifier-tamper-'));
 const d=path.join(sandbox,'docs/research/rimworld/evidence');mkdirSync(path.join(d,'runtime'),{recursive:true});
 const r=structuredClone(source);copyFileSync(path.join(dir,r.actions.file),path.join(d,r.actions.file));
 for(const s of r.screenshots)copyFileSync(path.join(dir,s.image),path.join(d,s.image));
 mutate(r,d);writeFileSync(path.join(d,'native-apparel-runtime.json'),JSON.stringify(r));
 assert.throws(()=>verifyNativeApparelRuntime({root:sandbox}),assert.AssertionError,name);
 results.push({name,rejected:true});
}
console.log(JSON.stringify({ok:true,isolatedMutationsRejected:results.length,results,scope:'Mutated copies only; original evidence and native process untouched.'}));
