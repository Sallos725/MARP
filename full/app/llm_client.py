import json
from hashlib import sha256
from time import perf_counter
from time import time

import httpx


ANTHROPIC_VERSION = "2023-06-01"
VERTEX_SCOPE = "https://www.googleapis.com/auth/cloud-platform"
DEFAULT_ANTHROPIC_MAX_TOKENS = 1024

_vertex_token_cache: dict[str, tuple[str, float]] = {}


class LlmConfigError(Exception):
    """Raised when an agent's provider settings cannot be used."""


def normalize_provider(provider: str) -> str:
    return str(provider or "").strip().lower().replace("_", "-").replace(" ", "-")


def is_anthropic_provider(provider: str) -> bool:
    return normalize_provider(provider) in {"anthropic", "claude"}


def is_vertex_provider(provider: str) -> bool:
    return normalize_provider(provider) in {"vertex-ai", "vertex"}


def provider_label(provider: str) -> str:
    if is_anthropic_provider(provider):
        return "anthropic"
    if is_vertex_provider(provider):
        return "vertex-ai"
    return normalize_provider(provider) or "openai-compatible"


async def call_llm(agent_cfg: dict, messages: list[dict], timeout: float) -> str:
    provider = provider_label(agent_cfg.get("provider", ""))
    if provider == "anthropic":
        return await _call_anthropic(agent_cfg, messages, timeout)
    if provider == "vertex-ai":
        return await _call_vertex_openai(agent_cfg, messages, timeout)
    return await _call_openai_compatible(agent_cfg, messages, timeout)


async def test_llm(agent_cfg: dict, timeout: float) -> dict:
    started = perf_counter()
    result = {
        "provider": agent_cfg["provider"],
        "base_url": agent_cfg["base_url"],
        "example_url": example_url(agent_cfg),
        "model": agent_cfg["model"],
        "success": False,
        "status_code": None,
        "latency_ms": None,
        "error": "",
    }

    if not agent_cfg["api_key"]:
        result["error"] = "Credential이 설정되지 않았습니다."
        return result
    if not str(agent_cfg["base_url"]).strip():
        result["error"] = "Endpoint URL이 설정되지 않았습니다."
        return result
    if not str(agent_cfg["model"]).strip():
        result["error"] = "Model이 설정되지 않았습니다."
        return result

    try:
        status_code = await _test_provider_endpoint(agent_cfg, timeout)
        result["status_code"] = status_code
        result["success"] = True
    except httpx.HTTPStatusError as exc:
        result["status_code"] = exc.response.status_code
        result["error"] = f"HTTP {exc.response.status_code}: {exc.response.text[:300]}"
    except (httpx.RequestError, LlmConfigError, KeyError, IndexError, TypeError, ValueError) as exc:
        result["error"] = str(exc)
    finally:
        result["latency_ms"] = int((perf_counter() - started) * 1000)

    return result


def example_url(agent_cfg: dict) -> str:
    base_url = str(agent_cfg.get("base_url") or "").rstrip("/")
    if is_anthropic_provider(agent_cfg.get("provider", "")):
        return f"{base_url}/models/{agent_cfg.get('model') or ''}"
    if is_vertex_provider(agent_cfg.get("provider", "")):
        return f"{base_url}/chat/completions"
    return f"{base_url}/models"


async def _test_provider_endpoint(agent_cfg: dict, timeout: float) -> int:
    if is_anthropic_provider(agent_cfg.get("provider", "")):
        return await _test_anthropic_models_endpoint(agent_cfg, timeout)
    if is_vertex_provider(agent_cfg.get("provider", "")):
        _vertex_access_token(agent_cfg["api_key"])
        return 200
    return await _test_openai_models_endpoint(agent_cfg, timeout)


async def _test_openai_models_endpoint(agent_cfg: dict, timeout: float) -> int:
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.get(
            f"{str(agent_cfg['base_url']).rstrip('/')}/models",
            headers={"Authorization": f"Bearer {agent_cfg['api_key']}"},
        )
        response.raise_for_status()
        return response.status_code


async def _test_anthropic_models_endpoint(agent_cfg: dict, timeout: float) -> int:
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.get(
            f"{str(agent_cfg['base_url']).rstrip('/')}/models/{agent_cfg['model']}",
            headers={
                "x-api-key": agent_cfg["api_key"],
                "anthropic-version": ANTHROPIC_VERSION,
            },
        )
        response.raise_for_status()
        return response.status_code


async def _call_openai_compatible(agent_cfg: dict, messages: list[dict], timeout: float) -> str:
    payload = _openai_payload(agent_cfg, messages)
    headers = {
        "Authorization": f"Bearer {agent_cfg['api_key']}",
        "Content-Type": "application/json",
    }
    return await _post_chat_completions(agent_cfg["base_url"], headers, payload, timeout)


