export async function request(path, data) {
    const response = await fetch('/api' + path, data === undefined ? {} : {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || '请求失败');
    return result;
}
