const WebSocket = require('ws');
const { notification: NotificationModel } = require('./models');
const { verifyToken } = require('./utils/token');

let wss = null;
let isListenerRegistered = false;
let heartbeatTimer = null;

// 按用户名保存在线连接。通知表当前使用 toName 标识接收人，所以这里也按 username 分组。
const clientsByUsername = new Map();

function getServer() {
  if (!wss) {
    wss = new WebSocket.Server({ port: 9998 });
  }
  return wss;
}

function parseQuery(req) {
  const query = {};
  const url = new URL(req.url || '/', 'ws://localhost');
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });
  return query;
}

function buildAuthRequest(req) {
  // 复用 HTTP token 校验逻辑，支持 Authorization header，也支持 ws://...?token=xxx。
  return {
    headers: req.headers || {},
    query: parseQuery(req),
    body: {},
    cookies: {},
  };
}

function sendJson(ws, payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

async function countUnreadByUsername(username) {
  if (!username) return 0;
  return NotificationModel.count({ where: { toName: username, read: 0 } });
}

async function sendUnreadCount(ws, username) {
  try {
    const unreadCount = await countUnreadByUsername(username);
    sendJson(ws, {
      type: 'noticeUnread',
      unreadCount,
    });
  } catch (err) {
    sendJson(ws, {
      type: 'noticeError',
      errorMessage: '获取未读通知数量失败',
    });
  }
}

function addClient(username, ws) {
  if (!clientsByUsername.has(username)) {
    clientsByUsername.set(username, new Set());
  }
  clientsByUsername.get(username).add(ws);
}

function removeClient(username, ws) {
  const clients = clientsByUsername.get(username);
  if (!clients) return;

  clients.delete(ws);
  if (clients.size === 0) {
    clientsByUsername.delete(username);
  }
}

function startHeartbeat(server) {
  if (heartbeatTimer) return;

  // 使用 ws 原生 ping/pong 做心跳，避免依赖前端传 cron 表达式定时轮询。
  heartbeatTimer = setInterval(() => {
    server.clients.forEach(ws => {
      if (ws.isAlive === false) {
        ws.terminate();
        return;
      }

      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);
}

async function pushNoticeUnread(toName) {
  const clients = clientsByUsername.get(toName);
  if (!clients || clients.size === 0) return;

  const unreadCount = await countUnreadByUsername(toName);
  clients.forEach(ws => {
    sendJson(ws, {
      type: 'noticeUnread',
      unreadCount,
    });
  });
}

module.exports.listener = () => {
  const server = getServer();
  if (isListenerRegistered) return;

  isListenerRegistered = true;
  startHeartbeat(server);

  server.on('connection', async (ws, req) => {
    const tokenResult = verifyToken(buildAuthRequest(req));

    if (!tokenResult.valid) {
      sendJson(ws, {
        type: 'authFailed',
        errorCode: tokenResult.errorCode,
        errorMessage: tokenResult.errorMessage,
      });
      ws.close(4001, 'auth failed');
      return;
    }

    const username = tokenResult.decoded && tokenResult.decoded.username;
    if (!username) {
      sendJson(ws, {
        type: 'authFailed',
        errorCode: 'TOKEN_USER_INVALID',
        errorMessage: '登录信息缺少用户标识，请重新登录',
      });
      ws.close(4001, 'auth failed');
      return;
    }

    ws.isAlive = true;
    ws.noticeUsername = username;
    addClient(username, ws);

    // 连接成功后立即推送一次未读数，前端无需再发送 toName/userId 订阅他人通知。
    await sendUnreadCount(ws, username);

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', async msg => {
      let payload = {};
      try {
        payload = JSON.parse(msg);
      } catch (err) {
        sendJson(ws, {
          type: 'noticeError',
          errorMessage: '消息格式错误',
        });
        return;
      }

      if (payload.type === 'ping') {
        sendJson(ws, { type: 'pong' });
        return;
      }

      // 兼容旧前端发送订阅消息，但后端只使用 token 中的用户身份查询未读数。
      await sendUnreadCount(ws, username);
    });

    ws.on('close', () => {
      removeClient(username, ws);
    });

    ws.on('error', () => {
      removeClient(username, ws);
    });
  });
};

module.exports.countUnreadByUsername = countUnreadByUsername;
module.exports.pushNoticeUnread = pushNoticeUnread;
