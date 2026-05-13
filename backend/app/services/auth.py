import logging
import secrets
import smtplib
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import select
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
from app.models.password_reset import PasswordResetOtp
from app.models.user import User
from app.repositories.tokens import TokenRepository
from app.repositories.users import UserRepository
from app.schemas.auth import AuthResponse, TokenPair
from app.schemas.user import UserCreate

logger = logging.getLogger(__name__)


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

    async def change_password(self, user: User, current_password: str, new_password: str) -> None:
        if not verify_password(current_password, user.password_hash):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
        user.password_hash = hash_password(new_password)
        await self.tokens.revoke_all_for_user(user.id)
        await self.session.commit()

    async def request_password_reset(self, identifier: str) -> None:
        user = await self.users.get_by_email_or_phone(identifier.lower())
        if not user:
            return
        code = f"{secrets.randbelow(1_000_000):06d}"
        otp = PasswordResetOtp(
            user_id=user.id,
            code_hash=hash_token(code),
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=settings.password_reset_otp_expire_minutes),
        )
        self.session.add(otp)
        await self.session.commit()
        try:
            self._send_password_reset_otp(user, code)
        except Exception:
            logger.exception("Could not send password reset OTP to %s", user.email)

    async def reset_password(self, identifier: str, otp: str, new_password: str) -> None:
        user = await self.users.get_by_email_or_phone(identifier.lower())
        if not user:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired OTP")
        result = await self.session.execute(
            select(PasswordResetOtp)
            .where(
                PasswordResetOtp.user_id == user.id,
                PasswordResetOtp.consumed_at.is_(None),
                PasswordResetOtp.expires_at > datetime.now(timezone.utc),
            )
            .order_by(PasswordResetOtp.created_at.desc())
            .limit(1)
        )
        reset_otp = result.scalar_one_or_none()
        if not reset_otp or reset_otp.code_hash != hash_token(otp.strip()):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired OTP")
        reset_otp.consumed_at = datetime.now(timezone.utc)
        user.password_hash = hash_password(new_password)
        await self.tokens.revoke_all_for_user(user.id)
        await self.session.commit()

    async def _issue_token_pair(self, user_id: int) -> TokenPair:
        token_id = str(uuid4())
        refresh_expires_at = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)
        access = create_access_token(user_id)
        refresh = create_refresh_token(user_id, token_id=token_id, expires_at=refresh_expires_at)
        await self.tokens.create_refresh_token(user_id, hash_token(refresh), refresh_expires_at)
        return TokenPair(access_token=access, refresh_token=refresh)

    def _send_password_reset_otp(self, user: User, code: str) -> None:
        if not settings.smtp_host or not settings.smtp_from_email:
            logger.warning("Password reset OTP for %s is %s", user.email, code)
            return
        message = EmailMessage()
        message["Subject"] = "Your Chat Messenger password reset OTP"
        message["From"] = settings.smtp_from_email
        message["To"] = user.email
        message.set_content(
            f"Hi {user.name},\n\n"
            f"Your Chat Messenger password reset OTP is {code}.\n"
            f"It expires in {settings.password_reset_otp_expire_minutes} minutes.\n\n"
            "If you did not request this, you can ignore this email.\n"
        )
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
            if settings.smtp_use_tls:
                smtp.starttls()
            if settings.smtp_username and settings.smtp_password:
                smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(message)
