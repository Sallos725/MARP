"""Build reproducible release assets from the checked Go and JS sources."""
import hashlib, os, shutil, subprocess, sys, zipfile
from pathlib import Path
root = Path(__file__).resolve().parent.parent
tag = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("GITHUB_REF_NAME", "v0.9.0")
if tag != "v0.9.0":
    raise SystemExit("This release source requires tag v0.9.0")
dist = root / "dist"
dist.mkdir(exist_ok=True)
env = {**os.environ, "GOTOOLCHAIN": "go1.27.1", "CGO_ENABLED": "0", "GOOS": "linux"}
assets = []
for arch in ("amd64", "arm64"):
    binary = dist / f"marp-{tag}-linux-{arch}"
    subprocess.run(["go", "build", "-buildvcs=false", "-trimpath", "-ldflags=-s -w", "-o", str(binary), "./cmd/marp"], cwd=root / "full", env={**env,"GOARCH":arch}, check=True)
    assets.append(binary)
lite = dist / f"multiagent-lite-{tag}.js"
shutil.copyfile(root / "lite/risu-multiagent.js", lite)
assets.append(lite)
archive = dist / f"multiagent-full-{tag}.zip"
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
    files = [root / "full" / n for n in ("go.mod", "go.sum", ".dockerignore", "Dockerfile", "docker-compose.yml", ".env.example", "run.sh")]
    files += sorted((root / "full/cmd").rglob("*.go"))
    files += [p for p in sorted((root / "full/internal").rglob("*")) if p.is_file() and not p.name.endswith("_test.go")]
    def put(p, name):
        info = zipfile.ZipInfo(name, (2026, 9, 12, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = (0o100755 if p.name == "run.sh" or p in assets[:2] else 0o100644) << 16
        z.writestr(info, p.read_bytes())
    for p in files:
        put(p, p.relative_to(root / "full").as_posix())
    put(root / "full/plugin/risu-multiagent-full.js", f"plugin/multiagent-full-{tag}.js")
    for p in assets[:2]:
        put(p, f"bin/{p.name}")
    put(root / "README.md", "README.md")
    put(root / "RELEASE_NOTES.md", "RELEASE_NOTES.md")
    put(root / "MOBILE_TESTING.md", "MOBILE_TESTING.md")
assets.append(archive)
checksums = dist / "SHA256SUMS"
checksums.write_text("".join(f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n" for p in sorted(assets)))
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    names = z.namelist()
    assert "cmd/marp/main.go" in names and "go.mod" in names
    assert not any(n.startswith("app/") or n.endswith(".py") for n in names)
for p in assets + [checksums]:
    print(f"{p.name}: {p.stat().st_size} bytes")
