from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User


class UserRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, user: User) -> User:
        self.session.add(user)
        await self.session.flush()
        return user

    async def get_by_id(self, user_id: int) -> User | None:
        return await self.session.get(User, user_id)

    async def get_by_email_or_phone(self, identifier: str) -> User | None:
        result = await self.session.execute(select(User).where(or_(User.email == identifier, User.phone == identifier)))
        return result.scalar_one_or_none()

    async def search(self, query: str, exclude_user_id: int, limit: int = 20) -> list[User]:
        like = f"%{query}%"
        result = await self.session.execute(
            select(User)
            .where(User.id != exclude_user_id)
            .where(or_(User.name.ilike(like), User.email.ilike(like), User.phone.ilike(like)))
            .limit(limit)
        )
        return list(result.scalars().all())
