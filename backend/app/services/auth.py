from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    hash_token,
    verify_password,
)
from app.models.user import User
from app.repositories.tokens import TokenRepository
from app.repositories.users import UserRepository
from app.schemas.auth import AuthResponse, TokenPair
from app.schemas.user import UserCreate


class AuthService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.users = UserRepository(session)
        self.tokens = TokenRepository(session)

    async def register(self, payload: UserCreate) -> AuthResponse:
        email = str(payload.email).lower()
        existing_email = await self.users.get_by_email_or_phone(email)
        existing_phone = await self.users.get_by_email_or_phone(payload.phone)
        if existing_email or existing_phone:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email or phone already registered")
        user = User(
            email=email,
            phone=payload.phone,
            name=payload.name,
            password_hash=hash_password(payload.password),
        )
        await self.users.create(user)
        token_pair = await self._issue_token_pair(user.id)
        await self.session.commit()
        return AuthResponse(**token_pair.model_dump(), user=user)

    async def login(self, identifier: str, password: str) -> AuthResponse:
        user = await self.users.get_by_email_or_phone(identifier.lower())
        if not user or not verify_password(password, user.password_hash):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
        if not user.is_active:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Inactive user")
        token_pair = await self._issue_token_pair(user.id)
        await self.session.commit()
        return AuthResponse(**token_pair.model_dump(), user=user)

    async def refresh(self, refresh_token: str) -> TokenPair:
        try:
            payload = decode_token(refresh_token, expected_type="refresh")
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token") from exc
        stored = await self.tokens.get_active_by_hash(hash_token(refresh_token))
        if not stored or stored.user_id != int(payload["sub"]):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
        await self.tokens.revoke(stored)
        token_pair = await self._issue_token_pair(stored.user_id)
        await self.session.commit()
        return token_pair

    async def logout(self, refresh_token: str) -> None:
        stored = await self.tokens.get_active_by_hash(hash_token(refresh_token))
        if stored:
            await self.tokens.revoke(stored)
            await self.session.commit()

    async def _issue_token_pair(self, user_id: int) -> TokenPair:
        token_id = str(uuid4())
        refresh_expires_at = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)
        access = create_access_token(user_id)
        refresh = create_refresh_token(user_id, token_id=token_id, expires_at=refresh_expires_at)
        await self.tokens.create_refresh_token(user_id, hash_token(refresh), refresh_expires_at)
        return TokenPair(access_token=access, refresh_token=refresh)
