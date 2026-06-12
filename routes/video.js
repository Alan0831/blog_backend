const express = require('express');
const router = express.Router();
const { createVideo, getVideoList, findVideoById, getRecommendVideoList, deleteVideo, editVideo, uploadBigVideo, uploadChunks, mergeChunks, verify, getVideoProcessStatus } = require('../controllers/video');
const multer = require('multer');
const path = require('path');
const multipart = require("connect-multiparty");
// 所有上传的文件存放在该目录下
const UPLOADS_DIR = path.resolve("uploads/");
const multipartMiddleware = multipart({uploadDir: UPLOADS_DIR});



// 设置multer的存储配置
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, UPLOADS_DIR); // 确保这个文件夹已经存在
    },
    filename: function (req, file, cb) {
      cb(null, file.fieldname + '-' + Date.now());
    }
  })
  const upload = multer({ storage: storage });

router.post('/createVideo', createVideo);
router.post('/getVideoList', getVideoList);
router.post('/findVideoById', findVideoById);
router.post('/getRecommendVideoList', getRecommendVideoList);
router.post('/deleteVideo', deleteVideo);
router.post('/editVideo', editVideo);
router.post('/mergeChunks', mergeChunks);
router.post('/verify', verify);
router.post('/getVideoProcessStatus', getVideoProcessStatus);
router.post('/uploadBigVideo', upload.single('file'), uploadBigVideo);
router.post('/uploadChunks', multipartMiddleware, uploadChunks);

module.exports = router
