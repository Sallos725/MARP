import asyncio
import re
from time import perf_counter

from app.agents import WorldbuildingAgent, PlotAgent, CharacterAgent, DirectorAgent, DeepAgent
from app.models import AnalyzeRequest, AnalyzeResponse
from app import config_store


DEEP_ROUNDS: tuple[tuple[str, ...], ...] = (
    ("lore_scout", "scene_scout", "voice_scout"),
    ("continuity_critic", "intent_critic", "style_critic"),
    ("beat_director", "constraint_director", "final_director"),
)


_DIRECTIVE_SECTION_RE = re.compile(
    r"\[(HARD|SOFT|FYI)\]\s*\n(.*?)(?=\n\[(?:HARD|SOFT|FYI)\]|\Z)",
    re.DOTALL | re.IGNORECASE,
)
_BULLET_RE = re.compile(r"^\s*[-*•]\s+(.+?)\s*$", re.MULTILINE)
_NONE_MARKERS = {"(none)", "none", "n/a", "-"}


def parse_directives(text: str) -> dict[str, list[str]]:
    """에이전트 raw 응답에서 [HARD]/[SOFT]/[FYI] 추출. legacy는 전체를 soft로 폴백."""
    raw = str(text or "").strip()
    result: dict[str, list[str]] = {"hard": [], "soft": [], "fyi": []}
    if not raw:
        return result
    matches = _DIRECTIVE_SECTION_RE.findall(raw)
    if not matches:
        for bullet in _BULLET_RE.findall(raw):
            cleaned = bullet.strip()
            if cleaned and cleaned.lower() not in _NONE_MARKERS:
                result["soft"].append(cleaned)
        if not result["soft"]:
            result["soft"].append(raw[:400])
        return result
    for grade, body in matches:
        key = grade.lower()
        if key not in result:
            continue
        for bullet in _BULLET_RE.findall(body):
            cleaned = bullet.strip()
            if not cleaned or cleaned.lower() in _NONE_MARKERS:
                continue
            result[key].append(cleaned)
    return result


def _normalize_bullet(text: str) -> str:
    s = re.sub(r"\s+", " ", str(text or "").lower()).strip()
    s = re.sub(r"[.;,:!?]+$", "", s)
    return s


def aggregate_directives(
    agent_outputs: dict[str, str],
    agent_order: list[str] | tuple[str, ...] | None = None,
) -> dict[str, list[dict]]:
    """여러 에이전트 출력을 grade별로 dedup. 출처(sources) 메타데이터 보존."""
    order = list(agent_order) if agent_order else list(agent_outputs.keys())
    aggregated: dict[str, dict[str, dict]] = {"hard": {}, "soft": {}, "fyi": {}}
    for name in order:
        text = agent_outputs.get(name)
        if not text:
            continue
        parsed = parse_directives(text)
        for grade in ("hard", "soft", "fyi"):
            for bullet in parsed[grade]:
                key = _normalize_bullet(bullet)
                if not key:
                    continue
                if key in aggregated[grade]:
                    entry = aggregated[grade][key]
                    if name not in entry["sources"]:
                        entry["sources"].append(name)
                    if len(bullet) > len(entry["text"]):
                        entry["text"] = bullet
                else:
                    aggregated[grade][key] = {"text": bullet, "sources": [name]}
    return {grade: list(aggregated[grade].values()) for grade in ("hard", "soft", "fyi")}


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
    analysis_language = _normalize_analysis_language(
        request.analysis_language or cfg.get("analysis_language", "auto")
    )

    pipeline_context = {
        "user_input":     request.user_input,
        "chat_history":   [msg.model_dump() for msg in request.chat_history],
        "system_context": request.system_context,
        "world_summary":  request.world_summary or fallback_context,
        "char_summary":   request.char_summary or fallback_context,
        "context_window": context_window,
        "analysis_language": analysis_language,
        "context_world":  "",
        "context_plot":   "",
        "context_char":   "",
        "context_director": "",
        "context_deep": "",
        "round1_context": "",
        "round2_context": "",
        "deep_contexts": {},
        "_agent_debug": {},
    }

    if mode == "ensemble-director":
        return await _run_ensemble_director_analysis(pipeline_context)
    if mode == "deep-ensemble":
        return await _run_deep_ensemble_analysis(pipeline_context)

    timings: dict[str, int] = {}
    errors: dict[str, str] = {}

    pipeline_context["context_world"] = await _safe_timed_run(timings, errors, "worldbuilding", WorldbuildingAgent(), pipeline_context)
    pipeline_context["context_plot"]  = await _safe_timed_run(timings, errors, "plot", PlotAgent(), pipeline_context)
    pipeline_context["context_char"]  = await _safe_timed_run(timings, errors, "character", CharacterAgent(), pipeline_context)

    return AnalyzeResponse(
        context_world=pipeline_context["context_world"],
        context_plot=pipeline_context["context_plot"],
        context_char=pipeline_context["context_char"],
        pipeline_mode="classic",
        agent_debug=pipeline_context["_agent_debug"],
        agent_timings_ms=timings,
        errors=errors,
    )


