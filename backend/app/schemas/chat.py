from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.user import UserPublic


class ConversationOut(BaseModel):
    id: int
    user1_id: int
    user2_id: int
    created_at: datetime
    peer: UserPublic | None = None

    model_config = ConfigDict(from_attributes=True)


class MessageCreate(BaseModel):
    body: str = Field(min_length=1, max_length=5000)


class MessageOut(BaseModel):
    id: int
    conversation_id: int
    sender_id: int
    body: str
    created_at: datetime
    read_by: list[int] = []

    model_config = ConfigDict(from_attributes=True)


class MarkReadRequest(BaseModel):
    message_ids: list[int]