async def _call_vertex_openai(agent_cfg: dict, messages: list[dict], timeout: float) -> str:
    access_token = _vertex_access_token(agent_cfg["api_key"])
    payload = _openai_payload(agent_cfg, messages)
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }
    return await _post_chat_completions(agent_cfg["base_url"], headers, payload, timeout)


async def _post_chat_completions(
    base_url: str,
    headers: dict,
    payload: dict,
    timeout: float,
) -> str:
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            f"{str(base_url).rstrip('/')}/chat/completions",
            headers=headers,
            json=payload,
        )
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"]


async def _call_anthropic(agent_cfg: dict, messages: list[dict], timeout: float) -> str:
    system, anthropic_messages = _anthropic_messages(messages)
    payload = {
        "model": agent_cfg["model"],
        "messages": anthropic_messages,
        "temperature": agent_cfg["temperature"],
        "max_tokens": agent_cfg["max_tokens"] or DEFAULT_ANTHROPIC_MAX_TOKENS,
    }
    if system:
        payload["system"] = system

    headers = {
        "x-api-key": agent_cfg["api_key"],
        "anthropic-version": ANTHROPIC_VERSION,
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            f"{str(agent_cfg['base_url']).rstrip('/')}/messages",
            headers=headers,
            json=payload,
        )
        response.raise_for_status()
        data = response.json()
        return _extract_anthropic_text(data)


def _openai_payload(agent_cfg: dict, messages: list[dict]) -> dict:
    payload = {
        "model": agent_cfg["model"],
        "messages": messages,
        "temperature": agent_cfg["temperature"],
    }
    if agent_cfg["max_tokens"] is not None:
        payload["max_tokens"] = agent_cfg["max_tokens"]
    extra_body = _parse_extra_body_json(agent_cfg.get("extra_body_json", ""))
    return _deep_merge_json(payload, extra_body) if extra_body else payload


def _parse_extra_body_json(value: str) -> dict:
    raw = str(value or "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise LlmConfigError(f"추가 JSON body 파싱 실패: {exc}") from exc
    if not isinstance(parsed, dict):
        raise LlmConfigError("추가 JSON body는 JSON object여야 합니다.")
    return parsed


def _deep_merge_json(base: dict, extra: dict) -> dict:
    merged = dict(base)
    for key, value in extra.items():
        if key == "messages":
            continue
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge_json(merged[key], value)
        else:
            merged[key] = value
    return merged


def _anthropic_messages(messages: list[dict]) -> tuple[str, list[dict]]:
    system_parts = []
    converted = []
    for message in messages:
        role = message.get("role")
        content = str(message.get("content") or "")
        if role == "system":
            if content:
                system_parts.append(content)
        elif role in {"user", "assistant"}:
            converted.append({"role": role, "content": content})

    if not converted:
        raise LlmConfigError("Anthropic 호출에는 user 또는 assistant 메시지가 필요합니다.")
    return "\n\n".join(system_parts), converted


def _extract_anthropic_text(data: dict) -> str:
    parts = []
    for block in data.get("content", []):
        if isinstance(block, dict) and block.get("type") == "text":
            parts.append(str(block.get("text") or ""))
    text = "\n".join(part for part in parts if part).strip()
    if not text:
        raise LlmConfigError("Anthropic 응답에서 text content를 찾을 수 없습니다.")
    return text


def _vertex_access_token(service_account_json: str) -> str:
    credential_text = str(service_account_json or "").strip()
    if not credential_text:
        raise LlmConfigError("Vertex AI service account JSON이 설정되지 않았습니다.")

    cache_key = sha256(credential_text.encode("utf-8")).hexdigest()
    cached = _vertex_token_cache.get(cache_key)
    now = time()
    if cached and cached[1] > now + 60:
        return cached[0]

    try:
        info = json.loads(credential_text)
    except json.JSONDecodeError as exc:
        raise LlmConfigError(f"Vertex AI service account JSON 파싱 실패: {exc}") from exc

    missing = [
        key for key in ("type", "project_id", "client_email", "private_key")
        if not info.get(key)
    ]
    if missing:
        raise LlmConfigError(f"Vertex AI service account JSON 필드 누락: {', '.join(missing)}")

    try:
        from google.auth.transport.requests import Request
        from google.oauth2 import service_account
    except ImportError as exc:
        raise LlmConfigError("Vertex AI 사용에는 google-auth 패키지가 필요합니다.") from exc

    try:
        credentials = service_account.Credentials.from_service_account_info(
            info,
            scopes=[VERTEX_SCOPE],
        )
        credentials.refresh(Request())
    except Exception as exc:
        raise LlmConfigError(f"Vertex AI access token 발급 실패: {exc}") from exc
    expiry = credentials.expiry.timestamp() if credentials.expiry else now + 3300
    if not credentials.token:
        raise LlmConfigError("Vertex AI access token 발급에 실패했습니다.")
    _vertex_token_cache[cache_key] = (credentials.token, expiry)
    return credentials.token
