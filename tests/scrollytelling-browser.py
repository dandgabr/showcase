"""Browser checks for native long-scroll chapter navigation.

Run from the repository root with: python3 tests/scrollytelling-browser.py
Requires Python Playwright and /usr/bin/chromium-browser.
"""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import functools

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
CHROMIUM = "/usr/bin/chromium-browser"
CHAPTERS = ("hero", "ecossistema", "laboratorio", "constelacao", "atlas", "sobre")


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
            page.goto(base, wait_until="networkidle")
            page.wait_for_function("document.querySelector('[data-story-progress]')")
            check(page.locator("[data-story-chapter]").count() == len(CHAPTERS), "All six chapters need story metadata")
            check(page.locator(".main-nav a").count() == len(CHAPTERS), "Every chapter should have a native navigation anchor")
            check(page.locator(".main-nav a[aria-current='location']").get_attribute("href") == "#hero", "Hero should be active at page start")
            progress = page.locator("[data-story-progress]")
            check(progress.get_attribute("role") == "progressbar", "Scroll progress needs progressbar semantics")
            check(page.locator(".site-header").evaluate("node => getComputedStyle(node).position") == "sticky", "Chapter navigation should remain sticky")
            check(page.locator("html").evaluate("node => getComputedStyle(node).scrollSnapType") == "none", "Native scroll must not be forced into snapping")

            page.wait_for_function("document.querySelector('[data-scene-art]').contentDocument?.documentElement")
            page.wait_for_function("""() => [...document.querySelector('[data-scene-art]').contentDocument.querySelectorAll('[data-cycle-layer]')]
              .flatMap(node => node.getAnimations()).some(animation => animation.playState === 'running')""")
            page.locator("[data-light-toggle]").click()
            page.wait_for_function("document.documentElement.dataset.motion === 'light'")
            check("mantém o ciclo solar e lunar" in page.locator("[data-light-toggle]").get_attribute("aria-label"), "Light mode should explain that the main cycle remains active")
            check(page.locator("[data-motion-label]").inner_text() == "Pausar", "Pause control should keep its own label while lightweight mode is active")
            light_time = page.locator("[data-scene-art]").evaluate("node => [...node.contentDocument.querySelectorAll('[data-cycle-layer]')].flatMap(el => el.getAnimations()).find(animation => animation.playState === 'running')?.currentTime")
            page.wait_for_timeout(140)
            light_time_after = page.locator("[data-scene-art]").evaluate("node => [...node.contentDocument.querySelectorAll('[data-cycle-layer]')].flatMap(el => el.getAnimations()).find(animation => animation.playState === 'running')?.currentTime")
            check(light_time_after > light_time + 20, "Light mode should keep the main day/night cycle moving")
            check(page.locator("[data-spores]").evaluate("node => node.hidden"), "Light mode should remove the particle canvas workload")
            check(page.locator(".stage-orbit").evaluate_all("nodes => nodes.every(node => node.getAnimations().some(animation => animation.playState === 'running'))"), "Light mode should retain restrained orbit motion")
            page.locator("[data-motion-toggle]").click()
            page.wait_for_function("document.documentElement.dataset.motion === 'paused'")
            check(page.locator("[data-light-toggle]").get_attribute("aria-pressed") == "true", "Pause should preserve the lightweight preference")
            page.locator("[data-motion-toggle]").click()
            page.wait_for_function("document.documentElement.dataset.motion === 'light'")
            check(page.locator("[data-spores]").evaluate("node => node.hidden"), "Resuming from pause should restore lightweight mode")
            check(page.locator("[data-motion-label]").inner_text() == "Pausar", "Resuming lightweight mode should keep the pause control discoverable")
            page.locator("[data-light-toggle]").click()
            page.wait_for_function("document.documentElement.dataset.motion === 'full'")

            page.locator("[data-motion-toggle]").click()
            page.wait_for_function("document.documentElement.dataset.motion === 'paused'")
            paused_cycle = page.locator("[data-scene-art]").evaluate("node => [...node.contentDocument.querySelectorAll('[data-cycle-layer]')].flatMap(el => el.getAnimations()).every(animation => animation.playState === 'paused')")
            check(paused_cycle, "Pause should stop the main day/night cycle")
            check(page.locator(".stage-orbit").evaluate_all("nodes => nodes.every(node => node.getAnimations().every(animation => animation.playState === 'paused'))"), "Pause should stop orbit motion")
            paused_styles = page.locator("[data-story-reveal].is-pending").evaluate_all("nodes => nodes.map(node => [getComputedStyle(node).opacity, getComputedStyle(node).transform])")
            check(paused_styles and all(opacity == "1" and transform == "none" for opacity, transform in paused_styles), "Paused motion should reveal pending chapters without spatial movement")
            page.locator("[data-light-toggle]").click()
            check(page.locator("html").get_attribute("data-motion") == "paused", "Selecting lightweight mode must not cancel an explicit pause")
            check(page.locator("[data-light-toggle]").get_attribute("aria-pressed") == "true", "Lightweight preference should be selectable while paused")
            page.locator("[data-motion-toggle]").click()
            page.wait_for_function("document.documentElement.dataset.motion === 'light'")
            page.locator("[data-motion-toggle]").click()
            page.wait_for_function("document.documentElement.dataset.motion === 'paused'")
            page.locator("[data-light-toggle]").click()
            check(page.locator("html").get_attribute("data-motion") == "paused", "Changing lightweight mode while paused must keep motion paused")
            page.locator("[data-motion-toggle]").click()
            page.wait_for_function("document.documentElement.dataset.motion === 'full'")
            page.locator("[data-theme-choice='lunar']").click()
            check(page.locator(".main-nav a[aria-current='location']").evaluate("node => getComputedStyle(node).color") == "rgb(244, 207, 120)", "Active chapter highlight should remain visible in lunar theme")
            page.locator("[data-theme-choice='dual']").click()

            page.locator(".main-nav a[href='#atlas']").click()
            page.wait_for_function("document.querySelector('.main-nav a[aria-current=location]')?.getAttribute('href') === '#atlas'")
            check(page.evaluate("location.hash") == "#atlas", "Chapter links should preserve native hash navigation")
            check(page.locator(".main-nav a[aria-current='location']").get_attribute("href") == "#atlas", "Active chapter should follow anchor navigation")
            check(int(progress.get_attribute("aria-valuenow")) > 0, "Progress should advance after scrolling")
            page.go_back(wait_until="domcontentloaded")
            page.wait_for_function("location.hash === ''")
            page.go_forward(wait_until="domcontentloaded")
            page.wait_for_function("document.querySelector('.main-nav a[aria-current=location]')?.getAttribute('href') === '#atlas'")

            page.locator(".main-nav a[href='#laboratorio']").focus()
            page.keyboard.press("Enter")
            page.wait_for_function("location.hash === '#laboratorio'")
            page.evaluate("window.scrollTo({top:document.querySelector('#laboratorio').offsetTop, behavior:'instant'})")
            page.wait_for_function("document.querySelector('.main-nav a[aria-current=location]')?.getAttribute('href') === '#laboratorio'")
            check(page.evaluate("location.hash") == "#laboratorio", "Keyboard activation should follow a native chapter anchor")

            page.evaluate("window.scrollTo({top: 0, behavior: 'instant'})")
            page.wait_for_function("document.querySelector('.main-nav a[aria-current=location]')?.getAttribute('href') === '#hero'")
            check(int(progress.get_attribute("aria-valuenow")) == 0, "Returning to the start should reset progress")

            page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
            page.wait_for_timeout(120)
            check(page.locator(".main-nav a[aria-current='location']").get_attribute("href") == "#sobre", "Last chapter should become active at document end")
            check(progress.get_attribute("aria-valuenow") == "100", "Progress should reach 100 at document end")

            for width in (320, 390, 768, 1024, 1440, 1920):
                page.set_viewport_size({"width": width, "height": 900})
                page.wait_for_timeout(60)
                dimensions = page.evaluate("""() => {
                  const wordmark = document.querySelector('.wordmark').getBoundingClientRect();
                  const controls = document.querySelector('.header-controls').getBoundingClientRect();
                  const header = document.querySelector('.site-header').getBoundingClientRect();
                  return {body:document.body.scrollWidth, viewport:innerWidth,
                    headerCollision:wordmark.right > controls.left,
                    controlsOutside:controls.right > header.right};
                }""")
                check(dimensions["body"] <= dimensions["viewport"], f"Horizontal overflow at {width}px: {dimensions}")
                check(not dimensions["headerCollision"] and not dimensions["controlsOutside"], f"Header controls overlap or clip at {width}px: {dimensions}")
            browser.close()

            reduced = playwright.chromium.launch(headless=True, executable_path=CHROMIUM)
            reduced_page = reduced.new_page(viewport={"width": 390, "height": 844}, reduced_motion="no-preference")
            reduced_page.goto(base, wait_until="networkidle")
            reduced_page.emulate_media(reduced_motion="reduce")
            check(reduced_page.locator("[data-story-reveal]").first.evaluate("node => getComputedStyle(node).opacity") == "1", "Reduced motion must keep reveal content visible")
            reduced_styles = reduced_page.locator("[data-story-reveal]").evaluate_all("nodes => nodes.map(node => [getComputedStyle(node).opacity, getComputedStyle(node).transform])")
            check(all(opacity == "1" and transform == "none" for opacity, transform in reduced_styles), "Switching to reduced motion should reveal content without spatial transforms")
            check(reduced_page.locator(".site-header").evaluate("node => getComputedStyle(node).position") == "sticky", "Sticky chapter navigation should work with reduced motion")
            reduced.close()

            no_observer = playwright.chromium.launch(headless=True, executable_path=CHROMIUM)
            fallback_page = no_observer.new_page(viewport={"width": 1024, "height": 768})
            fallback_page.add_init_script("window.IntersectionObserver = undefined")
            fallback_page.goto(base, wait_until="networkidle")
            check(fallback_page.locator("[data-story-reveal].is-pending").count() == 0, "Without IntersectionObserver, reveal content must not remain hidden")
            check(fallback_page.locator("[data-story-reveal]").first.evaluate("node => getComputedStyle(node).opacity") == "1", "Observer fallback should reveal content immediately")
            no_observer.close()

            no_script_browser = playwright.chromium.launch(headless=True, executable_path=CHROMIUM)
            no_script = no_script_browser.new_page(viewport={"width": 1024, "height": 768}, java_script_enabled=False)
            no_script.goto(base, wait_until="load")
            check(no_script.locator("[data-story-reveal]").count() == 0, "Without JavaScript, reveal styles must not hide content")
            check(no_script.locator(".main-nav a[href='#atlas']").get_attribute("href") == "#atlas", "Native chapter anchors should remain available without JavaScript")
            check(no_script.locator(".main-nav [aria-current]").count() == 0, "Without JavaScript, navigation must not claim a false current chapter")
            check(no_script.locator("[data-story-progress]").is_hidden(), "Without JavaScript, progress must not announce a false zero state")
            no_script_browser.close()

            deep_link = playwright.chromium.launch(headless=True, executable_path=CHROMIUM)
            deep_page = deep_link.new_page(viewport={"width": 1280, "height": 800})
            deep_page.goto(base + "#constelacao", wait_until="networkidle")
            deep_page.wait_for_function("document.querySelector('.main-nav a[aria-current=location]')?.getAttribute('href') === '#constelacao'")
            revealed = deep_page.locator("#constelacao [data-story-reveal]").first
            deep_page.wait_for_function("""() => {
              const node = document.querySelector('#constelacao [data-story-reveal]');
              return node && node.classList.contains('is-revealed') && getComputedStyle(node).opacity === '1';
            }""")
            geometry = revealed.evaluate("""node => {
              const rect = node.getBoundingClientRect();
              const header = document.querySelector('.site-header').getBoundingClientRect();
              return {top:rect.top, bottom:rect.bottom, headerBottom:header.bottom, height:innerHeight};
            }""")
            check(geometry["top"] >= geometry["headerBottom"] - 1 and geometry["top"] < geometry["height"], f"Deep-linked revealed chapter must be visible below sticky navigation: {geometry}")
            deep_page.set_viewport_size({"width": 390, "height": 844})
            deep_page.goto(base + "#constelacao", wait_until="networkidle")
            deep_page.wait_for_function("document.querySelector('.main-nav a[aria-current=location]')?.getAttribute('href') === '#constelacao'")
            mobile_geometry = deep_page.locator("#constellation-title").evaluate("""node => {
              const rect = node.getBoundingClientRect();
              const header = document.querySelector('.site-header').getBoundingClientRect();
              return {top:rect.top, bottom:rect.bottom, headerBottom:header.bottom, height:innerHeight};
            }""")
            check(mobile_geometry["top"] >= mobile_geometry["headerBottom"] - 1 and mobile_geometry["top"] < mobile_geometry["height"], f"Mobile deep links must clear the sticky navigation: {mobile_geometry}")
            deep_link.close()
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
