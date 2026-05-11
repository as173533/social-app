from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    phone: str = Field(min_length=7, max_length=32)


class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=128)


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    avatar: str | None = Field(default=None, max_length=500)
    bio: str | None = Field(default=None, max_length=500)


class UserPublic(BaseModel):
    id: int
    name: str
    email: EmailStr
    phone: str
    avatar: str | None
    bio: str | None
    created_at: datetime
    online: bool = False

    model_config = ConfigDict(from_attributes=True)
