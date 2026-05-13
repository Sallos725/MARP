from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class GenerateRequest(BaseModel):
    user_input: str
    chat_history: list[ChatMessage] = Field(default_factory=list)
    world_summary: str = ""
    char_summary: str = ""
    context_window: int | None = None


class DebugInfo(BaseModel):
    context_world: str
    context_plot: str
    context_char: str
    reviewer_notes: str


class GenerateResponse(BaseModel):
    response: str
    debug: DebugInfo | None = None


class PublicConfigStatus(BaseModel):
    default_base_url: str
    default_model: str
    default_api_key_set: bool
    context_window: int
    debug_mode: bool
    request_timeout: float


class AgentStatus(BaseModel):
    name: str
    label: str
    base_url: str
    model: str
    base_url_source: str
    api_key_source: str
    model_source: str
    api_key_set: bool
    ready: bool


class StatusResponse(BaseModel):
    status: str
    version: str
    ready: bool
    config: PublicConfigStatus
    agents: list[AgentStatus]


class ConfigModel(BaseModel):
    default_base_url: str = "https://api.openai.com/v1"
    default_api_key: str = ""
    default_model: str = "gpt-4o-mini"

    worldbuilding_base_url: str = ""
    worldbuilding_api_key: str = ""
    worldbuilding_model: str = ""

    plot_base_url: str = ""
    plot_api_key: str = ""
    plot_model: str = ""

    character_base_url: str = ""
    character_api_key: str = ""
    character_model: str = ""

    reviewer_base_url: str = ""
    reviewer_api_key: str = ""
    reviewer_model: str = ""

    context_window: int = 10
    debug_mode: bool = False
    request_timeout: float = 60.0
