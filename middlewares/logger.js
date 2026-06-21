const log4js = require('log4js');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const { getTokenFromRequest } = require('../utils/token');
const jwt = require('jsonwebtoken');

const MAX_STRING_LENGTH = 300;
const MAX_ARRAY_LENGTH = 20;
const MAX_OBJECT_KEYS = 60;
const MAX_DEPTH = 4;
const REDACTED = '[REDACTED]';
const SENSITIVE_KEYS = new Set([
    'authorization',
    'cookie',
    'password',
    'oldpassword',
    'newpassword',
    'confirmpassword',
    'token',
    'access_token',
    'refresh_token',
    'secret',
    'accesskeysecret',
    'accesskeyid',
    'key',
]);
const LOG_ACCESS_SUCCESS = readBooleanEnv('LOG_ACCESS_SUCCESS', false);
const LOG_ACCESS_START = readBooleanEnv('LOG_ACCESS_START', false);
const LOG_ACCESS_BODY = readBooleanEnv('LOG_ACCESS_BODY', false);
const LOG_SLOW_REQUEST_MS = readPositiveInt(process.env.LOG_SLOW_REQUEST_MS, 2000);

log4js.configure({
    appenders: {
        out: {
            type: 'stdout',
            layout: { type: 'colored' },
        },
        file: {
            filename: 'logs/server.log',
            pattern: 'yyyy-MM-dd.log',
            type: 'dateFile',
            level: 'info',
        },
    },
    categories: {
        default: {
            appenders: ['out', 'file'],
            level: 'debug',
        },
    },
});

const baseLogger = log4js.getLogger('commit-blog');
const requestStore = new AsyncLocalStorage();

