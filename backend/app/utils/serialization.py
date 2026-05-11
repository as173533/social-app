from datetime import datetime
from typing import Any


def jsonable_model(model: Any) -> dict[str, Any]:
    data: dict[str, Any] = {}
    for key, value in model.__dict__.items():
        if key.startswith("_"):
            continue
        data[key] = value.isoformat() if isinstance(value, datetime) else value
    return data
