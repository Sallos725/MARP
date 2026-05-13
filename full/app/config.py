from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # 기본 LLM 설정 (에이전트별 미지정 시 사용)
    default_base_url: str = "https://api.openai.com/v1"
    default_api_key: str = ""
    default_model: str = "gpt-4o-mini"

    # 세계관 에이전트
    worldbuilding_base_url: str = ""
    worldbuilding_api_key: str = ""
    worldbuilding_model: str = ""

    # 플롯 에이전트
    plot_base_url: str = ""
    plot_api_key: str = ""
    plot_model: str = ""

    # 등장인물 에이전트
    character_base_url: str = ""
    character_api_key: str = ""
    character_model: str = ""

    # 검수 에이전트
    reviewer_base_url: str = ""
    reviewer_api_key: str = ""
    reviewer_model: str = ""

    # 파이프라인 설정
    context_window: int = 10
    debug_mode: bool = False
    request_timeout: float = 60.0

    def get_agent_config(self, agent_name: str) -> dict:
        """에이전트명을 받아 base_url/api_key/model 반환. 미지정 시 DEFAULT 사용."""
        prefix = agent_name.lower()
        base_url = getattr(self, f"{prefix}_base_url", "") or self.default_base_url
        api_key = getattr(self, f"{prefix}_api_key", "") or self.default_api_key
        model = getattr(self, f"{prefix}_model", "") or self.default_model
        return {"base_url": base_url, "api_key": api_key, "model": model}


@lru_cache
def get_settings() -> Settings:
    return Settings()
