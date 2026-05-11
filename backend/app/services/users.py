from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.redis import redis_client
from app.models.user import User
from app.repositories.users import UserRepository
from app.schemas.user import UserUpdate


class UserService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.users = UserRepository(session)

    async def get(self, user_id: int) -> User:
        user = await self.users.get_by_id(user_id)
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        return user

    async def update_profile(self, user: User, payload: UserUpdate) -> User:
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(user, field, value)
        await self.session.commit()
        await self.session.refresh(user)
        return user

    async def search(self, query: str, current_user_id: int) -> list[User]:
        if len(query.strip()) < 2:
            return []
        return await self.users.search(query.strip(), current_user_id)

    async def is_online(self, user_id: int) -> bool:
        return bool(await redis_client.exists(f"online:{user_id}"))
