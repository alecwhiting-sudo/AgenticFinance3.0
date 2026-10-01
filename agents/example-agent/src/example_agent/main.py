"""HTTP surface for the agent: /health for Railway, /run to invoke the agent."""

from fastapi import FastAPI
from pydantic import BaseModel

from example_agent.agent import run_agent

app = FastAPI(title="example-agent")


class RunRequest(BaseModel):
    task: str


class RunResponse(BaseModel):
    result: str


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/run", response_model=RunResponse)
def run(request: RunRequest) -> RunResponse:
    return RunResponse(result=run_agent(request.task))
