from app.agents import WorldbuildingAgent, PlotAgent, CharacterAgent, ReviewerAgent
from app.models import GenerateRequest, GenerateResponse, DebugInfo
from app import config_store


async def run_pipeline(request: GenerateRequest) -> GenerateResponse:
    """
    4단계 에이전트 파이프라인 순차 실행.

    흐름:
    유저 입력
      → 세계관 에이전트  (context_world)
      → 플롯 에이전트    (context_plot)
      → 등장인물 에이전트 (context_char)
      → 검수 에이전트    (최종 응답)
    """
    cfg = config_store.load()
    context_window = request.context_window or cfg.get("context_window", 10)

    pipeline_context = {
        "user_input":     request.user_input,
        "chat_history":   [msg.model_dump() for msg in request.chat_history],
        "world_summary":  request.world_summary,
        "char_summary":   request.char_summary,
        "context_window": context_window,
        "context_world":  "",
        "context_plot":   "",
        "context_char":   "",
    }

    pipeline_context["context_world"] = await WorldbuildingAgent().run(pipeline_context)
    pipeline_context["context_plot"]  = await PlotAgent().run(pipeline_context)
    pipeline_context["context_char"]  = await CharacterAgent().run(pipeline_context)
    final_response                     = await ReviewerAgent().run(pipeline_context)

    debug = None
    if cfg.get("debug_mode"):
        debug = DebugInfo(
            context_world=pipeline_context["context_world"],
            context_plot=pipeline_context["context_plot"],
            context_char=pipeline_context["context_char"],
            reviewer_notes="(검수 에이전트 내부 처리)",
        )

    return GenerateResponse(response=final_response, debug=debug)
