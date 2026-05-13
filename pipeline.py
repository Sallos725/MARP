from app.agents import (
    WorldbuildingAgent,
    PlotAgent,
    CharacterAgent,
    ReviewerAgent,
)
from app.models import GenerateRequest, GenerateResponse, DebugInfo
from app.config import get_settings


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
    settings = get_settings()

    # 컨텍스트 윈도우 결정 (요청 우선, 없으면 서버 기본값)
    context_window = request.context_window or settings.context_window

    # 파이프라인 공유 컨텍스트 초기화
    pipeline_context = {
        "user_input": request.user_input,
        "chat_history": [msg.model_dump() for msg in request.chat_history],
        "world_summary": request.world_summary,
        "char_summary": request.char_summary,
        "context_window": context_window,
        # 에이전트 출력 (순차적으로 채워짐)
        "context_world": "",
        "context_plot": "",
        "context_char": "",
    }

    # 1. 세계관 에이전트
    world_agent = WorldbuildingAgent()
    pipeline_context["context_world"] = await world_agent.run(pipeline_context)

    # 2. 플롯 에이전트
    plot_agent = PlotAgent()
    pipeline_context["context_plot"] = await plot_agent.run(pipeline_context)

    # 3. 등장인물 에이전트
    char_agent = CharacterAgent()
    pipeline_context["context_char"] = await char_agent.run(pipeline_context)

    # 4. 검수 에이전트 (최종 응답 생성)
    reviewer = ReviewerAgent()
    final_response = await reviewer.run(pipeline_context)

    # 디버그 정보 (DEBUG_MODE=true일 때만)
    debug = None
    if settings.debug_mode:
        debug = DebugInfo(
            context_world=pipeline_context["context_world"],
            context_plot=pipeline_context["context_plot"],
            context_char=pipeline_context["context_char"],
            reviewer_notes="(검수 에이전트 내부 처리)",
        )

    return GenerateResponse(response=final_response, debug=debug)