function readBooleanEnv(name, fallback) {
    const value = process.env[name];
    if (value === undefined) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function readPositiveInt(value, fallback) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createRequestId() {
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return crypto.randomBytes(16).toString('hex');
}

function normalizeIp(ip) {
    if (!ip) return '';
    const value = String(ip).trim();
    if (!value) return '';
    if (value === '::1') return '127.0.0.1';
    if (value.startsWith('::ffff:')) return value.slice(7);
    return value;
}

function firstHeaderValue(value) {
    if (Array.isArray(value)) return value[0];
    if (!value) return '';
    return String(value).split(',')[0].trim();
}

function getClientIp(req) {
    return normalizeIp(
        firstHeaderValue(req.headers['cf-connecting-ip']) ||
        firstHeaderValue(req.headers['x-real-ip']) ||
        firstHeaderValue(req.headers['x-forwarded-for']) ||
        req.ip ||
        (Array.isArray(req.ips) && req.ips[0]) ||
        (req.connection && req.connection.remoteAddress) ||
        (req.socket && req.socket.remoteAddress)
    );
}

function isSensitiveKey(key) {
    return SENSITIVE_KEYS.has(String(key).toLowerCase());
}

function sanitize(value, depth = 0) {
    if (value === null || value === undefined) return value;
    if (depth > MAX_DEPTH) return '[MaxDepth]';

    if (typeof value === 'string') {
        return value.length > MAX_STRING_LENGTH
            ? `${value.slice(0, MAX_STRING_LENGTH)}...[truncated:${value.length}]`
            : value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (value instanceof Date) return value.toISOString();

    if (Array.isArray(value)) {
        const result = value.slice(0, MAX_ARRAY_LENGTH).map(item => sanitize(item, depth + 1));
        if (value.length > MAX_ARRAY_LENGTH) result.push(`[truncated:${value.length - MAX_ARRAY_LENGTH}]`);
        return result;
    }

    if (typeof value === 'object') {
        if (value.buffer || value.stream || value.path) {
            return summarizeFile(value);
        }

        const result = {};
        const keys = Object.keys(value).slice(0, MAX_OBJECT_KEYS);
        keys.forEach((key) => {
            result[key] = isSensitiveKey(key) ? REDACTED : sanitize(value[key], depth + 1);
        });
        if (Object.keys(value).length > MAX_OBJECT_KEYS) {
            result.__truncatedKeys = Object.keys(value).length - MAX_OBJECT_KEYS;
        }
        return result;
    }

    return String(value);
}

function summarizeFile(file) {
    return {
        fieldname: file.fieldname,
        originalname: file.originalname || file.name,
        filename: file.filename,
        mimetype: file.mimetype || file.type,
        size: file.size,
        path: file.path,
    };
}

function getFilesSummary(req) {
    if (!req.file && !req.files) return undefined;
    if (req.file) return sanitize(req.file);
    return sanitize(req.files);
}

function compactObject(value) {
    if (!value || typeof value !== 'object') return undefined;
    return Object.keys(value).length ? value : undefined;
}

function getBodySummary(req) {
    if (!req.body || typeof req.body !== 'object') return undefined;
    const contentType = req.headers['content-type'] || '';
    if (/multipart\/form-data/i.test(contentType)) {
        return {
            fields: sanitize(req.body),
            files: getFilesSummary(req),
        };
    }
    return sanitize(req.body);
}

function pickFirst(...values) {
    return values.find(value => value !== undefined && value !== null && value !== '');
}

function readCandidateUser(req) {
    const body = req.body || {};
    const query = req.query || {};
    const user = req.user || {};
    const decodedToken = getDecodedToken(req);

    const id = pickFirst(
        user.userId,
        user.id,
        decodedToken.userId,
        decodedToken.id,
        body.userId,
        body.authorId,
        body.owner,
        query.userId,
        query.authorId,
        query.owner
    );

    let source = 'anonymous';
    if (pickFirst(user.userId, user.id)) source = 'verifiedToken';
    else if (pickFirst(decodedToken.userId, decodedToken.id)) source = 'tokenPayload';
    else if (pickFirst(body.userId, body.authorId, body.owner)) source = 'requestBody';
    else if (pickFirst(query.userId, query.authorId, query.owner)) source = 'query';

    return {
        userId: id || '',
        username: pickFirst(user.username, decodedToken.username, body.username, query.username, ''),
        role: pickFirst(user.role, decodedToken.role, ''),
        source,
    };
}

function getDecodedToken(req) {
    const token = getTokenFromRequest(req);
    if (!token) return {};
    try {
        return jwt.decode(token) || {};
    } catch (err) {
        return {};
    }
}

function buildRequestLog(req, extra = {}) {
    const user = readCandidateUser(req);
    return {
        event: extra.event,
        requestId: req.requestId,
        method: req.method,
        url: req.originalUrl || req.url,
        path: req.path,
        statusCode: resStatus(extra),
        durationMs: extra.durationMs,
        ip: getClientIp(req),
        forwardedFor: firstHeaderValue(req.headers['x-forwarded-for']),
        remoteAddress: normalizeIp(req.socket && req.socket.remoteAddress),
        userId: user.userId,
        username: user.username,
        role: user.role,
        userSource: user.source,
        authError: req.authError,
        userAgent: req.headers['user-agent'] || '',
        referer: req.headers.referer || req.headers.referrer || '',
        origin: req.headers.origin || '',
        contentType: req.headers['content-type'] || '',
        contentLength: req.headers['content-length'] || '',
        query: compactObject(sanitize(req.query || {})),
        params: compactObject(sanitize(req.params || {})),
        body: extra.includeBody ? compactObject(getBodySummary(req)) : undefined,
        files: extra.includeBody ? getFilesSummary(req) : undefined,
        responseLength: extra.responseLength,
        errorMessage: extra.errorMessage,
    };
}

function resStatus(extra) {
    return extra.statusCode === undefined ? undefined : extra.statusCode;
}

function stringifyLog(data) {
    return JSON.stringify(data, (key, value) => value === undefined ? undefined : value);
}

function buildLogContext(req) {
    const user = readCandidateUser(req);
    return {
        requestId: req.requestId,
        method: req.method,
        url: req.originalUrl || req.url,
        ip: getClientIp(req),
        userId: user.userId,
        username: user.username,
        role: user.role,
        userSource: user.source,
    };
}

function getCurrentLogContext() {
    const store = requestStore.getStore();
    if (!store) return null;
    if (store.req) return buildLogContext(store.req);
    return store.context || null;
}

function buildBusinessLog(context, args) {
    const [message, ...rest] = args;
    return {
        event: 'business',
        requestId: context.requestId,
        method: context.method,
        url: context.url,
        ip: context.ip,
        userId: context.userId,
        username: context.username,
        role: context.role,
        userSource: context.userSource,
        message: formatBusinessMessage(message, context),
        data: rest.length ? sanitize(rest) : undefined,
    };
}

function formatBusinessMessage(message, context) {
    if (typeof message !== 'string') return sanitize(message);
    if (!context.userId) return message;

    return message
        .replace(/userId为[:：]\s*(?=[,，])/g, `userId为:${context.userId}`)
        .replace(/用户ID[:：]\s*(?=[,，])/g, `用户ID:${context.userId}`)
        .replace(/用户[:：]\s*(?=[,，])/g, `用户:${context.userId}`);
}

function shouldKeepRaw(args) {
    if (!args.length || typeof args[0] !== 'string') return false;
    const text = args[0].trim();
    return text.startsWith('{"event":"request.') || text.startsWith('{"event":"business"');
}

function createContextLogger(sourceLogger) {
    const contextLogger = Object.create(sourceLogger);
    ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'mark'].forEach((level) => {
        if (typeof sourceLogger[level] !== 'function') return;
        contextLogger[level] = (...args) => {
            const context = getCurrentLogContext();
            if (!context || shouldKeepRaw(args)) {
                sourceLogger[level](...args);
                return;
            }
            sourceLogger[level](stringifyLog(buildBusinessLog(context, args)));
        };
    });
    return contextLogger;
}

const logger = createContextLogger(baseLogger);

function shouldLogAccess(statusCode, durationMs) {
    return LOG_ACCESS_SUCCESS || statusCode >= 400 || durationMs >= LOG_SLOW_REQUEST_MS;
}

const LoggerMiddleware = (req, res, next) => {
    req.requestId = req.headers['x-request-id'] || createRequestId();
    res.setHeader('X-Request-Id', req.requestId);

    const startedAt = process.hrtime.bigint();

    const store = { req, context: null };

    requestStore.run(store, () => {
        if (LOG_ACCESS_START) {
            baseLogger.info(stringifyLog(buildRequestLog(req, {
                event: 'request.start',
            })));
        }

        res.on('finish', () => {
            const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
            const roundedDurationMs = Number(durationMs.toFixed(2));
            if (shouldLogAccess(res.statusCode, roundedDurationMs)) {
                const payload = buildRequestLog(req, {
                    event: 'request.finish',
                    statusCode: res.statusCode,
                    durationMs: roundedDurationMs,
                    includeBody: LOG_ACCESS_BODY,
                    responseLength: res.getHeader('content-length') || '',
                });
                const level = res.statusCode >= 500 ? 'error' : (res.statusCode >= 400 ? 'warn' : 'info');
                baseLogger[level](stringifyLog(payload));
            }
            store.context = buildLogContext(req);
            store.req = null;
        });

        res.on('close', () => {
            if (!res.writableEnded) {
                const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
                baseLogger.warn(stringifyLog(buildRequestLog(req, {
                    event: 'request.aborted',
                    statusCode: res.statusCode,
                    durationMs: Number(durationMs.toFixed(2)),
                    includeBody: LOG_ACCESS_BODY,
                })));
                store.context = buildLogContext(req);
                store.req = null;
            }
        });

        next();
    });
};

module.exports = {
    LoggerMiddleware,
    logger,
    getClientIp,
    sanitize,
};
