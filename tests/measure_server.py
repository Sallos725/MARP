import json, os, socket, subprocess, tempfile, time, urllib.request
from pathlib import Path
root = Path(__file__).resolve().parent.parent
def measure(command, cwd):
    with tempfile.TemporaryDirectory(prefix="marp-perf-") as data:
        with socket.socket() as s:
            s.bind(("127.0.0.1",0))
            port=s.getsockname()[1]
        config=Path(data)/"config.json"
        config.write_text(json.dumps(json.loads((root/"tests/fixtures/v0.8.4.json").read_text())["/config"]))
        env={**os.environ,"CONFIG_PATH":str(config),"PRESET_PATH":str(Path(data)/"presets.json"),"HOST":"127.0.0.1","PORT":str(port)}
        command=[part.replace("{port}",str(port)) for part in command]
        start=time.perf_counter()
        proc=subprocess.Popen(command,cwd=cwd,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        try:
            for i in range(1000):
                if proc.poll() is not None:
                    raise RuntimeError(proc.stderr.read().decode())
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}/health",timeout=.2) as r:
                        assert json.load(r)=={"status":"ok"}
                    break
                except OSError:
                    time.sleep(.01)
            else:
                raise RuntimeError("startup timeout")
            elapsed=(time.perf_counter()-start)*1000
            status=Path(f"/proc/{proc.pid}/status").read_text()
            rss=int(next(line.split()[1] for line in status.splitlines() if line.startswith("VmRSS:")))*1024
            return {"startup_ms":round(elapsed,2),"idle_rss_bytes":rss}
        finally:
            proc.terminate()
            try:proc.wait(timeout=12)
            except subprocess.TimeoutExpired:proc.kill();proc.wait()
            proc.stderr.close()
version=json.loads((root/"package.json").read_text())["version"]
binary=root/f"dist/marp-v{version}-linux-amd64"
assert subprocess.check_output([str(binary),"--version"],text=True).strip()==version
results={"go":measure([str(binary)],root/"full")}
if os.environ.get("MARP_BASELINE_PYTHON"):
    results["python_v0.8.4"]=measure([os.environ["MARP_BASELINE_PYTHON"],"-m","uvicorn","app.main:app","--host","127.0.0.1","--port","{port}"],root/"tests/legacy-python")
assert results["go"]["idle_rss_bytes"]<=48*1024*1024,results
print(json.dumps(results,indent=2))
Path("/tmp/marp-server-metrics.json").write_text(json.dumps(results,indent=2)+"\n")
