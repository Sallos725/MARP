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
