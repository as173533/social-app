from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_session
from app.models.user import User
from app.schemas.user import UserE2EEKeyUpdate, UserMe, UserPublic, UserUpdate
from app.services.users import UserService

router = APIRouter()

AVATAR_DIR = Path("static/avatars")
AVATAR_DIR.mkdir(parents=True, exist_ok=True)


@router.patch("/me", response_model=UserMe)
async def update_me(
    payload: UserUpdate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await UserService(session).update_profile(current_user, payload)


@router.post("/me/avatar", response_model=UserMe)
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    if file.content_type not in {"image/jpeg", "image/png", "image/webp", "image/gif"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only image files are allowed")

    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Image must be 5MB or smaller")

    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        suffix = ".jpg"

    filename = f"{current_user.id}-{uuid4().hex}{suffix}"
    path = AVATAR_DIR / filename
    path.write_bytes(content)

    current_user.avatar = f"/static/avatars/{filename}"
    await session.commit()
    await session.refresh(current_user)
    return current_user


@router.put("/me/e2ee-key", response_model=UserMe)
async def update_e2ee_key(
    payload: UserE2EEKeyUpdate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    current_user.e2ee_public_key = payload.e2ee_public_key
    if payload.e2ee_private_key is not None:
        current_user.e2ee_private_key = payload.e2ee_private_key
    await session.commit()
    await session.refresh(current_user)
    return current_user


@router.get("/search", response_model=list[UserPublic])
async def search_users(
    q: str = Query(min_length=2, max_length=80),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    service = UserService(session)
    users = await service.search(q, current_user.id)
    online_map = {user.id: await service.is_online(user.id) for user in users}
    return [UserPublic.model_validate(user).model_copy(update={"online": online_map[user.id]}) for user in users]
