from contextlib import asynccontextmanager
import json
from time import perf_counter
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import httpx

from app import config_store
from app.models import (
    AnalyzeRequest,
    AnalyzeResponse,
    ConfigModel,
    StatusResponse,
    LlmTestResponse,
)
from app.pipeline import run_analysis


@asynccontextmanager
async def lifespan(app: FastAPI):
    config_store.initialize_from_env()
    yield


app = FastAPI(
    title="risu-multiagent",
    description="RisuAI용 멀티 에이전트 RP 분석 파이프라인 (beforeRequest 훅 기반)",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/status", response_model=StatusResponse)
async def status():
    public = config_store.public_status()
    return StatusResponse(
        status="ok",
        version=app.version,
        ready=public["ready"],
        config={
            "default_provider": public["default_provider"],
            "default_base_url": public["default_base_url"],
            "default_model": public["default_model"],
            "default_api_key_set": public["default_api_key_set"],
            "default_temperature": public["default_temperature"],
            "default_max_tokens": public["default_max_tokens"],
            "context_window": public["context_window"],
            "debug_mode": public["debug_mode"],
            "request_timeout": public["request_timeout"],
        },
        agents=public["agents"],
    )


@app.get("/test/llm", response_model=LlmTestResponse)
async def test_llm(agent: str | None = None):
    targets = config_store.AGENTS
    if agent:
        targets = tuple(item for item in targets if item[0] == agent)
        if not targets:
            raise HTTPException(status_code=404, detail=f"알 수 없는 에이전트: {agent}")

    cfg = config_store.load()
    timeout = min(float(cfg.get("request_timeout", 60.0)), 30.0)
    results = []

    async with httpx.AsyncClient(timeout=timeout) as client:
        for name, label in targets:
            agent_cfg = config_store.get_agent_config(name)
            result = await _test_llm_agent(client, name, label, agent_cfg)
            results.append(result)

    return LlmTestResponse(
        success=all(result["success"] for result in results),
        results=results,
    )


@app.get("/config", response_model=ConfigModel)
async def get_config():
    return ConfigModel(**config_store.load())


@app.put("/config", response_model=ConfigModel)
async def put_config(body: ConfigModel):
    config_store.save(body.model_dump())
    return body


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(request: AnalyzeRequest):
    try:
        return await run_analysis(request)
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=502,
            detail=f"LLM API 오류: {e.response.status_code} {e.response.text}",
        )
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"LLM API 연결 실패: {e}")


async def _test_llm_agent(
    client: httpx.AsyncClient,
    name: str,
    label: str,
    agent_cfg: dict,
) -> dict:
    base_url = str(agent_cfg["base_url"]).rstrip("/")
    example_url = f"{base_url}/models"
    started = perf_counter()

    result = {
        "name": name,
        "label": label,
        "provider": agent_cfg["provider"],
        "base_url": agent_cfg["base_url"],
        "example_url": example_url,
        "model": agent_cfg["model"],
        "success": False,
        "status_code": None,
        "latency_ms": None,
        "error": "",
    }

    if not agent_cfg["api_key"]:
        result["error"] = "Credential이 설정되지 않았습니다."
        return result
    if not base_url:
        result["error"] = "Endpoint URL이 설정되지 않았습니다."
        return result

    if _is_vertex_provider(agent_cfg["provider"]):
        result["example_url"] = "service-account-json"
        result["latency_ms"] = int((perf_counter() - started) * 1000)
        try:
            credential = json.loads(agent_cfg["api_key"])
        except json.JSONDecodeError as exc:
            result["error"] = f"Vertex AI 서비스 계정 JSON 파싱 실패: {exc}"
            return result

        missing = [
            key for key in ("type", "project_id", "client_email", "private_key")
            if not credential.get(key)
        ]
        if missing:
            result["error"] = f"Vertex AI 서비스 계정 JSON 필드 누락: {', '.join(missing)}"
            return result

        result["success"] = True
        return result

    try:
        response = await client.get(
            example_url,
            headers={"Authorization": f"Bearer {agent_cfg['api_key']}"},
        )
        result["status_code"] = response.status_code
        result["latency_ms"] = int((perf_counter() - started) * 1000)
        if response.status_code < 400:
            result["success"] = True
        else:
            error_text = response.text[:200]
            result["error"] = f"HTTP {response.status_code}: {error_text}"
    except httpx.RequestError as exc:
        result["latency_ms"] = int((perf_counter() - started) * 1000)
        result["error"] = str(exc)

    return result


def _is_vertex_provider(provider: str) -> bool:
    normalized = provider.strip().lower().replace("_", "-").replace(" ", "-")
    return normalized in {"vertex-ai", "vertex"}
