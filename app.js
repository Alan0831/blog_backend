var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
// var logger = require('morgan');
const loadRouter = require('./routes');
const bodyParser = require('body-parser');
const websocketServer = require('./websocket')
const {LoggerMiddleware} = require('./middlewares/logger.js');

var app = express();
app.set('trust proxy', true);

function setVideoHeaders(res, filePath) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Origin, Accept');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

  if (filePath.endsWith('.m3u8')) {
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  } else if (filePath.endsWith('.ts')) {
    res.setHeader('Content-Type', 'video/mp2t');
  } else if (filePath.endsWith('.mp4')) {
    res.setHeader('Content-Type', 'video/mp4');
  }
}

// moddlewares
const authHandler = require('./middlewares/authHandler')

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

// app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.options('/videoPath/*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Origin, Accept');
  res.sendStatus(204);
});
app.use('/videoPath', express.static(path.join(__dirname, 'static/video'), {
  index: false,
  setHeaders: setVideoHeaders,
}));
app.use(LoggerMiddleware);
app.use(authHandler);

loadRouter(app)
// app.use('/', user);

// catch 404 and forward to error handler
// app.use(function(req, res, next) {
//   next(createError(404));
// });

// error handler
app.use(function(err, req, res, next) {
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

// 监听开启的websocket服务器

websocketServer.listener();

module.exports = app;
