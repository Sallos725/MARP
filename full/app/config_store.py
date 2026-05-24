"""
JSON 파일 기반 설정 저장소.
.env는 첫 실행 시 초기값으로만 사용하고, 이후 변경은 config.json에 저장된다.
"""

import json
import os
from pathlib import Path
from threading import Lock

CONFIG_PATH = Path(os.getenv("CONFIG_PATH", "data/config.json"))
_lock = Lock()

DEFAULTS: dict = {
    "pipeline_mode":          "classic",
    "default_provider":       "openai",
    "default_base_url":       "https://api.openai.com/v1",
    "default_api_key":        "",
    "default_model":          "gpt-4o-mini",
    "default_temperature":    0.7,
    "default_max_tokens":     None,
    "default_extra_body_json": "",
    "worldbuilding_enabled": True,
    "worldbuilding_provider": "",
    "worldbuilding_base_url": "",
    "worldbuilding_api_key":  "",
    "worldbuilding_model":    "",
    "worldbuilding_temperature": None,
    "worldbuilding_max_tokens":  None,
    "worldbuilding_extra_body_json": "",
    "worldbuilding_system_prompt": "",
    "worldbuilding_user_prompt_template": "",
    "plot_enabled": True,
    "plot_provider":          "",
    "plot_base_url":          "",
    "plot_api_key":           "",
    "plot_model":             "",
    "plot_temperature":       None,
    "plot_max_tokens":        None,
    "plot_extra_body_json":    "",
    "plot_system_prompt":     "",
    "plot_user_prompt_template": "",
    "character_enabled": True,
    "character_provider":     "",
    "character_base_url":     "",
    "character_api_key":      "",
    "character_model":        "",
    "character_temperature":  None,
    "character_max_tokens":   None,
    "character_extra_body_json": "",
    "character_system_prompt": "",
    "character_user_prompt_template": "",
    "context_window":         10,
    "debug_mode":             False,
    "request_timeout":        60.0,
    "strict_mode":            False,
    "injection_position":     "system-end",
    "injection_format":       "classic",
    "analysis_language":      "auto",
}

AGENTS: tuple[tuple[str, str], ...] = (
    ("worldbuilding", "세계관 에이전트"),
    ("plot", "플롯 에이전트"),
    ("character", "등장인물 에이전트"),
)

PIPELINE_MODES = {"classic", "ensemble-director", "deep-ensemble"}


def normalize_pipeline_mode(value: str | None) -> str:
    mode = str(value or "").strip().lower().replace("_", "-").replace(" ", "-")
    return mode if mode in PIPELINE_MODES else "classic"


def agent_enabled(agent_name: str, cfg: dict | None = None) -> bool:
    current = cfg or load()
    return bool(current.get(f"{agent_name.lower()}_enabled", True))


def active_agents(cfg: dict | None = None) -> tuple[tuple[str, str], ...]:
    current = cfg or load()
    return tuple(
        (name, label)
        for name, label in AGENTS
        if agent_enabled(name, current)
    )


def load() -> dict:
    if CONFIG_PATH.exists():
        with _lock:
            text = CONFIG_PATH.read_text(encoding="utf-8")
        raw = json.loads(text)
        # Drop legacy keys (e.g. reviewer_*) that are no longer in DEFAULTS.
        filtered = {key: value for key, value in raw.items() if key in DEFAULTS}
        return {**DEFAULTS, **filtered}
    return dict(DEFAULTS)


