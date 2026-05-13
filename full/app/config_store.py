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
    "default_base_url":       "https://api.openai.com/v1",
    "default_api_key":        "",
    "default_model":          "gpt-4o-mini",
    "worldbuilding_base_url": "",
    "worldbuilding_api_key":  "",
    "worldbuilding_model":    "",
    "plot_base_url":          "",
    "plot_api_key":           "",
    "plot_model":             "",
    "character_base_url":     "",
    "character_api_key":      "",
    "character_model":        "",
    "reviewer_base_url":      "",
    "reviewer_api_key":       "",
    "reviewer_model":         "",
    "context_window":         10,
    "debug_mode":             False,
    "request_timeout":        60.0,
}


def load() -> dict:
    if CONFIG_PATH.exists():
        with _lock:
            text = CONFIG_PATH.read_text(encoding="utf-8")
        return {**DEFAULTS, **json.loads(text)}
    return dict(DEFAULTS)


def save(data: dict) -> None:
    merged = {**DEFAULTS, **data}
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
            "default_base_url":       s.default_base_url,
            "default_api_key":        s.default_api_key,
            "default_model":          s.default_model,
            "worldbuilding_base_url": s.worldbuilding_base_url,
            "worldbuilding_api_key":  s.worldbuilding_api_key,
            "worldbuilding_model":    s.worldbuilding_model,
            "plot_base_url":          s.plot_base_url,
            "plot_api_key":           s.plot_api_key,
            "plot_model":             s.plot_model,
            "character_base_url":     s.character_base_url,
            "character_api_key":      s.character_api_key,
            "character_model":        s.character_model,
            "reviewer_base_url":      s.reviewer_base_url,
            "reviewer_api_key":       s.reviewer_api_key,
            "reviewer_model":         s.reviewer_model,
            "context_window":         s.context_window,
            "debug_mode":             s.debug_mode,
            "request_timeout":        s.request_timeout,
        })
    except Exception:
        save(dict(DEFAULTS))


def get_agent_config(agent_name: str) -> dict:
    cfg = load()
    prefix = agent_name.lower()
    return {
        "base_url": cfg.get(f"{prefix}_base_url") or cfg["default_base_url"],
        "api_key":  cfg.get(f"{prefix}_api_key")  or cfg["default_api_key"],
        "model":    cfg.get(f"{prefix}_model")     or cfg["default_model"],
    }
