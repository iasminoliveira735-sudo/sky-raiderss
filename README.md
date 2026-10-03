# Sky Raiders — GitHub + Render

## GitHub
Envie `index.html` para o repositório do jogo.

## Render
O servidor multiplayer está em `server/` e usa WebSocket.

- `server/package.json`
- `server/server.js`
- `render.yaml`

Depois do deploy, o Render fornecerá uma URL como `https://sky-raiders-multiplayer.onrender.com`.
Para WebSocket, use `wss://sky-raiders-multiplayer.onrender.com` no jogo.

## Configuração do jogo
No `index.html`, a variável `SKY_RAIDERS_SERVER` pode ser definida antes do script principal:

```html
<script>
window.SKY_RAIDERS_SERVER = 'wss://SEU-SERVIDOR.onrender.com';
</script>
```

Substitua pela URL WebSocket real do seu serviço Render.
