from app.agents import WorldbuildingAgent, PlotAgent, CharacterAgent
from app.models import AnalyzeRequest, AnalyzeResponse
from app import config_store


async def run_analysis(request: AnalyzeRequest) -> AnalyzeResponse:
    """
    분석 에이전트 3개 순차 실행. 최종 응답은 RisuAI 메인 모델이 담당하므로 여기서 생성하지 않는다.

    흐름:
    유저 입력
      → 세계관 에이전트  (context_world)
      → 플롯 에이전트    (context_plot)
      → 등장인물 에이전트 (context_char)
    """
    cfg = config_store.load()
    context_window = request.context_window or cfg.get("context_window", 10)
    fallback_context = request.system_context or request.world_summary or request.char_summary

    pipeline_context = {
        "user_input":     request.user_input,
        "chat_history":   [msg.model_dump() for msg in request.chat_history],
        "world_summary":  request.world_summary or fallback_context,
        "char_summary":   request.char_summary or fallback_context,
        "context_window": context_window,
        "context_world":  "",
        "context_plot":   "",
        "context_char":   "",
    }

    pipeline_context["context_world"] = await WorldbuildingAgent().run(pipeline_context)
    pipeline_context["context_plot"]  = await PlotAgent().run(pipeline_context)
    pipeline_context["context_char"]  = await CharacterAgent().run(pipeline_context)

    return AnalyzeResponse(
        context_world=pipeline_context["context_world"],
        context_plot=pipeline_context["context_plot"],
        context_char=pipeline_context["context_char"],
    )
