from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.call import CallLog
from app.repositories.calls import CallRepository
from app.repositories.friends import FriendRepository

VALID_STATES = {"ringing", "accepted", "rejected", "ended", "missed"}


class CallService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.calls = CallRepository(session)
        self.friends = FriendRepository(session)

    async def start_call(self, caller_id: int, callee_id: int, call_type: str) -> CallLog:
        if call_type not in {"audio", "video"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid call type")
        if not await self.friends.are_friends(caller_id, callee_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only friends can call")
        call = await self.calls.create(caller_id, callee_id, call_type)
        await self.session.commit()
        await self.session.refresh(call)
        return call

    async def update_state(self, user_id: int, call_id: int, state: str) -> CallLog:
        if state not in VALID_STATES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid call state")
        call = await self.calls.get_for_participant(call_id, user_id)
        if not call:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Call not found")
        call = await self.calls.set_state(call, state)
        await self.session.commit()
        await self.session.refresh(call)
        return call

    async def list_history(self, user_id: int) -> list[CallLog]:
        return await self.calls.list_for_user(user_id)