async def _run_ensemble_director_analysis(pipeline_context: dict) -> AnalyzeResponse:
    """
    MDASH-inspired RP mode:
    1. Run the three auditor agents independently and concurrently.
    2. Let the director compare/dispute/synthesize those notes into compact final guidance.

    This keeps peak cloud concurrency at three model calls.
    """
    timings: dict[str, int] = {}
    errors: dict[str, str] = {}
    world_context, plot_context, char_context = await asyncio.gather(
        _safe_timed_run(timings, errors, "worldbuilding", WorldbuildingAgent(), dict(pipeline_context)),
        _safe_timed_run(timings, errors, "plot", PlotAgent(), dict(pipeline_context)),
        _safe_timed_run(timings, errors, "character", CharacterAgent(), dict(pipeline_context)),
    )

    pipeline_context["context_world"] = world_context
    pipeline_context["context_plot"] = plot_context
    pipeline_context["context_char"] = char_context
    pipeline_context["context_director"] = await _safe_timed_run(
        timings,
        errors,
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
        agent_debug=pipeline_context["_agent_debug"],
        agent_timings_ms=timings,
        errors=errors,
    )


async def _run_deep_ensemble_analysis(pipeline_context: dict) -> AnalyzeResponse:
    """
    Extreme RP mode:
    3 serial rounds, 3 independent agents per round, 9 total model calls.
    Each round has distinct responsibilities; this is intentionally heavier than
    ensemble-director and keeps peak cloud concurrency at three calls.
    """
    timings: dict[str, int] = {}
    errors: dict[str, str] = {}
    deep_contexts: dict[str, str] = {}

    for round_index, agent_names in enumerate(DEEP_ROUNDS, start=1):
        round_outputs = await asyncio.gather(*[
            _safe_timed_run(timings, errors, name, DeepAgent(name), dict(pipeline_context))
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

    directives = aggregate_directives(
        deep_contexts,
        agent_order=[name for round_ in DEEP_ROUNDS for name in round_],
    )

    return AnalyzeResponse(
        context_world=deep_contexts.get("lore_scout", ""),
        context_plot=deep_contexts.get("beat_director", ""),
        context_char=deep_contexts.get("voice_scout", ""),
        context_director=deep_contexts.get("final_director", ""),
        context_deep=deep_contexts,
        context_directives=directives,
        pipeline_mode="deep-ensemble",
        agent_debug=pipeline_context["_agent_debug"],
        agent_timings_ms=timings,
        errors=errors,
    )


async def _timed_run(timings: dict[str, int], name: str, agent, pipeline_context: dict) -> str:
    started = perf_counter()
    try:
        return await agent.run(pipeline_context)
    finally:
        timings[name] = int((perf_counter() - started) * 1000)


async def _safe_timed_run(
    timings: dict[str, int],
    errors: dict[str, str],
    name: str,
    agent,
    pipeline_context: dict,
) -> str:
    try:
        return await _timed_run(timings, name, agent, pipeline_context)
    except Exception as exc:
        errors[name] = f"{type(exc).__name__}: {exc}"
        return ""


def _normalize_analysis_language(value: str | None) -> str:
    normalized = str(value or "auto").strip().lower()
    return normalized if normalized in {"auto", "ko", "en", "ja"} else "auto"


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
