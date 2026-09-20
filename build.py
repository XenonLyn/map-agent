"""Bundle src/ into a single self-contained HTML page: dist/region-map-agent.html"""
from pathlib import Path

ROOT = Path(__file__).parent
SRC = ROOT / "src"
ORDER = ["core.js", "presets.js", "city.js", "view3d.js", "ui.js"]  # load order matters

js = "\n".join((SRC / f).read_text(encoding="utf-8") for f in ORDER)
assert "</script" not in js, "a source file contains </script>, which would break the inline bundle"
html = (SRC / "template.html").read_text(encoding="utf-8").replace("/*__SCRIPT__*/", js)
out = ROOT / "dist" / "region-map-agent.html"
out.parent.mkdir(exist_ok=True)
out.write_text(html, encoding="utf-8")
print(f"wrote {out} ({out.stat().st_size // 1024} KB)")
