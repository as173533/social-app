from datetime import datetime

from pydantic import BaseModel, ConfigDict


class CallLogOut(BaseModel):
    id: int
    caller_id: int
    callee_id: int
    call_type: str
    state: str
    started_at: datetime
    answered_at: datetime | None
    ended_at: datetime | None

    model_config = ConfigDict(from_attributes=True)
