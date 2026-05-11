from datetime import datetime, timezone

from sqlalchemy import and_, delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.friendship import FriendRequest, Friendship
from app.models.user import User


class FriendRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def are_friends(self, user_id: int, friend_id: int) -> bool:
        result = await self.session.execute(
            select(Friendship.id).where(Friendship.user_id == user_id, Friendship.friend_id == friend_id)
        )
        return result.scalar_one_or_none() is not None

    async def get_request_between(self, sender_id: int, receiver_id: int) -> FriendRequest | None:
        result = await self.session.execute(
            select(FriendRequest).where(
                or_(
                    and_(FriendRequest.sender_id == sender_id, FriendRequest.receiver_id == receiver_id),
                    and_(FriendRequest.sender_id == receiver_id, FriendRequest.receiver_id == sender_id),
                )
            )
        )
        return result.scalar_one_or_none()

    async def create_request(self, sender_id: int, receiver_id: int) -> FriendRequest:
        request = FriendRequest(sender_id=sender_id, receiver_id=receiver_id)
        self.session.add(request)
        await self.session.flush()
        return request

    async def get_received_request(self, request_id: int, receiver_id: int) -> FriendRequest | None:
        result = await self.session.execute(
            select(FriendRequest).where(FriendRequest.id == request_id, FriendRequest.receiver_id == receiver_id)
        )
        return result.scalar_one_or_none()

    async def set_request_status(self, request: FriendRequest, status: str) -> FriendRequest:
        request.status = status
        request.responded_at = datetime.now(timezone.utc)
        await self.session.flush()
        return request

    async def add_friendship_pair(self, user_id: int, friend_id: int) -> None:
        self.session.add_all(
            [Friendship(user_id=user_id, friend_id=friend_id), Friendship(user_id=friend_id, friend_id=user_id)]
        )
        await self.session.flush()

    async def list_friends(self, user_id: int) -> list[tuple[Friendship, User]]:
        result = await self.session.execute(
            select(Friendship, User).join(User, User.id == Friendship.friend_id).where(Friendship.user_id == user_id)
        )
        return list(result.all())

    async def list_requests(self, user_id: int) -> list[FriendRequest]:
        result = await self.session.execute(
            select(FriendRequest).where(
                or_(FriendRequest.sender_id == user_id, FriendRequest.receiver_id == user_id)
            ).order_by(FriendRequest.created_at.desc())
        )
        return list(result.scalars().all())

    async def remove_friendship_pair(self, user_id: int, friend_id: int) -> None:
        await self.session.execute(
            delete(Friendship).where(
                or_(
                    and_(Friendship.user_id == user_id, Friendship.friend_id == friend_id),
                    and_(Friendship.user_id == friend_id, Friendship.friend_id == user_id),
                )
            )
        )
