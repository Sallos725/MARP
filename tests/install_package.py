"""Validate checksums, archive contents and a fresh install using synthetic data."""
import hashlib, json, os, socket, subprocess, sys, tempfile, time, urllib.request, zipfile
from pathlib import Path
dist=Path(sys.argv[1] if len(sys.argv)>1 else "dist").resolve()
for line in (dist/"SHA256SUMS").read_text().splitlines():
    digest,name=line.split(None,1)
    assert hashlib.sha256((dist/name).read_bytes()).hexdigest()==digest,name
for arch,machine in [("amd64",62),("arm64",183)]:
    data=(dist/f"marp-v0.9.7-linux-{arch}").read_bytes()
    assert data[:4]==b"\x7fELF" and int.from_bytes(data[18:20],"little")==machine,arch
with tempfile.TemporaryDirectory(prefix="marp-install-") as tmp:
    root=Path(tmp)
    with zipfile.ZipFile(dist/"multiagent-full-v0.9.7.zip") as z:
        assert z.testzip() is None
        assert all(not Path(n).is_absolute() and ".." not in Path(n).parts for n in z.namelist())
        z.extractall(root)
    assert (root/"plugin/multiagent-full-v0.9.7.js").exists()
    assert not (root/"app").exists()
    for name in ["DIAGNOSTICS", "SETTINGS", "PDF", "DEVELOPMENT"]:
        assert (root/f"guides/{name}.md").exists(), name
    for arch in ["amd64","arm64"]:
        assert (root/f"bin/marp-v0.9.7-linux-{arch}").read_bytes()==(dist/f"marp-v0.9.7-linux-{arch}").read_bytes()
    with socket.socket() as s:
        s.bind(("127.0.0.1",0));port=s.getsockname()[1]
    env={**os.environ,"HOST":"127.0.0.1","PORT":str(port),"CONFIG_PATH":str(root/"data/config.json"),"PRESET_PATH":str(root/"data/presets.json")}
    proc=subprocess.Popen(["sh","run.sh"],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    def request(path,body=None,method=None):
        req=urllib.request.Request(f"http://127.0.0.1:{port}"+path,data=None if body is None else json.dumps(body).encode(),headers={"Content-Type":"application/json"},method=method)
        with urllib.request.urlopen(req,timeout=3) as r:return json.load(r)
    try:
        for _ in range(500):
            if proc.poll() is not None:raise RuntimeError(proc.stderr.read().decode())
            try:
                assert request("/health")=={"status":"ok"};break
            except OSError:time.sleep(.01)
        else:raise RuntimeError("startup timeout")
        cfg=request("/config")
        cfg.update({n+"_enabled":False for n in ["worldbuilding","plot","character"]})
        cfg["default_temperature"]=0
        request("/config",cfg,"PUT")
        result=request("/analyze",{"user_input":"한글 日本語 😀","chat_history":[]})
        assert result["errors"]=={} and not any(result["context_"+k] for k in ["world","plot","char"])
        assert request("/status")["version"]=="0.9.7"
        assert request("/runtime-config")["context_window"]==10
        library=request("/presets",{"name":"설치 확인","pack":{"global":{"model":"fixture"}}})
        assert request("/presets/"+library["presets"][0]["id"])["pack"]["global"]["model"]=="fixture"
        assert json.loads((root/"data/config.json").read_text())["default_temperature"]==0
        binary=root/"bin/marp-v0.9.7-linux-amd64"
        assert subprocess.check_output([str(binary),"--version"],env=env,text=True).strip()=="0.9.7"
        subprocess.run([str(binary),"--healthcheck"],env=env,check=True)
    finally:
        proc.terminate()
        try:proc.wait(timeout=12)
        except subprocess.TimeoutExpired:proc.kill();proc.wait()
        proc.stderr.close()
print("PASS: SHA256, ZIP, amd64/arm64 ELF, run.sh, API, presets and persisted data")
