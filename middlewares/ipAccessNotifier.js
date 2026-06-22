const nodemailer = require('nodemailer');
const { getClientIp, logger } = require('./logger');

const DEFAULT_ALLOWED_IP = '140.206.194.4';
const DEFAULT_COOLDOWN_MINUTES = 60;

function readBoolean(value, fallback = false) {
    if (value === undefined || value === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function readPositiveNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readConfig(env = process.env) {
    const smtpPort = readPositiveNumber(env.IP_ALERT_SMTP_PORT, 465);

    return {
        enabled: readBoolean(env.IP_ALERT_ENABLED),
        allowedIps: new Set(
            (env.IP_ALERT_ALLOWED_IPS || DEFAULT_ALLOWED_IP)
                .split(',')
                .map(ip => ip.trim())
                .filter(Boolean)
        ),
        cooldownMs: readPositiveNumber(
            env.IP_ALERT_COOLDOWN_MINUTES,
            DEFAULT_COOLDOWN_MINUTES
        ) * 60 * 1000,
        apiPrefix: env.IP_ALERT_API_PREFIX || '/commit/api',
        smtp: {
            host: env.IP_ALERT_SMTP_HOST || '',
            port: smtpPort,
            secure: readBoolean(env.IP_ALERT_SMTP_SECURE, smtpPort === 465),
            auth: {
                user: env.IP_ALERT_SMTP_USER || '',
                pass: env.IP_ALERT_SMTP_PASS || '',
            },
        },
        from: env.IP_ALERT_FROM || env.IP_ALERT_SMTP_USER || '',
        to: env.IP_ALERT_TO || '',
        subject: env.IP_ALERT_SUBJECT || '博客接口收到新 IP 访问',
    };
}

function validateConfig(config) {
    if (!config.enabled) return '';
    const missing = [];
    if (!config.smtp.host) missing.push('IP_ALERT_SMTP_HOST');
    if (!config.smtp.auth.user) missing.push('IP_ALERT_SMTP_USER');
    if (!config.smtp.auth.pass) missing.push('IP_ALERT_SMTP_PASS');
    if (!config.to) missing.push('IP_ALERT_TO');
    if (missing.length) return `IP 邮件提醒未启用，缺少配置: ${missing.join(', ')}`;
    return '';
}

function cleanHeader(value) {
    return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function buildMessage(req, ip, config, now) {
    const requestedAt = new Date(now).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour12: false,
    });
    const userAgent = cleanHeader(req.headers['user-agent']) || '未知';
    const referer = cleanHeader(req.headers.referer || req.headers.referrer) || '无';
    const url = cleanHeader(req.originalUrl || req.url);

    return {
        from: config.from,
        to: config.to,
        subject: cleanHeader(`${config.subject}: ${ip}`),
        text: [
            '检测到非白名单 IP 访问接口。',
            '',
            `IP: ${ip}`,
            `时间: ${requestedAt} (Asia/Shanghai)`,
            `请求: ${req.method} ${url}`,
            `User-Agent: ${userAgent}`,
            `Referer: ${referer}`,
            `Request ID: ${req.requestId || '无'}`,
            '',
            `该 IP 在 ${config.cooldownMs / 60000} 分钟内不会重复发送提醒。`,
        ].join('\n'),
    };
}

function createIpAccessNotifier(options = {}) {
    const config = options.config || readConfig();
    const now = options.now || Date.now;
    const log = options.logger || logger;
    const sendTimes = new Map();
    let transporter = options.transporter;
    const configError = validateConfig(config);

    if (configError) log.warn(configError);

    return function ipAccessNotifier(req, res, next) {
        if (!config.enabled || configError || req.method === 'OPTIONS') {
            next();
            return;
        }

        const path = req.originalUrl || req.url || '';
        if (!path.startsWith(config.apiPrefix)) {
            next();
            return;
        }

        const ip = getClientIp(req);
        if (!ip || config.allowedIps.has(ip)) {
            next();
            return;
        }

        const currentTime = now();
        const lastSentAt = sendTimes.get(ip) || 0;
        if (currentTime - lastSentAt < config.cooldownMs) {
            next();
            return;
        }

        // 发送前即进入冷却，SMTP 故障时也不会被每个请求反复触发。
        sendTimes.set(ip, currentTime);
        for (const [cachedIp, sentAt] of sendTimes) {
            if (currentTime - sentAt >= config.cooldownMs) sendTimes.delete(cachedIp);
        }

        if (!transporter) transporter = nodemailer.createTransport(config.smtp);
        transporter.sendMail(buildMessage(req, ip, config, currentTime))
            .then(() => log.info(`IP 邮件提醒发送成功: ${ip}`))
            .catch(err => log.error(`IP 邮件提醒发送失败: ${ip}, ${err.message}`));

        next();
    };
}

module.exports = {
    createIpAccessNotifier,
    IpAccessNotifier: createIpAccessNotifier(),
    readConfig,
};
