"""Build a strict, dependency-free staging directory for GitHub Pages."""

from pathlib import Path
import shutil
import sys


FILES = (
    "index.html",
    "styles.css",
    "LICENSE",
    "THIRD-PARTY-NOTICES.md",
    "src/catalog-cache.mjs",
    "src/i18n.mjs",
    "src/main.mjs",
    "src/site-core.mjs",
    "assets/lunar-solarpunk-hero.svg",
)


def prepare_pages(source_root: Path, destination: Path) -> None:
    source_root = source_root.resolve()
    destination = destination.resolve()
    if destination != source_root / "_site":
        raise ValueError("The Pages staging directory must be the _site directory inside the source root.")

    missing = [relative for relative in FILES if not (source_root / relative).is_file()]
    if missing:
        raise FileNotFoundError(f"Required Pages files are missing: {', '.join(missing)}")

    if destination.exists():
        shutil.rmtree(destination)
    for relative in FILES:
        source = source_root / relative
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    destination = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "_site"
    prepare_pages(root, destination)
    print(f"Prepared {len(FILES)} Pages files in {destination.resolve()}")


if __name__ == "__main__":
    main()
