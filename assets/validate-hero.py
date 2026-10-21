from pathlib import Path
import xml.etree.ElementTree as ET

svg_path = Path(__file__).with_name('lunar-solarpunk-hero.svg')
root = ET.parse(svg_path).getroot()
assert root.tag.endswith('svg'), 'root must be SVG'
assert root.attrib.get('viewBox') == '0 0 1600 900', 'unexpected viewBox'
ids = {node.attrib.get('id') for node in root.iter()}
for required in {'solar-disc', 'lunar-disc', 'botanical-arches', 'glow-forest', 'landscape'}:
    assert required in ids, f'missing expected artwork group: {required}'
for node in root.iter():
    for key, value in node.attrib.items():
        if key in {'href', '{http://www.w3.org/1999/xlink}href'}:
            assert not value.startswith(('http:', 'https:', '//')), 'external asset reference found'
print(f'OK: {svg_path.name}, responsive viewBox, scene groups present, no external assets')
