from dataclasses import dataclass, field
from uuid import uuid4


@dataclass
class Item:
    title: str
    price: float
    owner: str
    id: str = field(default_factory=lambda: uuid4().hex[:12])
