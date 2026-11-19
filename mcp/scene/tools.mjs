import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { queryStructure, structureTool } from './structure.mjs'

export function createSceneTools(outputDir) {
  const root = resolve(process.env.SCENE3D_OUTPUT ?? outputDir)
  const blender = process.env.SCENE3D_BLENDER ?? 'blender'
  const scenes = new Map()
  const num = { type: 'number', minimum: -1000, maximum: 1000 }
  const vec = n => ({ type: 'array', minItems: n, maxItems: n, items: num })
  const id = { type: 'string', pattern: '^[a-z][a-z0-9_-]{0,39}$' }
  const material = { type: 'string', pattern: '^#[a-fA-F0-9]{6}$' }
  const profile = { type: 'array', minItems: 3, maxItems: 64, items: vec(2), description: 'Closed polygon in local Y/Z, not repeating the first point. Extruded along +X.' }
  const partProps = { id, role: { type: 'string', maxLength: 120 }, at: vec(3), span: num, profile, material }
  const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false })
  const part = obj(partProps)
  const change = obj({ ...partProps }, ['id']); delete change.properties.role
  const targets = { type: 'array', minItems: 1, maxItems: 48, items: id }
  const view = { type: 'string', enum: ['oblique', 'front', 'section', 'top'] }
  const tools = [
    structureTool,
    { name: 'scene_create', description: 'Create an editable metric scene from named extruded profiles. X span; profile vertices in local Y,Z (Z up).', inputSchema: obj({ scene: id, parts: { type: 'array', minItems: 1, maxItems: 48, items: part } }), annotations: { destructiveHint: false } },
    { name: 'scene_inspect', description: 'Read selected parts: semantic role, dimensions, world bounds, extrusion length and editable local section coordinates.', inputSchema: obj({ scene: id, revision: {type:'string'}, targets }, ['scene']), annotations: { readOnlyHint: true } },
    { name: 'scene_edit', description: 'Replace only the specified parameters of named parts. Requires the active revision. Returns old/new measurements and the new revision.', inputSchema: obj({ scene: id, base: {type:'string'}, changes: {type:'array', minItems:1,maxItems:48, items:change} }), annotations: { destructiveHint: false } },
    { name: 'scene_preview', description: 'Render selected parts in Blender, optionally comparing with another revision using identical orthographic framing. Section is an end view, not a cutaway.', inputSchema: obj({ scene: id, revision: {type:'string'}, compare: {type:'string'}, targets, view }, ['scene','targets','view']), annotations: { readOnlyHint: true } },
    { name: 'scene_export', description: 'Save an editable Blender .blend of the selected revision. Does not write to Minecraft.', inputSchema: obj({ scene: id, revision: {type:'string'} }, ['scene']), annotations: { destructiveHint: false } },
  ]
  function fail(message) { throw Error(message) }
  function isId(x) { return typeof x === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(x) }
  function numeric(x) { return typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 1000 }
  function validVec(v, n) { return Array.isArray(v) && v.length === n && v.every(numeric) }
  function validPart(p) {
    if (!p || !isId(p.id) || typeof p.role !== 'string' || !p.role.trim() || p.role.length > 120 || !validVec(p.at, 3) || !numeric(p.span) || p.span <= 0 || typeof p.material !== 'string' || !/^#[a-f\d]{6}$/i.test(p.material) || !Array.isArray(p.profile) || p.profile.length < 3 || p.profile.length > 64 || !p.profile.every(k=>validVec(k,2))) fail('invalid part; need id, role, at, positive span, Y/Z profile and #RRGGBB material')
    const poly = p.profile; const area = poly.reduce((s,[y,z],i)=>{const [u,v]=poly[(i+1)%poly.length]; return s+y*v-z*u},0)
    const cross=([a,b],[c,d],[e,f])=>(c-a)*(f-b)-(d-b)*(e-a)
    for (let i=0;i<poly.length;i++) {
      const a=poly[i], b=poly[(i+1)%poly.length]
      if (a[0]===b[0] && a[1]===b[1]) fail('profile contains a repeated edge vertex')
      for (let j=i+2;j<poly.length;j++) {
        if (i===0 && j===poly.length-1) continue
        const c=poly[j], d=poly[(j+1)%poly.length]
        const overlap=k=>Math.max(Math.min(a[k],b[k]),Math.min(c[k],d[k]))<=Math.min(Math.max(a[k],b[k]),Math.max(c[k],d[k]))
        if (overlap(0)&&overlap(1)&&cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0) fail('profile has intersecting edges')
      }
    }
    if (Math.abs(area) < 1e-7) fail('profile has no area')
    return { id:p.id, role:p.role, at:p.at, span:p.span, profile:poly, material:p.material }
  }
  function measure(p) {
    const [x,y,z]=p.at, ys=p.profile.map(v=>v[0]), zs=p.profile.map(v=>v[1]);
    const min=[x,y+Math.min(...ys),z+Math.min(...zs)], max=[x+p.span,y+Math.max(...ys),z+Math.max(...zs)];
    return {...p,bounds:{min,max},size_m:max.map((v,i)=>Number((v-min[i]).toFixed(6)))}
  }
  function revision(s, list) {
    const key=createHash('sha256').update(JSON.stringify(list)).digest('hex');
    if (!s.history.has(key) && s.history.size>=32) fail('prototype revision limit: 32 per scene')
    s.history.set(key,list);s.head=key;return key
  }
  function get(s,key) { const p=s.history.get(key??s.head);if (!p) fail('unknown revision');return p }
  function select(list, ids) {
    if (ids===undefined) return list
    if (!Array.isArray(ids)||ids.length<1||ids.length>48||new Set(ids).size!==ids.length||!ids.every(isId)) fail('invalid targets')
    return ids.map(k=>list.find(p=>p.id===k)??fail(`unknown part ${k}`))
  }
  async function backend(data,name) {
    await mkdir(root,{recursive:true});const path=await mkdtemp(join(root,`${name}-`));const input=join(path,'job.json');await writeFile(input,JSON.stringify(data));
    try {await promisify(execFile)(blender,['--background','--factory-startup','--disable-autoexec','--python-exit-code','1','--python',fileURLToPath(new URL('./blender.py',import.meta.url)),'--',input],{timeout:65000,maxBuffer:2*1024*1024,windowsHide:true})}
    catch(e){fail(`Blender failed: ${e.code??''} ${String(e.stderr||e.message).slice(-1800)}`)}
    return path
  }
  async function call(name,a) {
    if (!isId(a.scene)) fail('invalid scene ID');const s=scenes.get(a.scene)
    if (name==='scene_create') {
      if (s || scenes.size>=16) fail('scene already exists or prototype scene limit reached')
      if (!Array.isArray(a.parts)||a.parts.length<1||a.parts.length>48) fail('need 1–48 parts')
      const list=a.parts.map(validPart);if (new Set(list.map(p=>p.id)).size!==list.length) fail('duplicate part IDs')
      const created={history:new Map()};const key=revision(created,list);scenes.set(a.scene,created);return {revision:key,parts:list.map(measure)}
    }
    if (!s) fail('unknown scene')
    const key=a.revision??s.head, current=get(s,key)
    if (name==='scene_inspect') return {revision:key,parts:select(current,a.targets).map(measure)}
    if (name==='scene_query_structure') return queryStructure(a,current.map(measure),key,async(parts,view,highlighted)=>{
      const path=await backend({parts,base:null,view,highlighted},`${a.scene}-${Date.now()}-structure`)
      const file=join(path,'after.png');return {file,image:await readFile(file)}
    })
    if (name==='scene_edit') {
      if (a.base!==s.head || key!==s.head) fail('revision conflict: inspect the active revision before editing')
      if (!Array.isArray(a.changes)||a.changes.length<1||a.changes.length>48) fail('need 1–48 changes')
      const chosen=new Map();for(const c of a.changes){if(!c||!isId(c.id)||chosen.has(c.id)||Object.keys(c).some(k=>!(k in change.properties)||!Object.hasOwn(change.properties,k)))fail('invalid or duplicate change');chosen.set(c.id,c)}
      select(current,[...chosen.keys()]);const next=current.map(p=>chosen.has(p.id)?validPart({...p,...chosen.get(p.id)}):p);const before=current.filter(p=>chosen.has(p.id)).map(measure),after=next.filter(p=>chosen.has(p.id)).map(measure);return {revision:revision(s,next),before,after}
    }
    if (name==='scene_preview') {
      if (!a.targets || !view.enum.includes(a.view)) fail('need valid targets and view');const parts=select(current,a.targets),base=a.compare?select(get(s,a.compare),a.targets):null
      const path=await backend({parts,base,view:a.view},`${a.scene}-${Date.now()}-preview`);
      const files=base?[join(path,'before.png'),join(path,'after.png')]:[join(path,'after.png')];
      return { value:{files, targets:a.targets, view:a.view, same_framing:!!base}, images:await Promise.all(files.map(f=>readFile(f))) }
    }
    if (name==='scene_export') {
      const path=await backend({parts:current},`${a.scene}-${Date.now()}-export`);return {file:join(path,'scene.blend')}
    }
    fail('unknown tool')
  }
  return tools.map(tool=>({...tool,title:tool.name,run:async args=>{
    const r=await call(tool.name,args), data=r.images?r.value:r
    return {structuredContent:data,content:[{type:'text',text:JSON.stringify(data)},...(r.images??[]).map(b=>({type:'image',mimeType:'image/png',data:b.toString('base64')}))]}
  }}))
}
