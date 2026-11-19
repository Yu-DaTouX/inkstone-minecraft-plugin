import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const render=process.env.SCENE3D_TEST_RENDER==='1'
const child=spawn(process.execPath,[fileURLToPath(new URL('../mcp/server.ts',import.meta.url))],{stdio:['pipe','pipe','inherit'],env:{...process.env,INKSTONE_MC_DATA:resolve('scene-test-output/mcp-data')}})
const lines=createInterface({input:child.stdout})[Symbol.asyncIterator]()
const scene='test-facade';let id=0
const rpc=async(method,params)=>{
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:++id,method,params})+'\n')
  const {value,done}=await lines.next();assert(!done,'MCP closed unexpectedly')
  const r=JSON.parse(value);assert.equal(r.id,id);assert(!r.error,JSON.stringify(r.error));return r.result
}
const raw=(name,args)=>rpc('tools/call',{name,arguments:{scene,...args}})
const call=async(name,args)=>{const r=await raw(name,args);assert(!r.isError,r.content[0].text);return r}
const output=resolve(process.env.SCENE3D_OUTPUT??'scene-test-output');const shape=[[0,0],[.22,0],[.22,.82],[0,.82]]
const bracket=[[0,0],[.4,0],[.4,.3],[.16,.3],[.16,.48],[0,.48]]
const window=(id,x)=>({id,role:'窗套',at:[x-.42,0,1.5],span:.84,profile:shape,material:'#BBA77C'})
const eave=(id,x,poly)=>({id,role:'檐口端饰',at:[x,.08,3],span:.6,profile:poly,material:'#C9994E'})
const left=eave('west-eave',-3.8,bracket),right=eave('east-eave',3.2,[[0,0],[.4,0],[.4,.48],[.24,.48],[.24,.26],[0,.26]])
const windows=[window('window-1',-3),window('window-2',-1),window('window-3',1.35),window('window-4',3)]
const spacing={type:'spacing',axis:'x',targets:windows.map(p=>p.id),start_m:-3,pitch_m:2,tolerance_m:.05}
const mirror={type:'mirror',axis:'x',plane_m:0,tolerance_m:.01,targets:[left.id,right.id]}
const rules=[spacing,mirror]
try {
  const init=await rpc('initialize',{protocolVersion:'2025-06-18'});assert.equal(init.serverInfo.name,'inkstone-minecraft');const names=(await rpc('tools/list',{})).tools.map(t=>t.name);assert(names.includes('scene_query_structure')&&names.includes('mc_world'));assert.equal(new Set(names).size,names.length)
  const parts=[...windows,left,right];const base=(await call('scene_create',{parts})).structuredContent.revision
  const faulty=await call('scene_query_structure',{rules,...(render?{preview:'oblique'}:{})});const report=faulty.structuredContent
  assert.equal(report.revision,base);assert.equal(report.issue_count,2)
  assert.equal(report.issues[0].offset_m,.35);assert.deepEqual(report.issues[0].targets,['window-3'])
  assert.equal(report.issues[1].type,'mirror_mismatch');assert.deepEqual(report.issues[1].mismatch,['profile'])
  let mirrorPreview, compare
  if (render) {
  assert.deepEqual(report.preview.targets,['window-2','window-3','window-4']);assert.deepEqual(report.preview.highlighted,['window-3'])
  assert.deepEqual(report.geometry.map(p=>p.id),report.preview.targets)
  assert.equal(faulty.content[1].mimeType,'image/png');assert.equal(Buffer.from(faulty.content[1].data,'base64').subarray(1,4).toString(),'PNG')
  const details=(await call('scene_query_structure',{rules,preview:'oblique',issue_index:1})).structuredContent
  assert.deepEqual(details.preview.targets,[left.id,right.id]);assert.deepEqual(details.geometry[1].profile,right.profile)
  mirrorPreview=details.preview
  }
  const bad=await raw('scene_query_structure',{rules:[{...spacing,pitch_m:-1}]});assert(bad.isError)
  assert((await raw('scene_query_structure',{rules,preview:'front',issue_index:9})).isError)
  const missing=(await call('scene_query_structure',{rules:[{...spacing,targets:['not-built','also-missing']}],preview:'front'})).structuredContent
  assert.equal(missing.issue_count,2);assert.equal(missing.issues[0].type,'missing_part');assert.equal(missing.preview.available,false)
  const current=(await call('scene_inspect',{})).structuredContent;assert.equal(current.revision,base)
  const edit=(await call('scene_edit',{base:report.revision,changes:[{id:'window-3',at:window('window-3',1).at},{id:right.id,profile:[...bracket.slice(2),...bracket.slice(0,2)].reverse()}]})).structuredContent
  const after=(await call('scene_query_structure',{rules,preview:'front'})).structuredContent
  assert.equal(after.issue_count,0);assert.equal(after.revision,edit.revision);assert(!after.preview)
  assert.equal((await call('scene_query_structure',{rules,revision:base})).structuredContent.issue_count,2)
  if (render) {
    compare=(await call('scene_preview',{compare:base,view:'oblique',targets:windows.map(p=>p.id)})).structuredContent.files
    const file=(await call('scene_export',{})).structuredContent.file
    assert((await (await import('node:fs/promises')).stat(file)).size>0)
  }
  const unchanged=(await call('scene_inspect',{targets:['window-1','window-2','window-4','west-eave']})).structuredContent.parts
  assert.deepEqual(unchanged.map(({bounds,size_m,...p})=>p),[windows[0],windows[1],windows[3],left])
  await mkdir(output,{recursive:true});await writeFile(join(output,'structure-validation.json'),JSON.stringify({report,mirrorPreview,after,compare},null,2))
  console.log('PASS: spacing + same-bounds profile mismatch; focused images and geometry; missing parts; invalid inputs; historical revision; targeted repair 2 → 0, untouched parts identical')
} finally {child.stdin.end();child.kill()}
