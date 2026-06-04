import asyncio
from time import perf_counter
from app.agents import WorldbuildingAgent, PlotAgent, CharacterAgent
from app.llm_client import sanitize_agent_output
from app.models import AnalyzeRequest, AnalyzeResponse
from app import config_store


async def run_analysis(request: AnalyzeRequest) -> AnalyzeResponse:
    """
    분석 에이전트 3개 실행. 세계관을 먼저 분석한 뒤, 플롯과 등장인물을 병렬로 실행하여 TTFT 지연 시간을 단축한다.
    실패 시 Fail-Open 정책을 따르기 위해 각 에이전트 호출을 try-except로 개별 방어한다.
    """
    cfg = config_store.load()
    active_names = {name for name, _ in config_store.active_agents(cfg)}
    context_window = request.context_window or cfg.get("context_window", 10)
    fallback_context = request.system_context or request.world_summary or request.char_summary
    analysis_language = request.analysis_language or cfg.get("analysis_language", "auto")

    pipeline_context = {
        "user_input":        request.user_input,
        "chat_history":      [msg.model_dump() for msg in request.chat_history],
        "world_summary":     request.world_summary or fallback_context,
        "char_summary":      request.char_summary or fallback_context,
        "context_window":    context_window,
        "analysis_language": analysis_language,
        "context_world":     "",
        "context_plot":      "",
        "context_char":      "",
    }

    errors = {}
    latency_ms = {}

    async def safe_run(agent_instance, name: str) -> str:
        start_time = perf_counter()
        try:
            res = sanitize_agent_output(await agent_instance.run(pipeline_context))
            latency_ms[name] = int((perf_counter() - start_time) * 1000)
            return res or ""
        except Exception as e:
            errors[name] = str(e)
            latency_ms[name] = int((perf_counter() - start_time) * 1000)
            return ""

    # 1단계: 세계관 에이전트 실행
    if "worldbuilding" in active_names:
        pipeline_context["context_world"] = await safe_run(WorldbuildingAgent(), "worldbuilding")

    # 2단계: 플롯 & 등장인물 에이전트 병렬 실행
    plot_task = safe_run(PlotAgent(), "plot") if "plot" in active_names else None
    char_task = safe_run(CharacterAgent(), "character") if "character" in active_names else None

    if plot_task and char_task:
        plot_res, char_res = await asyncio.gather(plot_task, char_task)
        pipeline_context["context_plot"] = plot_res
        pipeline_context["context_char"] = char_res
    elif plot_task:
        pipeline_context["context_plot"] = await plot_task
    elif char_task:
        pipeline_context["context_char"] = await char_task

    return AnalyzeResponse(
        context_world=pipeline_context["context_world"],
        context_plot=pipeline_context["context_plot"],
        context_char=pipeline_context["context_char"],
        errors=errors,
        latency_ms=latency_ms,
    )