def save(data: dict) -> None:
    merged = {**DEFAULTS, **{key: value for key, value in data.items() if key in DEFAULTS}}
    merged["pipeline_mode"] = normalize_pipeline_mode(merged.get("pipeline_mode"))
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _lock:
        CONFIG_PATH.write_text(
            json.dumps(merged, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )


def initialize_from_env() -> None:
    """첫 실행 시 .env/환경변수 값으로 config.json 초기화."""
    if CONFIG_PATH.exists():
        return
    try:
        from app.config import get_settings
        s = get_settings()
        save({
            "pipeline_mode":          normalize_pipeline_mode(getattr(s, "pipeline_mode", "classic")),
            "default_provider":       s.default_provider,
            "default_base_url":       s.default_base_url,
            "default_api_key":        s.default_api_key,
            "default_model":          s.default_model,
            "default_temperature":    s.default_temperature,
            "default_max_tokens":     s.default_max_tokens,
            "default_extra_body_json": s.default_extra_body_json,
            "worldbuilding_provider": s.worldbuilding_provider,
            "worldbuilding_base_url": s.worldbuilding_base_url,
            "worldbuilding_api_key":  s.worldbuilding_api_key,
            "worldbuilding_model":    s.worldbuilding_model,
            "worldbuilding_temperature": s.worldbuilding_temperature,
            "worldbuilding_max_tokens":  s.worldbuilding_max_tokens,
            "worldbuilding_extra_body_json": s.worldbuilding_extra_body_json,
            "worldbuilding_enabled": getattr(s, "worldbuilding_enabled", True),
            "worldbuilding_system_prompt": getattr(s, "worldbuilding_system_prompt", ""),
            "worldbuilding_user_prompt_template": getattr(s, "worldbuilding_user_prompt_template", ""),
            "plot_enabled": getattr(s, "plot_enabled", True),
            "plot_provider":          s.plot_provider,
            "plot_base_url":          s.plot_base_url,
            "plot_api_key":           s.plot_api_key,
            "plot_model":             s.plot_model,
            "plot_temperature":       s.plot_temperature,
            "plot_max_tokens":        s.plot_max_tokens,
            "plot_extra_body_json":    s.plot_extra_body_json,
            "plot_system_prompt": getattr(s, "plot_system_prompt", ""),
            "plot_user_prompt_template": getattr(s, "plot_user_prompt_template", ""),
            "character_enabled": getattr(s, "character_enabled", True),
            "character_provider":     s.character_provider,
            "character_base_url":     s.character_base_url,
            "character_api_key":      s.character_api_key,
            "character_model":        s.character_model,
            "character_temperature":  s.character_temperature,
            "character_max_tokens":   s.character_max_tokens,
            "character_extra_body_json": s.character_extra_body_json,
            "character_system_prompt": getattr(s, "character_system_prompt", ""),
            "character_user_prompt_template": getattr(s, "character_user_prompt_template", ""),
            "context_window":         s.context_window,
            "debug_mode":             s.debug_mode,
            "request_timeout":        s.request_timeout,
            "strict_mode":            getattr(s, "strict_mode", False),
            "injection_position":     getattr(s, "injection_position", "system-end"),
            "injection_format":       getattr(s, "injection_format", "classic"),
            "analysis_language":      getattr(s, "analysis_language", "auto"),
        })
    except Exception:
        save(dict(DEFAULTS))


def get_agent_config(agent_name: str) -> dict:
    cfg = load()
    prefix = agent_name.lower()
    temperature = cfg.get(f"{prefix}_temperature")
    max_tokens = cfg.get(f"{prefix}_max_tokens")
    extra_body_json = str(cfg.get(f"{prefix}_extra_body_json") or "").strip()
    return {
        "provider": cfg.get(f"{prefix}_provider") or cfg["default_provider"],
        "base_url": cfg.get(f"{prefix}_base_url") or cfg["default_base_url"],
        "api_key":  cfg.get(f"{prefix}_api_key")  or cfg["default_api_key"],
        "model":    cfg.get(f"{prefix}_model")     or cfg["default_model"],
        "temperature": temperature if temperature is not None else cfg["default_temperature"],
        "max_tokens": max_tokens if max_tokens is not None else cfg["default_max_tokens"],
        "extra_body_json": extra_body_json or cfg["default_extra_body_json"],
        "enabled": bool(cfg.get(f"{prefix}_enabled", True)),
        "system_prompt": cfg.get(f"{prefix}_system_prompt") or "",
        "user_prompt_template": cfg.get(f"{prefix}_user_prompt_template") or "",
    }


def public_status() -> dict:
    cfg = load()
    agents = []

    active_names = {name for name, _ in active_agents(cfg)}
    for name, label in AGENTS:
        agent_cfg = get_agent_config(name)
        api_key = agent_cfg["api_key"]
        temperature = cfg.get(f"{name}_temperature")
        max_tokens = cfg.get(f"{name}_max_tokens")
        agent_extra_body_json = str(cfg.get(f"{name}_extra_body_json") or "").strip()
        enabled = agent_enabled(name, cfg)
        agent_status = {
            "name": name,
            "label": label,
            "enabled": enabled,
            "active": name in active_names,
            "provider": agent_cfg["provider"],
            "base_url": agent_cfg["base_url"],
            "model": agent_cfg["model"],
            "temperature": agent_cfg["temperature"],
            "max_tokens": agent_cfg["max_tokens"],
            "provider_source": "override" if cfg.get(f"{name}_provider") else "default",
            "base_url_source": "override" if cfg.get(f"{name}_base_url") else "default",
            "api_key_source": "override" if cfg.get(f"{name}_api_key") else "default",
            "model_source": "override" if cfg.get(f"{name}_model") else "default",
            "temperature_source": "override" if temperature is not None else "default",
            "max_tokens_source": "override" if max_tokens is not None else "default",
            "extra_body_json_source": "override" if agent_extra_body_json else "default",
            "extra_body_json_set": bool(agent_cfg.get("extra_body_json")),
            "api_key_set": bool(api_key),
            "ready": bool(agent_cfg["base_url"] and api_key and agent_cfg["model"]),
            "system_prompt_custom": bool(cfg.get(f"{name}_system_prompt")),
            "user_prompt_template_custom": bool(cfg.get(f"{name}_user_prompt_template")),
        }
        agents.append(agent_status)

    active_agent_statuses = [agent for agent in agents if agent["active"]]
    return {
        "pipeline_mode": normalize_pipeline_mode(cfg.get("pipeline_mode")),
        "default_provider": cfg["default_provider"],
        "default_base_url": cfg["default_base_url"],
        "default_model": cfg["default_model"],
        "default_api_key_set": bool(cfg["default_api_key"]),
        "default_temperature": float(cfg["default_temperature"]),
        "default_max_tokens": cfg["default_max_tokens"],
        "default_extra_body_json_set": bool(cfg["default_extra_body_json"]),
        "context_window": int(cfg["context_window"]),
        "debug_mode": bool(cfg["debug_mode"]),
        "request_timeout": float(cfg["request_timeout"]),
        "strict_mode": bool(cfg.get("strict_mode", False)),
        "injection_position": str(cfg.get("injection_position", "system-end")),
        "injection_format": str(cfg.get("injection_format", "classic")),
        "analysis_language": str(cfg.get("analysis_language", "auto")),
        "agents": agents,
        "ready": bool(active_agent_statuses) and all(agent["ready"] for agent in active_agent_statuses),
    }
