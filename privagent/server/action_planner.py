"""
PrivAgent :: Action Planner
Builds a structured, allowlisted action plan from sanitized context + goal.
The server NEVER returns raw JavaScript/code — only typed action objects
that the client independently validates before execution (defense in depth).
"""

from typing import Dict

ALLOWED_ACTION_TYPES = {
    "navigate", "search", "scroll", "go_back", "go_forward", "refresh",
    "open_new_tab", "close_tab", "read_page", "summarize_page",
    "click", "focus", "type", "submit", "login", "send",
    "payment", "delete_account", "change_password",
}


def build_action_plan(context: Dict, goal: str) -> Dict:
    goal_lower = goal.lower()

    if "delete" in goal_lower and "account" in goal_lower:
        primary = {"type": "delete_account", "payload": {}}
    elif "password" in goal_lower and "change" in goal_lower:
        primary = {"type": "change_password", "payload": {}}
    elif "pay" in goal_lower or "checkout" in goal_lower:
        primary = {"type": "payment", "payload": {}}
    elif "login" in goal_lower or "sign in" in goal_lower:
        primary = {"type": "login", "payload": {}}
    elif "search" in goal_lower:
        primary = {"type": "search", "payload": {"query": goal}}
    elif "open" in goal_lower or "go to" in goal_lower or "navigate" in goal_lower:
        primary = {"type": "navigate", "payload": {"url": None}}
    else:
        primary = {"type": "read_page", "payload": {}}

    assert primary["type"] in ALLOWED_ACTION_TYPES  # server-side allowlist guard

    return {
        "primary_action": primary,
        "context_page": context.get("page"),
        "notes": "Action is schema-validated. Client will independently re-validate "
                 "and enforce the allowlist + approval flow before execution.",
    }
