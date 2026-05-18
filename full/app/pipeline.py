import asyncio
from time import perf_counter

from app.agents import WorldbuildingAgent, PlotAgent, CharacterAgent, DirectorAgent
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
    mode = config_store.normalize_pipeline_mode(cfg.get("pipeline_mode"))
    context_window = request.context_window or cfg.get("context_window", 10)
    fallback_context = request.system_context or request.world_summary or request.char_summary

    pipeline_context = {
        "user_input":     request.user_input,
        "chat_history":   [msg.model_dump() for msg in request.chat_history],
        "system_context": request.system_context,
        "world_summary":  request.world_summary or fallback_context,
        "char_summary":   request.char_summary or fallback_context,
        "context_window": context_window,
        "context_world":  "",
        "context_plot":   "",
        "context_char":   "",
        "context_director": "",
    }

    if mode == "ensemble-director":
        return await _run_ensemble_director_analysis(pipeline_context)

    timings: dict[str, int] = {}

    pipeline_context["context_world"] = await _timed_run(timings, "worldbuilding", WorldbuildingAgent(), pipeline_context)
    pipeline_context["context_plot"]  = await _timed_run(timings, "plot", PlotAgent(), pipeline_context)
    pipeline_context["context_char"]  = await _timed_run(timings, "character", CharacterAgent(), pipeline_context)

    return AnalyzeResponse(
        context_world=pipeline_context["context_world"],
        context_plot=pipeline_context["context_plot"],
        context_char=pipeline_context["context_char"],
        pipeline_mode="classic",
        agent_timings_ms=timings,
    )


async def _run_ensemble_director_analysis(pipeline_context: dict) -> AnalyzeResponse:
    """
    MDASH-inspired RP mode:
    1. Run the three auditor agents independently and concurrently.
    2. Let the director compare/dispute/synthesize those notes into compact final guidance.

    This keeps peak cloud concurrency at three model calls.
    """
    timings: dict[str, int] = {}
    world_context, plot_context, char_context = await asyncio.gather(
        _timed_run(timings, "worldbuilding", WorldbuildingAgent(), dict(pipeline_context)),
        _timed_run(timings, "plot", PlotAgent(), dict(pipeline_context)),
        _timed_run(timings, "character", CharacterAgent(), dict(pipeline_context)),
    )

    pipeline_context["context_world"] = world_context
    pipeline_context["context_plot"] = plot_context
    pipeline_context["context_char"] = char_context
    pipeline_context["context_director"] = await _timed_run(
        timings,
        "director",
        DirectorAgent(),
        pipeline_context,
    )

    return AnalyzeResponse(
        context_world=pipeline_context["context_world"],
        context_plot=pipeline_context["context_plot"],
        context_char=pipeline_context["context_char"],
        context_director=pipeline_context["context_director"],
        pipeline_mode="ensemble-director",
        agent_timings_ms=timings,
    )


async def _timed_run(timings: dict[str, int], name: str, agent, pipeline_context: dict) -> str:
    started = perf_counter()
    try:
        return await agent.run(pipeline_context)
    finally:
        timings[name] = int((perf_counter() - started) * 1000)
