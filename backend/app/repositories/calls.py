from datetime import datetime, timezone

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.call import CallLog


class CallRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, caller_id: int, callee_id: int, call_type: str) -> CallLog:
        call = CallLog(caller_id=caller_id, callee_id=callee_id, call_type=call_type, state="ringing")
        self.session.add(call)
        await self.session.flush()
        return call

    async def get_for_participant(self, call_id: int, user_id: int) -> CallLog | None:
        result = await self.session.execute(
            select(CallLog).where(
                CallLog.id == call_id,
                or_(CallLog.caller_id == user_id, CallLog.callee_id == user_id),
            )
        )
        return result.scalar_one_or_none()

    async def set_state(self, call: CallLog, state: str) -> CallLog:
        call.state = state
        now = datetime.now(timezone.utc)
        if state == "accepted":
            call.answered_at = now
        if state in {"rejected", "ended", "missed"}:
            call.ended_at = now
        await self.session.flush()
        return call

    async def list_active_for_user(self, user_id: int) -> list[CallLog]:
        result = await self.session.execute(
            select(CallLog)
            .where(
                and_(
                    or_(CallLog.caller_id == user_id, CallLog.callee_id == user_id),
                    CallLog.state.in_(("ringing", "accepted")),
                )
            )
            .order_by(CallLog.started_at.desc())
        )
        return list(result.scalars().all())

    async def list_for_user(self, user_id: int) -> list[CallLog]:
        result = await self.session.execute(
            select(CallLog)
            .where(or_(CallLog.caller_id == user_id, CallLog.callee_id == user_id))
            .order_by(CallLog.started_at.desc())
        )
        return list(result.scalars().all())
