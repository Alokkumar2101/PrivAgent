"""
PrivAgent :: Server Privacy Gate
Independently inspects every incoming payload for raw PII patterns.
This is defense in depth: the client is expected to sanitize, but the
server never trusts the client blindly.
"""

import re
import json
from typing import Dict

PII_PATTERNS = {
    "email": re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
    "phone": re.compile(r"\b(?:\+?\d{1,3}[-.\s]?)?(?:\d{10}|\d{3}[-.\s]\d{3}[-.\s]\d{4})\b"),
    "credit_card": re.compile(r"\b(?:\d[ -]*?){13,16}\b"),
    "jwt": re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b"),
    "api_key": re.compile(r"\b(sk|pk|api|key)[-_][A-Za-z0-9]{10,}\b", re.IGNORECASE),
    "aadhaar_like": re.compile(r"\b\d{4}\s?\d{4}\s?\d{4}\b"),
}

# Redaction tokens the client is expected to have already used.
# Any field value that is NOT one of these (or a safe primitive) is suspect.
EXPECTED_REDACTION_TOKENS = {
    "[EMAIL_REDACTED]", "[PASSWORD_REDACTED]", "[NAME_REDACTED]",
    "[PHONE_REDACTED]", "[ADDRESS_REDACTED]", "[CARD_REDACTED]",
    "[OTP_REDACTED]", "[API_KEY_REDACTED]", "[TOKEN_REDACTED]", "[PII_REDACTED]",
}


def inspect_payload(payload: Dict) -> Dict:
    """
    Returns { safe: bool, reason?: str }
    Scans the JSON-serialized payload for any raw PII pattern.
    """
    try:
        serialized = json.dumps(payload)
    except (TypeError, ValueError):
        return {"safe": False, "reason": "Payload could not be serialized for inspection"}

    for name, pattern in PII_PATTERNS.items():
        match = pattern.search(serialized)
        if match:
            return {"safe": False, "reason": f"Possible raw PII detected ({name} pattern found)"}

    # Field-level check: any field value that looks like free text but isn't
    # a redaction token and isn't a short safe primitive is flagged.
    fields = payload.get("fields", {})
    if isinstance(fields, dict):
        for key, value in fields.items():
            if not isinstance(value, str):
                continue
            if value in EXPECTED_REDACTION_TOKENS:
                continue
            # allow short generic values (e.g. "manual_send", "login") but
            # flag anything that looks like it could be raw personal data
            if len(value) > 40 or "@" in value:
                return {"safe": False, "reason": f"Unexpected non-redacted value in field '{key}'"}

    return {"safe": True}
