from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_session
from app.models.user import User
from app.schemas.call import CallLogOut
from app.services.calls import CallService

router = APIRouter()


@router.get("/history", response_model=list[CallLogOut])
async def call_history(current_user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    return await CallService(session).list_history(current_user.id)
