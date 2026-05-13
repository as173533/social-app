from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.user import UserPublic


class ConversationOut(BaseModel):
    id: int
    user1_id: int
    user2_id: int | None
    conversation_type: str = "direct"
    title: str | None = None
    avatar: str | None = None
    owner_id: int | None = None
    created_at: datetime
    peer: UserPublic | None = None
    members: list[UserPublic] = []
    role: str | None = None

    model_config = ConfigDict(from_attributes=True)


class GroupCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    member_ids: list[int] = Field(min_length=1, max_length=50)


class MessageCreate(BaseModel):
    body: str = Field(default="", max_length=200000)
    message_type: str = Field(default="text", max_length=20)
    attachment_url: str | None = Field(default=None, max_length=500)
    attachment_name: str | None = Field(default=None, max_length=255)
    attachment_mime: str | None = Field(default=None, max_length=120)
    attachment_size: int | None = None
    reply_to_message_id: int | None = None


class MessageReplyOut(BaseModel):
    id: int
    sender_id: int
    body: str
    message_type: str = "text"
    attachment_name: str | None = None

    model_config = ConfigDict(from_attributes=True)


class MessageReactionOut(BaseModel):
    user_id: int
    emoji: str

    model_config = ConfigDict(from_attributes=True)


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
    reply_to_message_id: int | None = None
    reply_to: MessageReplyOut | None = None
    deleted_for_everyone: bool = False
    created_at: datetime
    read_by: list[int] = []
    reactions: list[MessageReactionOut] = []

    model_config = ConfigDict(from_attributes=True)


class MarkReadRequest(BaseModel):
    message_ids: list[int]


class MessageDeleteRequest(BaseModel):
    scope: str = Field(pattern="^(me|everyone)$")


class MessageEditRequest(BaseModel):
    body: str = Field(min_length=1, max_length=200000)
    message_type: str = Field(default="text", max_length=20)


class MessageReactionRequest(BaseModel):
    emoji: str = Field(min_length=1, max_length=16)


class AttachmentOut(BaseModel):
    url: str
    name: str
    mime: str
    size: int
    message_type: str
