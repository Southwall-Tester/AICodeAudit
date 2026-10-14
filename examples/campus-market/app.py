"""Campus Market API. Demonstration identity; not production authentication."""
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from services.items import create_item, list_items, toggle_favorite

app = FastAPI(title='Campus Market')
WEB = Path(__file__).parent / 'web'
app.mount('/static', StaticFiles(directory=WEB), name='static')


class ItemInput(BaseModel):
    title: str
    price: float


@app.get('/')
def home():
    return FileResponse(WEB / 'index.html')


@app.get('/api/items')
def browse_items():
    return list_items()


@app.post('/api/items')
def publish_item(data: ItemInput):
    try:
        return create_item(data.title, data.price, owner='demo-user')
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post('/api/items/{item_id}/favorite')
def favorite_item(item_id: str):
    # TODO: replace the fixed demo identity with verified user authentication.
    try:
        return {'favorite': toggle_favorite(item_id, 'demo-user')}
    except KeyError:
        raise HTTPException(status_code=404, detail='商品不存在') from None
