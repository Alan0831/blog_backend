const log4js = require('log4js');
const moment = require('moment');
let today = moment().format('YYYY-MM-DD HH:mm:ss');

log4js.configure({
    appenders: {
        // 控制台输出
        out: {
            type: 'stdout',
            layout: {
                type: 'colored'
            }
        },
        //文件输出
        file: {
            filename: 'logs/server.log',
            pattern: 'yyyy-MM-dd.log',
            type: 'dateFile',
            level: "info" // 只记录info及以上级别的日志
        }
    },
    categories: {
        default: {
            appenders: ['out', 'file'],
            level: 'debug'
        },
    }
})

const logger = log4js.getLogger('commit-blog')
const LoggerMiddleware = (req, res, next) => {
    logger.debug(`[${req.method}] -- ${req.url}`);
    next();
}

module.exports = {
    LoggerMiddleware,
    logger,
}
