"""
PrivAgent :: FastAPI Backend
Receives ONLY sanitized context from the browser extension. Independently
verifies no raw PII slipped through (defense in depth), runs mock
reasoning + risk evaluation, and serves the live server dashboard.
"""

import time
import uuid
from datetime import datetime, timezone
from typing import Dict, List

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from privacy_gate import inspect_payload
from reasoning import generate_reasoning
from risk_engine import evaluate_risk
from action_planner import build_action_plan

app = FastAPI(title="PrivAgent Server", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # local hackathon demo; the extension talks to 127.0.0.1 only
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# In-memory server state (reset on restart) — powers the live dashboard.
# NEVER stores raw PII; only sanitized payloads and metadata are kept.
# ---------------------------------------------------------------------------
class ServerState:
    def __init__(self):
        self.requests_received = 0
        self.sanitized_requests = 0
        self.raw_pii_received = 0
        self.blocked_requests = 0
        self.recent_requests: List[Dict] = []  # most recent first, capped
        self.plans_generated = 0
        self.injection_attempts_blocked = 0

    def log_request(self, entry: Dict):
        self.recent_requests.insert(0, entry)
        self.recent_requests = self.recent_requests[:30]


state = ServerState()


# ---------------------------------------------------------------------------
# Request/response models
# ---------------------------------------------------------------------------
class ContextPayload(BaseModel):
    page: str = Field(default="unknown")
    url_host: str = Field(default="unknown")
    task: str = Field(default="unspecified")
    fields: Dict[str, str] = Field(default_factory=dict)
    pii_detected: int = Field(default=0)
    timestamp: str = Field(default="")


class PlanRequest(BaseModel):
    context: ContextPayload
    goal: str = Field(default="Assist the user on this page")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/health")
def health():
    return {
        "status": "SERVER ONLINE",
        "requests_received": state.requests_received,
        "sanitized_requests": state.sanitized_requests,
        "raw_pii_received": state.raw_pii_received,
        "blocked_requests": state.blocked_requests,
        "injection_attempts_blocked": state.injection_attempts_blocked,
    }


@app.get("/api/state")
def get_state():
    return {
        "requests_received": state.requests_received,
        "sanitized_requests": state.sanitized_requests,
        "raw_pii_received": state.raw_pii_received,
        "blocked_requests": state.blocked_requests,
        "plans_generated": state.plans_generated,
        "injection_attempts_blocked": state.injection_attempts_blocked,
        "recent_requests": state.recent_requests,
    }


@app.post("/api/context")
async def receive_context(payload: ContextPayload, request: Request):
    request_id = str(uuid.uuid4())[:8]
    ts = datetime.now(timezone.utc).isoformat()
    state.requests_received += 1

    gate_result = inspect_payload(payload.dict())

    log_entry = {
        "request_id": request_id,
        "timestamp": ts,
        "task": payload.task,
        "page": payload.page,
        "pii_detected_by_client": payload.pii_detected,
        "status": "BLOCKED" if not gate_result["safe"] else "SANITIZED",
    }

    if not gate_result["safe"]:
        state.blocked_requests += 1
        state.raw_pii_received += 1
        log_entry["reason"] = gate_result["reason"]
        state.log_request(log_entry)
        return JSONResponse(
            status_code=400,
            content={"status": "BLOCKED", "reason": gate_result["reason"], "request_id": request_id},
        )

    state.sanitized_requests += 1
    log_entry["payload"] = payload.dict()
    state.log_request(log_entry)

    return {
        "status": "SECURE",
        "request_id": request_id,
        "message": "Privacy check passed. Zero raw PII transmitted.",
        "payload_received": payload.dict(),
    }


@app.post("/api/plan")
async def generate_plan(req: PlanRequest):
    request_id = str(uuid.uuid4())[:8]

    # Independently re-verify the incoming context before reasoning on it.
    gate_result = inspect_payload(req.context.dict())
    if not gate_result["safe"]:
        state.blocked_requests += 1
        return JSONResponse(
            status_code=400,
            content={"status": "BLOCKED", "reason": gate_result["reason"], "request_id": request_id},
        )

    reasoning_steps = generate_reasoning(req.context.dict(), req.goal)
    plan = build_action_plan(req.context.dict(), req.goal)
    risk = evaluate_risk(plan["primary_action"])

    state.plans_generated += 1
    state.log_request({
        "request_id": request_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "task": "action_planning",
        "page": req.context.page,
        "status": "PLAN_GENERATED",
        "risk": risk,
    })

    return {
        "request_id": request_id,
        "reasoning": reasoning_steps,
        "plan": plan,
        "risk": risk,
    }


@app.post("/api/injection-report")
async def report_injection(request: Request):
    body = await request.json()
    state.injection_attempts_blocked += 1
    state.log_request({
        "request_id": str(uuid.uuid4())[:8],
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "task": "injection_report",
        "page": body.get("host", "unknown"),
        "status": "INJECTION_BLOCKED",
        "hits": body.get("hits", 0),
    })
    return {"status": "LOGGED"}


# Serve the live server dashboard at /
app.mount("/dashboard-assets", StaticFiles(directory="static"), name="static")


@app.get("/")
def serve_dashboard():
    return FileResponse("static/server-dashboard.html")


@app.get("/api/ping")
def ping():
    return {"pong": True, "time": time.time()}
