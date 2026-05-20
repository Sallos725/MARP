from pydantic import BaseModel, ConfigDict, Field


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class AnalyzeRequest(BaseModel):
    user_input: str
    chat_history: list[ChatMessage] = Field(default_factory=list)
    system_context: str = ""
    world_summary: str = ""
    char_summary: str = ""
    context_window: int | None = None
    analysis_language: str = "auto"


class AnalyzeResponse(BaseModel):
    context_world: str
    context_plot: str
    context_char: str
    context_director: str = ""
    context_deep: dict[str, str] = Field(default_factory=dict)
    context_directives: dict[str, list[dict]] | None = None
    agent_debug: dict[str, dict] = Field(default_factory=dict)
    pipeline_mode: str = "classic"
    agent_timings_ms: dict[str, int] = Field(default_factory=dict)
    errors: dict[str, str] = Field(default_factory=dict)


class PublicConfigStatus(BaseModel):
    pipeline_mode: str
    default_provider: str
    default_base_url: str
    default_model: str
    default_api_key_set: bool
    default_temperature: float
    default_max_tokens: int | None
    default_extra_body_json_set: bool
    context_window: int
    debug_mode: bool
    request_timeout: float
    analysis_language: str


class AgentStatus(BaseModel):
    name: str
    label: str
    provider: str
    base_url: str
    model: str
    temperature: float
    max_tokens: int | None
    provider_source: str
    base_url_source: str
    api_key_source: str
    model_source: str
    temperature_source: str
    max_tokens_source: str
    api_key_set: bool
    ready: bool
    active: bool = True


class StatusResponse(BaseModel):
    status: str
    version: str
    ready: bool
    config: PublicConfigStatus
    agents: list[AgentStatus]


class LlmTestResult(BaseModel):
    name: str
    label: str
    provider: str
    base_url: str
    example_url: str
    model: str
    success: bool
    status_code: int | None = None
    latency_ms: int | None = None
    error: str = ""


class LlmTestResponse(BaseModel):
    success: bool
    results: list[LlmTestResult]


class ConfigModel(BaseModel):
    model_config = ConfigDict(extra="allow")

    pipeline_mode: str = "classic"
    default_provider: str = "openai-compatible"
    default_base_url: str = "https://api.openai.com/v1"
    default_api_key: str = ""
    default_model: str = "gpt-4o-mini"
    default_temperature: float = 0.7
    default_max_tokens: int | None = None
    default_extra_body_json: str = ""

    worldbuilding_provider: str = ""
    worldbuilding_base_url: str = ""
    worldbuilding_api_key: str = ""
    worldbuilding_model: str = ""
    worldbuilding_temperature: float | None = None
    worldbuilding_max_tokens: int | None = None
    worldbuilding_system_prompt: str = ""
    worldbuilding_user_prompt_template: str = ""

    plot_provider: str = ""
    plot_base_url: str = ""
    plot_api_key: str = ""
    plot_model: str = ""
    plot_temperature: float | None = None
    plot_max_tokens: int | None = None
    plot_system_prompt: str = ""
    plot_user_prompt_template: str = ""

    character_provider: str = ""
    character_base_url: str = ""
    character_api_key: str = ""
    character_model: str = ""
    character_temperature: float | None = None
    character_max_tokens: int | None = None
    character_system_prompt: str = ""
    character_user_prompt_template: str = ""

    director_provider: str = ""
    director_base_url: str = ""
    director_api_key: str = ""
    director_model: str = ""
    director_temperature: float | None = None
    director_max_tokens: int | None = None
    director_system_prompt: str = ""
    director_user_prompt_template: str = ""

    context_window: int = 10
    debug_mode: bool = False
    request_timeout: float = 60.0
    analysis_language: str = "auto"
