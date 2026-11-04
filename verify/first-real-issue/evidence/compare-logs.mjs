import fs from 'fs';
const P='/root/.claude/projects/-root-fri-work-fri-jsonl-lint-2-repo/';
const files=[];
(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=d+'/'+e.name;if(e.isDirectory())w(p);else if(p.endsWith('.jsonl'))files.push(p)}})(P);
const calls=new Map(); // id -> {name,file}
const results=new Map();
for(const f of files){for(const l of fs.readFileSync(f,'utf8').split('\n')){if(!l)continue;let r;try{r=JSON.parse(l)}catch{continue}
 const c=r.message?.content; if(!Array.isArray(c))continue;
 for(const b of c){ if(b.type==='tool_use')calls.set(b.id,{name:b.name,file:f.replace(P,''),input:b.input}); if(b.type==='tool_result')results.set(b.tool_use_id,b)}}}
const J='/mnt/project-files/first-real-issue/harness/journal/sessions/';
const rows=new Set(), rowKinds={};
for(const f of fs.readdirSync(J)){for(const l of fs.readFileSync(J+f,'utf8').split('\n')){if(!l)continue;const r=JSON.parse(l);if(r.kind==='tool.call'){rows.add(r.source.ref);rowKinds[r.source.ref]=r.payload?.tool??r.payload?.name}}}
const it=fs.readFileSync('/mnt/project-files/first-real-issue/harness/journal/items/fri-jsonl-lint-2.jsonl','utf8').split('\n').filter(Boolean).map(JSON.parse);
for(const r of it) if(r.kind==='tool.call') rows.add(r.source.ref);
console.log('files',files.length,'calls',calls.size,'rows',rows.size);
const by={};
for(const [id,c] of calls){by[c.file]=by[c.file]||{n:0,missing:[]};by[c.file].n++; if(!rows.has(id)){by[c.file].missing.push([id,c.name,String(results.get(id)?.content).slice(0,150)])}}
console.log(JSON.stringify(by,null,1));
const extra=[...rows].filter(r=>!calls.has(r));console.log('rows w/o call',extra);
const names={};for(const c of calls.values())names[c.name]=(names[c.name]||0)+1;console.log(names);
for(const [id,c] of calls) if(/post_message|request_decision|post_widget|decision|card/i.test(c.name)) console.log('ASKCALL',id,c.name,c.file);
const mine=new Set();
for(const l of fs.readFileSync(J+'50c0c74d-e2c4-4a77-b5c0-f0af0c48ba4b.jsonl','utf8').split('\n')){if(!l)continue;const r=JSON.parse(l);if(r.kind==='tool.call')mine.add(r.source.ref)}
console.log('driver-session tool.call rows',mine.size,'not in logs',[...mine].filter(x=>!calls.has(x)));
const d=JSON.parse; 
for(const l of fs.readFileSync(P+'50c0c74d-e2c4-4a77-b5c0-f0af0c48ba4b.jsonl','utf8').split('\n')){if(!l)continue;const r=d(l);const c=r.message?.content;const t=r.timestamp?.slice(11,19);
 if(r.type==='user'&&typeof c==='string')console.log(t,'PROMPT',c.slice(0,100).replace(/\n/g,' '));
 if(Array.isArray(c))for(const b of c)if(b.type==='tool_use')console.log(t,b.name,b.id,JSON.stringify(b.input).slice(0,110))}
