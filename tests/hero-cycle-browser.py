"""Reproducible Chromium checks for the SVG/fallback hero timeline.

Run from the repository root with:
    python3 tests/hero-cycle-browser.py
Requires Python Playwright and /usr/bin/chromium-browser.
"""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlparse, parse_qs
import functools
import math
import os
import time

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
CHROMIUM = "/usr/bin/chromium-browser"
MARKS = (0, 6, 12, 18, 22, 23, 24, 27, 30, 36, 42, 44, 46, 48)


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def main():
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, executable_path=CHROMIUM)
            page = browser.new_page(viewport={"width": 1440, "height": 900}, reduced_motion="no-preference")
            svg_source = (ROOT / "assets/lunar-solarpunk-hero.svg").read_text()
            svg_requests = []

            def serve_svg(route):
                query = parse_qs(urlparse(route.request.url).query)
                svg_requests.append((query.get("test", [""])[0], route.request.url))
                if query.get("test") in (["fail"], ["fail-active"]):
                    route.fulfill(status=503, body="test failure")
                else:
                    route.fulfill(status=200, content_type="image/svg+xml", body=svg_source)

            page.route("**/assets/lunar-solarpunk-hero.svg*", serve_svg)
            page.goto(base + "/?hero-cycle-browser-test=1", wait_until="networkidle")
            page.wait_for_function("document.querySelector('[data-scene-art]').contentDocument?.documentElement")
            page.wait_for_function("!document.querySelector('[data-scene-art]').hidden")

            read_svg = """(seconds) => {
              const svg = document.querySelector('[data-scene-art]').contentDocument.documentElement;
              const layers = [...svg.querySelectorAll('[data-cycle-layer]')];
              const animations = [...new Set(layers.flatMap(node => node.getAnimations()))];
              animations.forEach(animation => { animation.pause(); animation.currentTime = seconds * 1000; });
              const localCenter = (node, x, y) => {
                const point = new DOMPoint(x, y).matrixTransform(node.getCTM());
                const local = point.matrixTransform(svg.getCTM().inverse());
                return { x: local.x / 1600, y: local.y / 900 };
              };
              const sun = svg.querySelector('#solar-disc');
              const moon = svg.querySelector('#lunar-disc');
              const moonBody = svg.querySelector('#lunar-disc > g > circle');
              const shadow = svg.querySelector('#lunar-shadow');
              const sb = sun.getBBox(), mb = moonBody.getBBox(), sh = shadow.getBBox();
              const sunCenter = localCenter(sun, sb.x + sb.width/2, sb.y + sb.height/2);
              const moonCenter = localCenter(moonBody, mb.x + mb.width/2, mb.y + mb.height/2);
              const shadowCenter = localCenter(shadow, sh.x + sh.width/2, sh.y + sh.height/2);
              const stage = document.querySelector('.garden-frame').getBoundingClientRect();
              const object = document.querySelector('[data-scene-art]').getBoundingClientRect();
              const scale = Math.max(object.width/1600, object.height/900);
              const offsetX = (object.width - 1600*scale)/2, offsetY = (object.height - 900*scale)/2;
              const screen = p => ({x:(object.left + offsetX + p.x*1600*scale - stage.left)/stage.width,
                y:(object.top + offsetY + p.y*900*scale - stage.top)/stage.height});
              return { sun: sunCenter, moon: moonCenter,
                screenSun: screen(sunCenter), screenMoon: screen(moonCenter),
                sunOpacity: Number(getComputedStyle(sun).opacity),
                moonOpacity: Number(getComputedStyle(moon).opacity),
                phase: Math.hypot(shadowCenter.x - moonCenter.x, shadowCenter.y - moonCenter.y) * 1600 / Number(shadow.getAttribute('r')),
                animations: animations.length };
            }"""

            read_fallback = """(seconds) => {
              const fallback = document.querySelector('[data-scene-fallback]');
              fallback.hidden = false;
              fallback.dataset.mode = 'cycle';
              fallback.dataset.running = 'false';
              const layers = [...fallback.querySelectorAll('[data-cycle-layer]')];
              const animations = [...new Set(layers.flatMap(node => node.getAnimations()))];
              animations.forEach(animation => { animation.pause(); animation.currentTime = seconds * 1000; });
              const art = fallback.querySelector('.fallback-artboard').getBoundingClientRect();
              const center = selector => {
                const rect = fallback.querySelector(selector).getBoundingClientRect();
                return { x: (rect.left + rect.width/2 - art.left)/art.width,
                  y: (rect.top + rect.height/2 - art.top)/art.height };
              };
              const stage = document.querySelector('.garden-frame').getBoundingClientRect();
              const screen = selector => {
                const rect = fallback.querySelector(selector).getBoundingClientRect();
                return {x:(rect.left + rect.width/2 - stage.left)/stage.width,
                  y:(rect.top + rect.height/2 - stage.top)/stage.height};
              };
              const moon = fallback.querySelector('.fallback-moon');
              const shadow = fallback.querySelector('.fallback-lunar-shadow');
              const tx = new DOMMatrix(getComputedStyle(shadow).transform).m41;
              return { sun: center('.fallback-sun'), moon: center('.fallback-moon'),
                screenSun: screen('.fallback-sun'), screenMoon: screen('.fallback-moon'),
                sunOpacity: Number(getComputedStyle(fallback.querySelector('.fallback-sun')).opacity),
                moonOpacity: Number(getComputedStyle(moon).opacity),
                phase: Math.abs(tx) / (moon.offsetWidth/2),
                animations: animations.length, artRatio: art.width/art.height };
            }"""

            phase_targets = {0: 0, 6: 0, 12: 0, 18: 0, 22: 0, 23: 0, 24: 0,
                             27: .157, 30: .315, 36: .808, 42: 1.487, 44: 2, 46: 2, 48: 0}
            positions = {
                0: ((.2325,.3756),(.2325,.3544)), 6: ((.3713,.2644),(.2325,.3544)),
                12: ((.51,.2089),(.2325,.3544)), 18: ((.6488,.2644),(.2325,.3544)),
                22: ((.7575,.3533),(.2325,.3544)), 23: ((.7725,.36445),(.2325,.3544)),
                24: ((.7875,.3756),(.2325,.3544)), 27: ((.6488,.7089),(.3019,.2989)),
                30: ((.51,.7778),(.3713,.2433)), 36: ((.3713,.7778),(.51,.1878)),
                42: ((.2325,.7089),(.6488,.2433)), 44: ((.2325,.5978),(.7875,.3544)),
                46: ((.2325,.3756),(.7875,.6878)), 48: ((.2325,.3756),(.2325,.3544)),
            }
            for seconds in MARKS:
                svg = page.evaluate(read_svg, seconds)
                fallback = page.evaluate(read_fallback, seconds)
                check(svg["animations"] >= 4 and fallback["animations"] >= 4, f"missing timeline animations at {seconds}s")
                for body in (svg, fallback):
                    check(abs(body["phase"] - phase_targets[seconds]) < .025, f"lunar shadow offset mismatch at {seconds}s: {body}")
                    if 24 <= seconds < 46:
                        check(body["sunOpacity"] < .01, f"sun remained visible at night {seconds}s")
                    if seconds in (0, 6, 12, 18, 22, 48):
                        check(body["sunOpacity"] > .98, f"sun missing during day at {seconds}s")
                    if seconds >= 27:
                        if seconds < 46:
                            check(body["moonOpacity"] > .98, f"moon did not rise at {seconds}s")
                        else:
                            check(body["moonOpacity"] < .01, f"moon did not set at {seconds}s")
                for body_name in ("sun", "moon"):
                    for axis in ("x", "y"):
                        check(abs(svg[body_name][axis] - fallback[body_name][axis]) < .015,
                              f"SVG/fallback {body_name} {axis} diverge at {seconds}s")
                        for scene in (svg, fallback):
                            expected = positions[seconds][0 if body_name == "sun" else 1][0 if axis == "x" else 1]
                            tolerance = .013 if axis == "x" else .021
                            check(abs(scene[body_name][axis] - expected) < tolerance,
                                  f"{body_name} {axis} misses normative center at {seconds}s: {scene[body_name][axis]} vs {expected}")
                if seconds in (0, 24, 48):
                    check(svg["moonOpacity"] < .01 and fallback["moonOpacity"] < .01,
                          f"new Moon must be invisible at {seconds}s")

            # The cover artboard retains 16:9 under 4:3 and 2:1 crops.
            for width, height in ((800, 600), (1000, 500)):
                page.set_viewport_size({"width": width, "height": height})
                page.evaluate("""({width,height}) => {
                  const frame = document.querySelector('.garden-frame');
                  frame.style.cssText = `position:fixed;inset:auto;left:0;top:0;width:${width}px;height:${height}px;transform:none;border-radius:0;z-index:99999`;
                  document.querySelectorAll('.garden-art').forEach(node => node.style.transform = 'none');
                }""", {"width": width, "height": height})
                page.wait_for_timeout(100)
                ratio = page.locator(".fallback-artboard").evaluate("node => { const r=node.getBoundingClientRect(); return r.width/r.height; }")
                check(abs(ratio - 16/9) < .002, f"fallback artboard distorted at {width}x{height}: {ratio}")
                svg = page.evaluate(read_svg, 36)
                fallback = page.evaluate(read_fallback, 36)
                for body_name in ("sun", "moon"):
                    for axis in ("x", "y"):
                        check(abs(svg[body_name][axis] - fallback[body_name][axis]) < .015,
                              f"cover crop changed {body_name} {axis} at {width}x{height}")
                    for axis in ("x", "y"):
                        check(abs(svg[f"screen{body_name.title()}"][axis] - fallback[f"screen{body_name.title()}"][axis]) < .02,
                              f"rendered cover position differs for {body_name} at {width}x{height}")

            # Sample 16 ms on each side of the important day/night and lunar boundaries.
            for boundary in (0, 22, 24, 44, 46, 48):
                for delta in (-.016, .016):
                    seconds = (boundary + delta) % 48
                    svg = page.evaluate(read_svg, seconds)
                    fallback = page.evaluate(read_fallback, seconds)
                    for body_name in ("sun", "moon"):
                        for axis in ("x", "y"):
                            check(abs(svg[body_name][axis] - fallback[body_name][axis]) < .015,
                                  f"boundary position diverges at {boundary}{delta:+.3f}s")
                        check(abs(svg[f"{body_name}Opacity"] - fallback[f"{body_name}Opacity"]) < .05,
                              f"boundary visibility diverges at {boundary}{delta:+.3f}s")
                    check(abs(svg["phase"] - fallback["phase"]) < .025,
                          f"boundary lunar phase diverges at {boundary}{delta:+.3f}s")

            # Simulate a failed SVG request while paused, then restore the SVG at the same phase.
            page.set_viewport_size({"width": 1440, "height": 900})
            page.evaluate("""() => {
              const obj = document.querySelector('[data-scene-art]');
              const svg = obj.contentDocument.documentElement;
              svg.dataset.mode = 'cycle';
              const animations = [...svg.getAnimations({subtree:true})].filter(a => a.effect?.target?.hasAttribute('data-cycle-layer'));
              animations.forEach(a => { a.pause(); a.currentTime = 30000; });
              obj.dataset.mode = 'cycle';
              obj.dataset.running = 'false';
            }""")
            page.wait_for_timeout(100)  # Let the app's running-frame snapshot observe the requested time.
            page.locator("[data-motion-toggle]").click()
            page.wait_for_function("document.querySelector('[data-motion-toggle]').getAttribute('aria-pressed') === 'true'")
            page.evaluate("""() => new Promise(resolve => {
              const object = document.querySelector('[data-scene-art]');
              object.addEventListener('error', resolve, { once: true });
              object.data = object.data.split('?')[0] + '?test=fail';
              setTimeout(resolve, 5000);
            })""")
            page.wait_for_function("document.querySelector('[data-scene-art]').hidden && !document.querySelector('[data-scene-fallback]').hidden")
            failed_times = page.locator("[data-scene-fallback]").evaluate("node => [...node.getAnimations({subtree:true})].filter(a => a.effect?.target?.hasAttribute('data-cycle-layer')).map(a => a.currentTime)")
            check(abs(failed_times[0] - 30000) < 1, f"paused time lost on SVG failure: {failed_times}")
            check(max(failed_times) - min(failed_times) <= 16, f"fallback animations desynchronized: {failed_times}")
            paused = page.locator("[data-scene-fallback]").evaluate("node => node.dataset.running === 'false' && [...node.getAnimations({subtree:true})].filter(a => a.effect?.target?.hasAttribute('data-cycle-layer')).every(a => a.playState === 'paused')")
            check(paused, "fallback did not preserve paused play state")
            # Fetch the recovered SVG in a same-origin frame, then deliver its load
            # event to the original object. Chromium keeps a failed <object> in its
            # error state when hidden; this isolates and still exercises the app's
            # real load handler and state transfer after a successful 200 response.
            page.evaluate("""async () => {
              const object = document.querySelector('[data-scene-art]');
              const frame = document.createElement('iframe');
              frame.style.cssText = 'position:fixed;left:-10px;top:0;width:1px;height:1px;visibility:hidden;border:0';
              document.body.append(frame);
              await new Promise((resolve, reject) => {
                frame.addEventListener('load', resolve, { once: true });
                frame.addEventListener('error', reject, { once: true });
                frame.src = '/assets/lunar-solarpunk-hero.svg?test=restore';
              });
              object.hidden = false;
              object.style.visibility = 'hidden';
              Object.defineProperty(object, 'contentDocument', { configurable: true, get: () => frame.contentDocument });
              object.dispatchEvent(new Event('load'));
            }""")
            try:
                page.wait_for_function("!document.querySelector('[data-scene-art]').hidden && document.querySelector('[data-scene-fallback]').hidden", timeout=10000)
            except Exception as error:
                raise AssertionError(f"SVG recovery failed; requests={svg_requests}; object={page.locator('[data-scene-art]').evaluate('n => ({data:n.data, loaded:Boolean(n.contentDocument?.documentElement)})')}") from error
            restored_times = page.locator("[data-scene-art]").evaluate("node => [...node.contentDocument.documentElement.getAnimations({subtree:true})].filter(a => a.effect?.target?.hasAttribute('data-cycle-layer')).map(a => a.currentTime)")
            check(abs(restored_times[0] - 30000) < 1, f"paused time lost on SVG recovery: {restored_times}")
            check(max(restored_times) - min(restored_times) <= 16, f"restored SVG animations desynchronized: {restored_times}")
            restored_paused = page.locator("[data-scene-art]").evaluate("node => [...node.contentDocument.documentElement.getAnimations({subtree:true})].filter(a => a.effect?.target?.hasAttribute('data-cycle-layer')).every(a => a.playState === 'paused')")
            check(restored_paused, "SVG recovery did not preserve paused play state")

            # Active failure keeps the timeline running; a live reduced-motion change pauses it.
            page.locator("[data-motion-toggle]").click()
            page.wait_for_function("document.querySelector('[data-motion-toggle]').getAttribute('aria-pressed') === 'false'")
            page.locator("[data-scene-art]").evaluate("""node => {
              [...node.contentDocument.documentElement.getAnimations({subtree:true})]
                .filter(a => a.effect?.target?.hasAttribute('data-cycle-layer'))
                .forEach(a => { a.currentTime = 15000; a.play(); });
            }""")
            page.wait_for_timeout(100)
            page.locator("[data-scene-art]").evaluate("node => node.dispatchEvent(new Event('error'))")
            page.wait_for_function("document.querySelector('[data-scene-art]').hidden && !document.querySelector('[data-scene-fallback]').hidden")
            active_times = page.locator("[data-scene-fallback]").evaluate("node => [...node.getAnimations({subtree:true})].filter(a => a.effect?.target?.hasAttribute('data-cycle-layer')).map(a => a.currentTime)")
            check(abs(active_times[0] - 15000) < 250, f"active time lost on SVG failure: {active_times}")
            check(max(active_times) - min(active_times) <= 16, f"active fallback animations desynchronized: {active_times}")
            active = page.locator("[data-scene-fallback]").evaluate("node => node.dataset.running === 'true' && [...node.getAnimations({subtree:true})].filter(a => a.effect?.target?.hasAttribute('data-cycle-layer')).every(a => a.playState === 'running')")
            check(active, "fallback did not preserve running play state")
            page.wait_for_timeout(100)
            active_progress = page.locator("[data-scene-fallback]").evaluate("node => node.getAnimations({subtree:true}).find(a => a.effect?.target?.hasAttribute('data-cycle-layer')).currentTime")
            check(active_progress > active_times[0] + 20, f"active fallback timeline did not advance: {active_times[0]} → {active_progress}")

            # Recover while active and verify every animation resumes at one phase.
            page.evaluate("""async () => {
              const object = document.querySelector('[data-scene-art]');
              const frame = document.createElement('iframe');
              frame.style.cssText = 'position:fixed;left:-10px;top:0;width:1px;height:1px;visibility:hidden;border:0';
              document.body.append(frame);
              await new Promise((resolve, reject) => {
                frame.addEventListener('load', resolve, { once: true });
                frame.addEventListener('error', reject, { once: true });
                frame.src = '/assets/lunar-solarpunk-hero.svg?test=restore-active';
              });
              object.hidden = false;
              object.style.visibility = 'hidden';
              Object.defineProperty(object, 'contentDocument', { configurable: true, get: () => frame.contentDocument });
              object.dispatchEvent(new Event('load'));
            }""")
            page.wait_for_function("!document.querySelector('[data-scene-art]').hidden && document.querySelector('[data-scene-fallback]').hidden")
            active_restored_times = page.locator("[data-scene-art]").evaluate("node => [...node.contentDocument.documentElement.getAnimations({subtree:true})].filter(a => a.effect?.target?.hasAttribute('data-cycle-layer')).map(a => a.currentTime)")
            check(abs(active_restored_times[0] - active_progress) < 250, f"active time lost on SVG recovery: {active_restored_times}")
            check(max(active_restored_times) - min(active_restored_times) <= 16, f"active SVG animations desynchronized: {active_restored_times}")
            active_restored = page.locator("[data-scene-art]").evaluate("node => [...node.contentDocument.documentElement.getAnimations({subtree:true})].filter(a => a.effect?.target?.hasAttribute('data-cycle-layer')).every(a => a.playState === 'running')")
            check(active_restored, "SVG recovery did not preserve running play state")
            page.wait_for_timeout(100)
            resumed_time = page.locator("[data-scene-art]").evaluate("node => node.contentDocument.documentElement.getAnimations({subtree:true}).find(a => a.effect?.target?.hasAttribute('data-cycle-layer')).currentTime")
            check(resumed_time > active_restored_times[0] + 20, f"restored SVG timeline did not advance: {resumed_time}")

            page.emulate_media(reduced_motion="reduce")
            page.wait_for_function("document.documentElement.dataset.motion === 'reduced'")
            reduced = page.locator("[data-scene-art]").evaluate("node => node.dataset.running === 'false' && [...node.contentDocument.documentElement.getAnimations({subtree:true})].filter(a => a.effect?.target?.hasAttribute('data-cycle-layer')).every(a => a.playState === 'paused')")
            check(reduced, "reduced motion did not pause the SVG timeline")
            reduced_time = page.locator("[data-scene-art]").evaluate("node => node.contentDocument.documentElement.getAnimations({subtree:true}).find(a => a.effect?.target?.hasAttribute('data-cycle-layer')).currentTime")
            page.wait_for_timeout(100)
            frozen_time = page.locator("[data-scene-art]").evaluate("node => node.contentDocument.documentElement.getAnimations({subtree:true}).find(a => a.effect?.target?.hasAttribute('data-cycle-layer')).currentTime")
            check(abs(frozen_time - reduced_time) < 1, f"reduced motion did not freeze the phase: {reduced_time} → {frozen_time}")
            page.evaluate("""() => {
              window.__cycleMotionSnapshot = null;
              window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', event => {
                const svg = document.querySelector('[data-scene-art]').contentDocument.documentElement;
                window.__cycleMotionSnapshot = {
                  clock: performance.now(),
                  times: [...svg.getAnimations({subtree:true})].filter(a => a.effect?.target?.hasAttribute('data-cycle-layer')).map(a => a.currentTime)
                };
              });
            }""")
            # Also carry the reduced phase across SVG→fallback→SVG before resume.
            page.locator("[data-scene-art]").evaluate("node => node.dispatchEvent(new Event('error'))")
            page.wait_for_function("document.querySelector('[data-scene-art]').hidden && !document.querySelector('[data-scene-fallback]').hidden")
            reduced_fallback_times = page.locator("[data-scene-fallback]").evaluate("node => [...node.getAnimations({subtree:true})].filter(a => a.effect?.target?.hasAttribute('data-cycle-layer')).map(a => a.currentTime)")
            check(max(reduced_fallback_times) - min(reduced_fallback_times) <= 16, f"reduced fallback desynchronized: {reduced_fallback_times}")
            check(abs(reduced_fallback_times[0] - frozen_time) <= 16, f"reduced phase changed on fallback: {frozen_time} → {reduced_fallback_times[0]}")
            check(page.locator("[data-scene-fallback]").evaluate("node => [...node.getAnimations({subtree:true})].filter(a => a.effect?.target?.hasAttribute('data-cycle-layer')).every(a => a.playState === 'paused')"), "fallback did not stay paused under reduced motion")
            page.evaluate("""async () => {
              const object = document.querySelector('[data-scene-art]');
              const frame = document.createElement('iframe');
              frame.style.cssText = 'position:fixed;left:-10px;top:0;width:1px;height:1px;visibility:hidden;border:0';
              document.body.append(frame);
              await new Promise((resolve, reject) => {
                frame.addEventListener('load', resolve, { once: true });
                frame.addEventListener('error', reject, { once: true });
                frame.src = '/assets/lunar-solarpunk-hero.svg?test=restore-reduced';
              });
              object.hidden = false;
              object.style.visibility = 'hidden';
              Object.defineProperty(object, 'contentDocument', { configurable: true, get: () => frame.contentDocument });
              object.dispatchEvent(new Event('load'));
            }""")
            page.wait_for_function("!document.querySelector('[data-scene-art]').hidden && document.querySelector('[data-scene-fallback]').hidden")
            reduced_restored_times = page.locator("[data-scene-art]").evaluate("node => [...node.contentDocument.documentElement.getAnimations({subtree:true})].filter(a => a.effect?.target?.hasAttribute('data-cycle-layer')).map(a => a.currentTime)")
            check(max(reduced_restored_times) - min(reduced_restored_times) <= 16, f"reduced restored SVG desynchronized: {reduced_restored_times}")
            check(abs(reduced_restored_times[0] - frozen_time) <= 16, f"reduced phase changed on SVG recovery: {frozen_time} → {reduced_restored_times[0]}")
            check(page.locator("[data-scene-art]").evaluate("node => [...node.contentDocument.documentElement.getAnimations({subtree:true})].filter(a => a.effect?.target?.hasAttribute('data-cycle-layer')).every(a => a.playState === 'paused')"), "SVG did not stay paused under reduced motion")
            page.emulate_media(reduced_motion="no-preference")
            page.wait_for_function("document.documentElement.dataset.motion !== 'reduced'")
            resumed_snapshot = page.evaluate("window.__cycleMotionSnapshot")
            resumed_at = resumed_snapshot["times"][0]
            check(max(resumed_snapshot["times"]) - min(resumed_snapshot["times"]) <= 16,
                  f"reduced-motion resume desynchronized animations: {resumed_snapshot['times']}")
            check(abs(resumed_at - frozen_time) <= 32,
                  f"reduced-motion resume jumped phase: {frozen_time} → {resumed_at}")
            page.wait_for_timeout(100)
            reduce_resumed_time = page.locator("[data-scene-art]").evaluate("node => node.contentDocument.documentElement.getAnimations({subtree:true}).find(a => a.effect?.target?.hasAttribute('data-cycle-layer')).currentTime")
            check(reduce_resumed_time > frozen_time + 20, f"timeline did not resume after reduced motion: {reduce_resumed_time}")
            recovered_queries = {query for query, _url in svg_requests}
            check({"fail", "restore", "restore-active", "restore-reduced"}.issubset(recovered_queries), f"missing simulated 503/200 requests: {svg_requests}")

            browser.close()
            print("OK: Chromium validated day/night keyframes, normative centers, lunar phase offsets, visible 4:3/2:1 crops, paused/active recovery, and reduced-motion pause/resume.")
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
