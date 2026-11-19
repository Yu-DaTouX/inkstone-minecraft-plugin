import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector

job = Path(sys.argv[sys.argv.index('--') + 1])
data = json.loads(job.read_text(encoding='utf8'))
s = bpy.context.scene
for o in list(s.objects):
    bpy.data.objects.remove(o, do_unlink=True)
s.unit_settings.system = 'METRIC'
s.render.engine = 'BLENDER_WORKBENCH'
s.render.resolution_x = 960
s.render.resolution_y = 660
s.render.resolution_percentage = 100
s.render.image_settings.file_format = 'PNG'
s.display.render_aa = '16'
sh = s.display.shading
sh.light = 'STUDIO'
sh.color_type = 'MATERIAL'
sh.show_shadows = True
sh.show_cavity = True
sh.cavity_type = 'BOTH'
sh.curvature_ridge_factor = 0.85
sh.curvature_valley_factor = 0.65
sh.show_specular_highlight = False
sh.background_type = 'WORLD'
s.world.color = (0.19, 0.21, 0.24)
s.view_settings.view_transform = 'Standard'
s.view_settings.exposure = 0.65

parts = bpy.data.collections.new('Editable parts')
s.collection.children.link(parts)
materials = {}

def material(hexcode):
    if hexcode not in materials:
        m = bpy.data.materials.new(hexcode)
        m.diffuse_color = (*(pow(int(hexcode[i:i+2], 16) / 255, 2.2) for i in (1, 3, 5)), 1)
        materials[hexcode] = m
    return materials[hexcode]


def build(listing):
    for old in list(parts.objects):
        mesh = old.data
        bpy.data.objects.remove(old, do_unlink=True)
        bpy.data.meshes.remove(mesh)
    for p in listing:
        poly = p['profile']
        if sum(u[0]*v[1]-v[0]*u[1] for u,v in zip(poly, poly[1:]+poly[:1])) < 0:
            poly = poly[::-1]
        n = len(poly)
        verts = [(x, y, z) for x in (0, p['span']) for y,z in poly]
        faces = [tuple(range(n-1, -1, -1)), tuple(range(n, n*2))]
        faces += [(i, (i+1)%n, (i+1)%n+n, i+n) for i in range(n)]
        mesh = bpy.data.meshes.new(p['id'])
        mesh.from_pydata(verts, [], faces)
        mesh.update()
        ob = bpy.data.objects.new(p['id'], mesh)
        parts.objects.link(ob)
        ob.location = p['at']
        ob['role'] = p['role']
        ob['span_m'] = p['span']
        ob['profile_yz'] = json.dumps(p['profile'])
        highlighted = data.get('highlighted', [])
        color = ('#ED6734' if p['id'] in highlighted else '#8F9D9F') if highlighted else p['material']
        mesh.materials.append(material(color))


def camera(view, listings):
    direction, up = {
        'oblique': ((.73,-1.5,.9), (0,0,1)),
        'front': ((0,-1,0), (0,0,1)),
        'section': ((-1,0,0), (0,0,1)),
        'top': ((0,0,1), (0,1,0)),
    }[view]
    direction = Vector(direction).normalized()
    up = Vector(up)
    right = up.cross(direction).normalized()
    up = direction.cross(right).normalized()
    points = [Vector((x+p['at'][0], y+p['at'][1], z+p['at'][2])) for p in listings for x in (0,p['span']) for y,z in p['profile']]
    ranges = [(min(axis.dot(p) for p in points),max(axis.dot(p) for p in points)) for axis in (right,up,direction)]
    target = sum((axis * ((lo+hi)/2) for axis,(lo,hi) in zip((right,up,direction),ranges)), Vector())
    distance = max(10, ranges[2][1]-ranges[2][0]+5)
    c = bpy.data.cameras.new(view)
    o = bpy.data.objects.new(view, c)
    s.collection.objects.link(o)
    s.camera = o
    o.location = target + direction * distance
    o.rotation_euler = (-direction).to_track_quat('-Z','Y').to_euler()
    c.type = 'ORTHO'
    c.ortho_scale = max(ranges[0][1]-ranges[0][0], (ranges[1][1]-ranges[1][0])*960/660, .1)*1.14
    c.clip_end = max(1000, distance*3)

if 'view' in data:
    camera(data['view'], data['parts']+(data['base'] or []))
    for name, listing in [('before',data['base']),('after',data['parts'])]:
        if listing:
            build(listing)
            s.render.filepath = str(job.with_name(name+'.png'))
            bpy.ops.render.render(write_still=True)
else:
    build(data['parts'])
    camera('oblique',data['parts'])
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                area.spaces.active.region_3d.view_perspective = 'CAMERA'
                area.spaces.active.shading.color_type = 'MATERIAL'
    bpy.ops.wm.save_as_mainfile(filepath=str(job.with_name('scene.blend')),compress=True)
