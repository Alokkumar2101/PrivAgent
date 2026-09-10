"""
PrivAgent :: Server Risk Engine
Mirrors the client-side risk engine so both sides agree on scoring.
The CLIENT always makes the final approval decision — this server-side
score is advisory / used for the action plan response only.
"""

from typing import Dict

RISK_SCORES = {
    "scroll": 5, "focus": 5, "navigate": 10, "search": 10,
    "go_back": 5, "go_forward": 5, "refresh": 8, "open_new_tab": 5,
    "close_tab": 15, "read_page": 5, "summarize_page": 5,
    "click": 35, "type": 30, "submit": 55, "login": 60, "send": 55,
    "payment": 90, "delete_account": 95, "change_password": 85,
}


def level_for(score: int) -> str:
    if score >= 70:
        return "HIGH"
    if score >= 30:
        return "MEDIUM"
    return "LOW"


def evaluate_risk(action: Dict) -> Dict:
    action_type = action.get("type", "unknown")
    score = RISK_SCORES.get(action_type, 50)
    level = level_for(score)
    return {
        "score": score,
        "level": level,
        "approval_required": level == "HIGH",
        "reason": _reason(action_type, level),
    }


def _reason(action_type: str, level: str) -> str:
    if level == "HIGH":
        return f'"{action_type}" may create an external financial, security, or irreversible effect.'
    if level == "MEDIUM":
        return f'"{action_type}" modifies page state or submits data.'
    return f'"{action_type}" is a passive/read-only browser action.'
