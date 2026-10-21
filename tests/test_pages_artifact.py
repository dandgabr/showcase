import importlib.util
import shutil
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("prepare_pages", ROOT / "scripts" / "prepare_pages.py")
prepare_pages = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(prepare_pages)


class PagesArtifactTests(unittest.TestCase):
    def test_stages_only_runtime_files_and_required_notices(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "project"
            source.mkdir()
            for relative in prepare_pages.FILES:
                target = source / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(ROOT / relative, target)
            destination = source / "_site"
            prepare_pages.prepare_pages(source, destination)

            files = {path.relative_to(destination).as_posix() for path in destination.rglob("*") if path.is_file()}
            self.assertEqual(
                files,
                {
                    "index.html",
                    "styles.css",
                    "LICENSE",
                    "THIRD-PARTY-NOTICES.md",
                    "src/catalog-cache.mjs",
                    "src/i18n.mjs",
                    "src/main.mjs",
                    "src/site-core.mjs",
                    "assets/lunar-solarpunk-hero.svg",
                },
            )

    def test_rejects_missing_required_runtime_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "project"
            source.mkdir()
            (source / "index.html").write_text("<main></main>", encoding="utf-8")
            with self.assertRaises(FileNotFoundError):
                prepare_pages.prepare_pages(source, source / "_site")

    def test_refuses_and_preserves_destination_outside_project(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "project"
            source.mkdir()
            outside = root / "important"
            outside.mkdir()
            sentinel = outside / "keep.txt"
            sentinel.write_text("preserve", encoding="utf-8")

            with self.assertRaises(ValueError):
                prepare_pages.prepare_pages(source, outside)

            self.assertEqual(sentinel.read_text(encoding="utf-8"), "preserve")


if __name__ == "__main__":
    unittest.main()
