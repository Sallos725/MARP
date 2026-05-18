import asyncio
from time import perf_counter

from app.agents import WorldbuildingAgent, PlotAgent, CharacterAgent, DirectorAgent, DeepAgent
from app.models import AnalyzeRequest, AnalyzeResponse
from app import config_store


DEEP_ROUNDS: tuple[tuple[str, ...], ...] = (
    ("lore_scout", "scene_scout", "voice_scout"),
    ("continuity_critic", "intent_critic", "style_critic"),
    ("beat_director", "constraint_director", "final_director"),
)


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
        "context_deep": "",
        "round1_context": "",
        "round2_context": "",
        "deep_contexts": {},
    }

    if mode == "ensemble-director":
        return await _run_ensemble_director_analysis(pipeline_context)
    if mode == "deep-ensemble":
        return await _run_deep_ensemble_analysis(pipeline_context)

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


async def _run_deep_ensemble_analysis(pipeline_context: dict) -> AnalyzeResponse:
    """
    Extreme RP mode:
    3 serial rounds, 3 independent agents per round, 9 total model calls.
    Each round has distinct responsibilities; this is intentionally heavier than
    ensemble-director and keeps peak cloud concurrency at three calls.
    """
    timings: dict[str, int] = {}
    deep_contexts: dict[str, str] = {}

    for round_index, agent_names in enumerate(DEEP_ROUNDS, start=1):
        round_outputs = await asyncio.gather(*[
            _timed_run(timings, name, DeepAgent(name), dict(pipeline_context))
            for name in agent_names
        ])
        for name, output in zip(agent_names, round_outputs, strict=True):
            deep_contexts[name] = output
            pipeline_context["deep_contexts"][name] = output
            pipeline_context[f"context_{name}"] = output

        formatted_round = _format_deep_outputs(deep_contexts, agent_names)
        if round_index == 1:
            pipeline_context["round1_context"] = formatted_round
        elif round_index == 2:
            pipeline_context["round2_context"] = formatted_round

        pipeline_context["context_deep"] = _format_deep_outputs(deep_contexts, deep_contexts.keys())

    return AnalyzeResponse(
        context_world=deep_contexts.get("lore_scout", ""),
        context_plot=deep_contexts.get("beat_director", ""),
        context_char=deep_contexts.get("voice_scout", ""),
        context_director=deep_contexts.get("final_director", ""),
        context_deep=deep_contexts,
        pipeline_mode="deep-ensemble",
        agent_timings_ms=timings,
    )


async def _timed_run(timings: dict[str, int], name: str, agent, pipeline_context: dict) -> str:
    started = perf_counter()
    try:
        return await agent.run(pipeline_context)
    finally:
        timings[name] = int((perf_counter() - started) * 1000)


def _format_deep_outputs(outputs: dict[str, str], names) -> str:
    label_map = dict(config_store.DEEP_AGENTS)
    blocks = []
    for name in names:
        text = str(outputs.get(name, "")).strip()
        if not text:
            continue
        blocks.append("\n".join([
            f"[{label_map.get(name, name)}]",
            text,
        ]))
    return "\n\n".join(blocks)
