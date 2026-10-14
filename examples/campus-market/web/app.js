import { request } from './api.js';

const status = document.querySelector('#status');
async function refresh() {
    const items = await request('/items');
    const list = document.querySelector('#items');
    list.replaceChildren();
    for (const item of items) {
        const article = document.createElement('article');
        const title = document.createElement('strong');
        title.textContent = `${item.title} · ¥${item.price}`;
        const button = document.createElement('button');
        button.textContent = '切换收藏';
        button.onclick = async () => {
            try {
                const result = await request(`/items/${item.id}/favorite`, {});
                status.textContent = result.favorite ? '已收藏' : '已取消收藏';
            } catch (error) { status.textContent = error.message; }
        };
        article.append(title, button);
        list.append(article);
    }
}
document.querySelector('#publish').onsubmit = async event => {
    event.preventDefault();
    const data = new FormData(event.target);
    try {
        await request('/items', {title: data.get('title'), price: Number(data.get('price'))});
        event.target.reset();
        await refresh();
        status.textContent = '商品已发布';
    } catch (error) { status.textContent = error.message; }
};
refresh().catch(error => { status.textContent = error.message; });
