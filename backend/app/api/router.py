from fastapi import APIRouter

from app.api.routes import auth, calls, chat, friends, users

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(friends.router, prefix="/friends", tags=["friends"])
api_router.include_router(chat.router, prefix="/chat", tags=["chat"])
api_router.include_router(calls.router, prefix="/calls", tags=["calls"])
