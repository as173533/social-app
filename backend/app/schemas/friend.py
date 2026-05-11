from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.schemas.user import UserPublic


class FriendRequestCreate(BaseModel):
    receiver_id: int


class FriendRequestOut(BaseModel):
    id: int
    sender_id: int
    receiver_id: int
    status: str
    created_at: datetime
    responded_at: datetime | None
    sender: UserPublic | None = None
    receiver: UserPublic | None = None

    model_config = ConfigDict(from_attributes=True)


class FriendOut(BaseModel):
    friendship_id: int
    user: UserPublic
