from functools import lru_cache
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # 기본 LLM 설정 (에이전트별 미지정 시 사용)
    default_provider: str = "openai"
    default_base_url: str = "https://api.openai.com/v1"
    default_api_key: str = ""
    default_model: str = "gpt-4o-mini"
    default_temperature: float = 0.7
    default_max_tokens: int | None = None

    # 세계관 에이전트
    worldbuilding_provider: str = ""
    worldbuilding_base_url: str = ""
    worldbuilding_api_key: str = ""
    worldbuilding_model: str = ""
    worldbuilding_temperature: float | None = None
    worldbuilding_max_tokens: int | None = None

    # 플롯 에이전트
    plot_provider: str = ""
    plot_base_url: str = ""
    plot_api_key: str = ""
    plot_model: str = ""
    plot_temperature: float | None = None
    plot_max_tokens: int | None = None

    # 등장인물 에이전트
    character_provider: str = ""
    character_base_url: str = ""
    character_api_key: str = ""
    character_model: str = ""
    character_temperature: float | None = None
    character_max_tokens: int | None = None

    # 검수 에이전트
    reviewer_provider: str = ""
    reviewer_base_url: str = ""
    reviewer_api_key: str = ""
    reviewer_model: str = ""
    reviewer_temperature: float | None = None
    reviewer_max_tokens: int | None = None

    # 파이프라인 설정
    context_window: int = 10
    debug_mode: bool = False
    request_timeout: float = 60.0

    @field_validator(
        "default_max_tokens",
        "worldbuilding_temperature",
        "worldbuilding_max_tokens",
        "plot_temperature",
        "plot_max_tokens",
        "character_temperature",
        "character_max_tokens",
        "reviewer_temperature",
        "reviewer_max_tokens",
        mode="before",
    )
    @classmethod
    def empty_string_to_none(cls, value):
        if value == "":
            return None
        return value

    def get_agent_config(self, agent_name: str) -> dict:
        """에이전트명을 받아 base_url/api_key/model 반환. 미지정 시 DEFAULT 사용."""
        prefix = agent_name.lower()
        provider = getattr(self, f"{prefix}_provider", "") or self.default_provider
        base_url = getattr(self, f"{prefix}_base_url", "") or self.default_base_url
        api_key = getattr(self, f"{prefix}_api_key", "") or self.default_api_key
        model = getattr(self, f"{prefix}_model", "") or self.default_model
        temperature = getattr(self, f"{prefix}_temperature", None)
        max_tokens = getattr(self, f"{prefix}_max_tokens", None)
        return {
            "provider": provider,
            "base_url": base_url,
            "api_key": api_key,
            "model": model,
            "temperature": temperature if temperature is not None else self.default_temperature,
            "max_tokens": max_tokens if max_tokens is not None else self.default_max_tokens,
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()
