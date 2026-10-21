from pathlib import Path
import math
import unittest
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
SVG = ROOT / 'assets/lunar-solarpunk-hero.svg'
HTML = ROOT / 'index.html'
CSS = ROOT / 'styles.css'
MAIN = ROOT / 'src/main.mjs'


class HeroCycleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.svg_text = SVG.read_text()
        cls.svg = ET.fromstring(cls.svg_text)
        cls.html = HTML.read_text()
        cls.css = CSS.read_text()
        cls.main = MAIN.read_text()
        cls.ids = {element.attrib.get('id') for element in cls.svg.iter()}

    def test_solar_and_lunar_discs_have_clipped_surface_textures(self):
        self.assertIn('solar-surface-clip', self.ids)
        self.assertIn('lunar-surface-clip', self.ids)
        self.assertIn('solar-texture', self.ids)
        self.assertIn('lunar-shadow', self.ids)
        self.assertNotIn('day-halo', self.ids)
        self.assertNotIn('night-halo', self.ids)
        self.assertNotIn('soft', self.ids)
        self.assertNotIn('M265 365c58-21', self.svg_text, 'sun should not contain the old overlay silhouette')
        crater_group = next(node for node in self.svg.iter() if node.attrib.get('id') == 'lunar-craters')
        self.assertEqual(sum(node.tag.endswith('circle') for node in crater_group), 3)
        self.assertEqual(sum(node.tag.endswith('clipPath') for node in self.svg.iter()), 2)

    def test_phase_offsets_produce_the_documented_illumination(self):
        targets = [(0, 0), (0.157, 0.10), (0.315, 0.20), (0.808, 0.50), (1.487, 0.85), (2, 1)]
        for distance, expected in targets:
            if distance >= 2:
                illuminated = 1
            else:
                overlap = 2 * math.acos(distance / 2) - (distance / 2) * math.sqrt(4 - distance**2)
                illuminated = 1 - overlap / math.pi
            with self.subTest(distance=distance):
                self.assertAlmostEqual(illuminated, expected, delta=0.008)

    def test_lunar_phase_shadow_is_part_of_the_shared_cycle(self):
        shadow = next(node for node in self.svg.iter() if node.attrib.get('id') == 'lunar-shadow')
        self.assertEqual(shadow.attrib.get('data-cycle-layer'), 'night')
        self.assertIn('lunar-shadow-phase', self.svg_text)
        self.assertIn('transform-box: fill-box', self.svg_text)

    def test_svg_cycle_has_equal_halves_and_hides_sun_at_night(self):
        self.assertIn('solar-disc-orbit', self.svg_text)
        self.assertIn('lunar-night-orbit', self.svg_text)
        self.assertIn('solar-disc-visibility', self.svg_text)
        self.assertIn('lunar-disc-visibility', self.svg_text)
        self.assertIn('45.833%', self.svg_text)
        self.assertIn('50%', self.svg_text)
        self.assertIn('95.833%', self.svg_text)

    def test_fallback_has_cover_artboard_and_clipped_cratered_moon(self):
        self.assertIn('fallback-artboard', self.html)
        self.assertIn('fallback-lunar-shadow', self.html)
        self.assertIn('fallback-crater', self.html)
        self.assertIn('fallback-solar-texture', self.html)
        self.assertIn('fallback-artboard', self.css)
        self.assertIn('fallback-lunar-phase', self.css)
        self.assertIn('fallback-sun-orbit', self.css)
        self.assertIn('fallback-moon-orbit', self.css)

    def test_duplicate_stage_orbs_are_removed(self):
        self.assertNotIn('class="stage-sun"', self.html)
        self.assertNotIn('class="stage-moon"', self.html)
        self.assertNotIn('.stage-sun', self.css)
        self.assertNotIn('.stage-moon', self.css)

    def test_scene_replacement_captures_and_restores_time_and_play_state(self):
        self.assertIn('captureHeroSceneState', self.main)
        self.assertIn('replaceHeroScene', self.main)
        self.assertIn('prepareHeroScene', self.main)
        self.assertIn('currentTime', self.main)
        self.assertIn('animation.pause()', self.main)
        self.assertIn('animation.play()', self.main)


if __name__ == '__main__':
    unittest.main()
