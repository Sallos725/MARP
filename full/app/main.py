from contextlib import asynccontextmanager
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
from app.llm_client import LlmConfigError, test_llm as run_llm_test
from app.pipeline import run_analysis


@asynccontextmanager
async def lifespan(app: FastAPI):
    config_store.initialize_from_env()
    yield


app = FastAPI(
    title="risu-multiagent",
    description="RisuAI용 멀티 에이전트 RP 분석 파이프라인 (beforeRequest 훅 기반)",
    version="0.2.2",
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
            "default_extra_body_json_set": public["default_extra_body_json_set"],
            "context_window": public["context_window"],
            "debug_mode": public["debug_mode"],
            "request_timeout": public["request_timeout"],
        },
        agents=public["agents"],
    )


@app.get("/test/llm", response_model=LlmTestResponse)
async def test_llm(agent: str | None = None):
    cfg = config_store.load()
    targets = config_store.active_agents(cfg)
    if agent:
        targets = tuple(item for item in config_store.ALL_AGENTS if item[0] == agent)
        if not targets:
            raise HTTPException(status_code=404, detail=f"알 수 없는 에이전트: {agent}")

    timeout = min(float(cfg.get("request_timeout", 60.0)), 30.0)
    results = []

    for name, label in targets:
        agent_cfg = config_store.get_agent_config(name)
        result = await _test_llm_agent(name, label, agent_cfg, timeout)
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
    except LlmConfigError as e:
        raise HTTPException(status_code=400, detail=f"LLM 설정 오류: {e}")
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=502,
            detail=f"LLM API 오류: {e.response.status_code} {e.response.text[:1000]}",
        )
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"LLM API 연결 실패: {e}")
    except (KeyError, IndexError, TypeError, ValueError) as e:
        raise HTTPException(status_code=502, detail=f"LLM API 응답 파싱 실패: {e}")


async def _test_llm_agent(
    name: str,
    label: str,
    agent_cfg: dict,
    timeout: float,
) -> dict:
    result = await run_llm_test(agent_cfg, timeout)
    return {
        "name": name,
        "label": label,
        **result,
    }
