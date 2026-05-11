from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.friends import FriendRepository


class FriendService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.friends = FriendRepository(session)

    async def send_request(self, sender_id: int, receiver_id: int):
        if sender_id == receiver_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot add yourself")
        if await self.friends.are_friends(sender_id, receiver_id):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already friends")
        existing = await self.friends.get_request_between(sender_id, receiver_id)
        if existing and existing.status == "pending":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Friend request already pending")
        request = await self.friends.create_request(sender_id, receiver_id)
        await self.session.commit()
        return request

    async def respond(self, request_id: int, receiver_id: int, accepted: bool):
        request = await self.friends.get_received_request(request_id, receiver_id)
        if not request or request.status != "pending":
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pending request not found")
        status_value = "accepted" if accepted else "rejected"
        await self.friends.set_request_status(request, status_value)
        if accepted:
            await self.friends.add_friendship_pair(request.sender_id, request.receiver_id)
        await self.session.commit()
        await self.session.refresh(request)
        return request

    async def list_friends(self, user_id: int):
        return await self.friends.list_friends(user_id)

    async def list_requests(self, user_id: int):
        return await self.friends.list_requests(user_id)

    async def remove_friend(self, user_id: int, friend_id: int) -> None:
        if not await self.friends.are_friends(user_id, friend_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Friendship not found")
        await self.friends.remove_friendship_pair(user_id, friend_id)
        await self.session.commit()

    async def assert_friends(self, user_id: int, friend_id: int) -> None:
        if not await self.friends.are_friends(user_id, friend_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only friends can perform this action")
