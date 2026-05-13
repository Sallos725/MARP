from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import httpx

from app import config_store
from app.models import GenerateRequest, GenerateResponse, ConfigModel, StatusResponse
from app.pipeline import run_pipeline


@asynccontextmanager
async def lifespan(app: FastAPI):
    config_store.initialize_from_env()
    yield


app = FastAPI(
    title="risu-multiagent",
    description="RisuAI용 멀티 에이전트 RP 파이프라인",
    version="0.1.0",
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
            "default_base_url": public["default_base_url"],
            "default_model": public["default_model"],
            "default_api_key_set": public["default_api_key_set"],
            "context_window": public["context_window"],
            "debug_mode": public["debug_mode"],
            "request_timeout": public["request_timeout"],
        },
        agents=public["agents"],
    )


@app.get("/config", response_model=ConfigModel)
async def get_config():
    return ConfigModel(**config_store.load())


@app.put("/config", response_model=ConfigModel)
async def put_config(body: ConfigModel):
    config_store.save(body.model_dump())
    return body


@app.post("/generate", response_model=GenerateResponse)
async def generate(request: GenerateRequest):
    try:
        return await run_pipeline(request)
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=502,
            detail=f"LLM API 오류: {e.response.status_code} {e.response.text}",
        )
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"LLM API 연결 실패: {e}")
