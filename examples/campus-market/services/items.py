"""In-memory catalog. Prices must be finite, nonnegative numbers."""
import math
from dataclasses import asdict

from models.item import Item

_items: dict[str, Item] = {}
_favorites: set[tuple[str, str]] = set()


def list_items():
    return [asdict(item) for item in _items.values()]


def create_item(title: str, price: float, owner: str):
    title = title.strip()
    if not title or len(title) > 80:
        raise ValueError('标题长度应为 1–80 个字符')
    if not math.isfinite(price) or price < 0:
        raise ValueError('价格应为非负有限数')
    item = Item(title=title, price=price, owner=owner)
    _items[item.id] = item
    return asdict(item)


def toggle_favorite(item_id: str, user_id: str):
    if item_id not in _items:
        raise KeyError(item_id)
    key = (user_id, item_id)
    if key in _favorites:
        _favorites.remove(key)
        return False
    _favorites.add(key)
    return True
