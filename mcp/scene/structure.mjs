const axis = { type: 'string', enum: ['x','y','z'] }
const metres = { type: 'number', minimum: -3000, maximum: 3000 }
const positive = { ...metres, exclusiveMinimum: 0 }
const tolerance = { type: 'number', minimum: 0, maximum: 1000 }
const id = { type: 'string', pattern: '^[a-z][a-z0-9_-]{0,39}$' }
const ids = (min, max) => ({ type: 'array', minItems: min, maxItems: max, uniqueItems: true, items: id })
const schema = (properties, optional = []) => ({ type: 'object', properties, required: Object.keys(properties).filter(k=>!optional.includes(k)), additionalProperties: false })
const spacing = schema({ type:{const:'spacing'}, axis, targets:ids(2,24), start_m:metres, pitch_m:positive, tolerance_m:tolerance })
const mirror = schema({ type:{const:'mirror'}, axis, targets:ids(2,2), plane_m:metres, tolerance_m:tolerance })
const view = {type:'string', enum:['front','oblique','section','top']}
export const structureTool = {
  name:'scene_query_structure', description:'Read-only: check explicit design rules for named parts and optionally return one focused render. Spacing uses ordered center slots start_m + index * pitch_m. Mirror checks the two complete extruded profiles reflected across an axis plane, plus material. Coordinates are world meters, Z up. Missing IDs are reported, not silently skipped.',
  inputSchema:schema({scene:id, revision:{type:'string'}, rules:{type:'array',minItems:1,maxItems:16,items:{oneOf:[spacing,mirror]}}, preview:view, issue_index:{type:'integer',minimum:0,description:'Zero-based issue to render; defaults to the first one.'}}, ['revision','preview','issue_index']),
  annotations:{readOnlyHint:true,destructiveHint:false},
}

const fail = message => { throw new Error(message) }
const number = (n,min,max) => Number.isFinite(n) && n>=min && n<=max
const delta = n => Math.round(n*1e9)/1e9
const far = (a,b,t) => Math.abs(delta(a-b))>t

function validate(rule, i) {
  const def=rule?.type==='spacing'?spacing:rule?.type==='mirror'?mirror:null
  if (!def || Object.keys(rule).some(k=>!Object.hasOwn(def.properties,k)) || !axis.enum.includes(rule.axis) || !number(rule.tolerance_m,0,1000)) fail(`invalid design rule ${i}`)
  const size=def.properties.targets
  if (!Array.isArray(rule.targets) || rule.targets.length<size.minItems || rule.targets.length>size.maxItems || new Set(rule.targets).size!==rule.targets.length || !rule.targets.every(k=>typeof k==='string' && /^[a-z][a-z0-9_-]{0,39}$/.test(k))) fail(`invalid targets in rule ${i}`)
  if (rule.type==='spacing' && (!number(rule.start_m,-3000,3000) || !number(rule.pitch_m,0,3000) || rule.pitch_m===0)) fail(`invalid spacing in rule ${i}`)
  if (rule.type==='mirror' && !number(rule.plane_m,-3000,3000)) fail(`invalid mirror plane in rule ${i}`)
}

function bounds(parts) {
  return parts.length ? { min:[0,1,2].map(i=>Math.min(...parts.map(p=>p.bounds.min[i]))), max:[0,1,2].map(i=>Math.max(...parts.map(p=>p.bounds.max[i]))) } : null
}

function profileMatches(a,b,ax,plane,tol) {
  if (a.profile.length!==b.profile.length) return false
  const pts = p => p.profile.map(([y,z])=>[y+p.at[1],z+p.at[2]])
  const left=pts(a).map(p=>p.map((v,i)=>ax===i+1?2*plane-v:v)), right=pts(b)
  return right.some((_,start)=>[1,-1].some(dir=>left.every((p,i)=>p.every((v,j)=>!far(v,right[(start+right.length+dir*i)%right.length][j],tol)))))
}

export async function queryStructure(args, parts, revision, render) {
  if (!Array.isArray(args.rules) || !args.rules.length || args.rules.length>16) fail('need 1–16 explicit design rules')
  if (args.preview!==undefined && !view.enum.includes(args.preview)) fail('invalid preview view')
  if (args.issue_index!==undefined && (!args.preview || !Number.isSafeInteger(args.issue_index) || args.issue_index<0)) fail('issue_index requires a preview and a nonnegative integer')
  args.rules.forEach(validate)
  const byId=new Map(parts.map(p=>[p.id,p])), issues=[]
  for (const [rule_index,r] of args.rules.entries()) {
    const ax=axis.enum.indexOf(r.axis), tol=r.tolerance_m
    const report=(type, targets, detail, focusTargets=targets)=>{
      const focus=focusTargets.map(k=>byId.get(k)).filter(Boolean)
      issues.push({type,rule_index,targets,axis:r.axis,bounds_m:bounds(focus),focus:focus.map(p=>p.id),tolerance_m:tol,...detail})
    }
    if (r.type==='spacing') {
      for (const [i,k] of r.targets.entries()) {
        const p=byId.get(k), expected=delta(r.start_m+i*r.pitch_m), context=r.targets.slice(Math.max(0,i-1),i+2)
        if (!p) { report('missing_part',[k],{expected_center_m:expected},context); continue }
        const center=delta((p.bounds.min[ax]+p.bounds.max[ax])/2)
        if (far(center,expected,tol)) report('spacing_offset',[k],{actual_center_m:center,expected_center_m:expected,offset_m:delta(center-expected)},context)
      }
    } else {
      const [a,b]=r.targets.map(k=>byId.get(k));const missing=r.targets.filter(k=>!byId.has(k))
      if (missing.length) {report('missing_part',missing,{mirror_plane_m:r.plane_m},r.targets);continue}
      const min=[...a.bounds.min], max=[...a.bounds.max];min[ax]=delta(2*r.plane_m-a.bounds.max[ax]);max[ax]=delta(2*r.plane_m-a.bounds.min[ax]);
      const mismatch=[]
      if (min.some((v,i)=>far(v,b.bounds.min[i],tol)||far(max[i],b.bounds.max[i],tol))) mismatch.push('bounds')
      if (!profileMatches(a,b,ax,r.plane_m,tol)) mismatch.push('profile')
      if (a.material.toLowerCase()!==b.material.toLowerCase()) mismatch.push('material')
      if (mismatch.length) report('mirror_mismatch',r.targets,{mirror_plane_m:r.plane_m,mismatch,expected_bounds_m:{min,max},actual_bounds_m:b.bounds})
    }
  }
  const value={revision,checked_rules:args.rules.length,issue_count:issues.length,issues}
  if (!args.preview || (!issues.length && args.issue_index===undefined)) return value
  const index=args.issue_index??0
  const issue=issues[index];if (!issue) fail('issue_index is out of range')
  if (!issue.focus.length) return {...value,preview:{issue_index:index,available:false,reason:'no neighboring geometry to render'}}
  const geometry=issue.focus.map(k=>byId.get(k))
  const highlighted=issue.focus.filter(k=>issue.targets.includes(k))
  const out=await render(geometry,args.preview,highlighted)
  return {value:{...value,preview:{issue_index:index,available:true,view:args.preview,targets:issue.focus,highlighted,file:out.file},geometry},images:[out.image]}
}
