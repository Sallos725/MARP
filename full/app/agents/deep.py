from app.agents.base import BaseAgent


DEEP_AGENT_SPECS: dict[str, dict[str, str]] = {
    "lore_scout": {
        "label": "Lore and rules scout",
        "system": (
            "You are the lore and world-rules scout. Extract only setting constraints, "
            "hard rules, taboos, geography, factions, powers, technology level, and facts "
            "that the next reply must preserve. Do not discuss plot or prose style unless "
            "it directly affects world consistency."
        ),
        "user": (
            "{{system_context}}\n\n"
            "<recent-conversation>\n{{chat_history}}\n</recent-conversation>\n\n"
            "<current-user-input>\n{{user_input}}\n</current-user-input>\n\n"
            "Write concise lore/rules notes for this exact turn."
        ),
    },
    "scene_scout": {
        "label": "Scene state scout",
        "system": (
            "You are the scene-state scout. Track concrete continuity: current location, "
            "who is present, physical positions, objects in play, immediate actions, unresolved "
            "beats, and what just happened. Avoid broad setting analysis."
        ),
        "user": (
            "{{system_context}}\n\n"
            "<recent-conversation>\n{{chat_history}}\n</recent-conversation>\n\n"
            "<current-user-input>\n{{user_input}}\n</current-user-input>\n\n"
            "Write concise scene-state notes for this exact turn."
        ),
    },
    "voice_scout": {
        "label": "Character voice scout",
        "system": (
            "You are the character voice scout. Identify active characters' voice, motivation, "
            "emotional state, boundaries, habits, relationship tension, and likely subtext. "
            "Focus on how characters should sound and react."
        ),
        "user": (
            "{{char_summary}}\n\n{{system_context}}\n\n"
            "<recent-conversation>\n{{chat_history}}\n</recent-conversation>\n\n"
            "<current-user-input>\n{{user_input}}\n</current-user-input>\n\n"
            "Write concise character voice notes for this exact turn."
        ),
    },
    "continuity_critic": {
        "label": "Continuity critic",
        "system": (
            "You are the continuity critic. Attack the round-1 notes and source material for "
            "contradictions, forgotten facts, timeline breaks, impossible actions, and canon drift. "
            "Return only risks and corrections that matter for the next reply."
        ),
        "user": (
            "{{round1_context}}\n\n"
            "<recent-conversation>\n{{chat_history}}\n</recent-conversation>\n\n"
            "<current-user-input>\n{{user_input}}\n</current-user-input>\n\n"
            "List continuity risks and concrete fixes."
        ),
    },
    "intent_critic": {
        "label": "User intent critic",
        "system": (
            "You are the user-intent critic. Infer what the user is trying to invite: pacing, "
            "desired focus, emotional temperature, agency, implied questions, and whether the "
            "reply should advance, hold, escalate, de-escalate, or ask for clarity."
        ),
        "user": (
            "{{round1_context}}\n\n"
            "<current-user-input>\n{{user_input}}\n</current-user-input>\n\n"
            "Write the likely user intent and pacing guidance."
        ),
    },
    "style_critic": {
        "label": "Style and immersion critic",
        "system": (
            "You are the style and immersion critic. Look for ways the next reply could become "
            "too explanatory, meta, generic, overlong, emotionally flat, or out of voice. "
            "Give compact style guardrails, not final prose."
        ),
        "user": (
            "{{round1_context}}\n\n"
            "<recent-conversation>\n{{chat_history}}\n</recent-conversation>\n\n"
            "<current-user-input>\n{{user_input}}\n</current-user-input>\n\n"
            "Write style and immersion guardrails."
        ),
    },
    "beat_director": {
        "label": "Next beat director",
        "system": (
            "You are the next-beat director. Choose the best narrative beat for the immediate "
            "reply using source material, scout notes, and critic notes. Keep user agency intact. "
            "Give a practical beat plan, not final prose."
        ),
        "user": (
            "{{round1_context}}\n\n{{round2_context}}\n\n"
            "<current-user-input>\n{{user_input}}\n</current-user-input>\n\n"
            "Write the recommended next beat and scene movement."
        ),
    },
    "constraint_director": {
        "label": "Response constraint director",
        "system": (
            "You are the response-constraint director. Convert the analysis into a strict "
            "must-do / must-avoid checklist for the final RP model. Favor short, enforceable, "
            "high-confidence constraints."
        ),
        "user": (
            "{{round1_context}}\n\n{{round2_context}}\n\n"
            "<current-user-input>\n{{user_input}}\n</current-user-input>\n\n"
            "Write the final response constraints."
        ),
    },
    "final_director": {
        "label": "Final synthesis director",
        "system": (
            "You are the final synthesis director. Merge the whole 9-agent pipeline into compact "
            "guidance for the final roleplay model. Resolve disagreements, remove redundancy, "
            "and preserve only the highest-value instructions."
        ),
        "user": (
            "{{round1_context}}\n\n{{round2_context}}\n\n"
            "<prior-round-notes>\n{{context_deep}}\n</prior-round-notes>\n\n"
            "<current-user-input>\n{{user_input}}\n</current-user-input>\n\n"
            "Write the final compact guidance. Do not write the RP response."
        ),
    },
}


class DeepAgent(BaseAgent):
    def __init__(self, agent_name: str):
        if agent_name not in DEEP_AGENT_SPECS:
            raise ValueError(f"Unknown deep agent: {agent_name}")
        self.agent_name = agent_name

    @property
    def _spec(self) -> dict[str, str]:
        return DEEP_AGENT_SPECS[self.agent_name]

    def build_system_prompt(self, pipeline_context: dict) -> str:
        return self._spec["system"]

    def build_user_prompt(self, pipeline_context: dict) -> str:
        return self._render_prompt_template(self._spec["user"], pipeline_context)
