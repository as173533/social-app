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
    body: str = Field(default="", max_length=5000)
    message_type: str = Field(default="text", max_length=20)
    attachment_url: str | None = Field(default=None, max_length=500)
    attachment_name: str | None = Field(default=None, max_length=255)
    attachment_mime: str | None = Field(default=None, max_length=120)
    attachment_size: int | None = None


class MessageOut(BaseModel):
    id: int
    conversation_id: int
    sender_id: int
    body: str
    message_type: str = "text"
    attachment_url: str | None = None
    attachment_name: str | None = None
    attachment_mime: str | None = None
    attachment_size: int | None = None
    created_at: datetime
    read_by: list[int] = []

    model_config = ConfigDict(from_attributes=True)


class MarkReadRequest(BaseModel):
    message_ids: list[int]


class AttachmentOut(BaseModel):
    url: str
    name: str
    mime: str
    size: int
    message_type: str
