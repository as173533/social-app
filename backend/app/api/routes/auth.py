from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_session
from app.models.user import User
from app.schemas.auth import (
    AuthResponse,
    ChangePasswordRequest,
    LoginRequest,
    MessageResponse,
    PasswordResetConfirm,
    PasswordResetRequest,
    RefreshRequest,
    TokenPair,
)
from app.schemas.user import UserCreate, UserPublic
from app.services.auth import AuthService

router = APIRouter()


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: UserCreate, session: AsyncSession = Depends(get_session)):
    return await AuthService(session).register(payload)


@router.post("/login", response_model=AuthResponse)
async def login(payload: LoginRequest, session: AsyncSession = Depends(get_session)):
    return await AuthService(session).login(payload.identifier, payload.password)


@router.post("/refresh", response_model=TokenPair)
async def refresh(payload: RefreshRequest, session: AsyncSession = Depends(get_session)):
    return await AuthService(session).refresh(payload.refresh_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(payload: RefreshRequest, session: AsyncSession = Depends(get_session)):
    await AuthService(session).logout(payload.refresh_token)


@router.post("/password/change", response_model=MessageResponse)
async def change_password(
    payload: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    await AuthService(session).change_password(current_user, payload.current_password, payload.new_password)
    return MessageResponse(message="Password changed successfully")


@router.post("/password/forgot", response_model=MessageResponse)
async def forgot_password(payload: PasswordResetRequest, session: AsyncSession = Depends(get_session)):
    await AuthService(session).request_password_reset(payload.identifier)
    return MessageResponse(message="If this account exists, an OTP has been sent")


@router.post("/password/reset", response_model=MessageResponse)
async def reset_password(payload: PasswordResetConfirm, session: AsyncSession = Depends(get_session)):
    await AuthService(session).reset_password(payload.identifier, payload.otp, payload.new_password)
    return MessageResponse(message="Password reset successfully")


@router.get("/me", response_model=UserPublic)
async def me(current_user: User = Depends(get_current_user)):
    return current_user
