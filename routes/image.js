const express = require('express');
const router = express.Router();
const { uploadImage, uploadVideo } = require('../controllers/image');
const multer = require('multer');
const MAO = require('multer-aliyun-oss');
const { ALIOSS } = require('../config');

function ossConfig() {
    return {
        region: ALIOSS.region,
        accessKeyId: ALIOSS.accessKeyId,
        accessKeySecret: ALIOSS.accessKeySecret,
        bucket: ALIOSS.bucket,
    };
}

function uploadErrorHandler(type) {
    return (err, req, res, next) => {
        if (!err) {
            return next();
        }

        const errorCode = err.code || err.name;
        let errorMessage = `${type}上传失败`;

        if (errorCode === 'InvalidAccessKeyIdError' || /Access Key Id.*disabled/i.test(err.message || '')) {
            errorMessage = 'OSS AccessKey 已被禁用，请更换有效的阿里云 AccessKey 配置';
        } else if (!ALIOSS.accessKeyId || !ALIOSS.accessKeySecret) {
            errorMessage = 'OSS AccessKey 未配置，请设置 ALIBABA_CLOUD_ACCESS_KEY_ID 和 ALIBABA_CLOUD_ACCESS_KEY_SECRET';
        }

        res.status(err.status || 500).json({
            status: 'error',
            data: {},
            errorMessage,
            errorCode,
        });
    };
}

function runUpload(uploadMiddleware, type) {
    return (req, res, next) => {
        if (!ALIOSS.accessKeyId || !ALIOSS.accessKeySecret) {
            return res.status(500).json({
                status: 'error',
                data: {},
                errorMessage: 'OSS AccessKey 未配置，请设置 ALIBABA_CLOUD_ACCESS_KEY_ID 和 ALIBABA_CLOUD_ACCESS_KEY_SECRET',
            });
        }

        uploadMiddleware(req, res, (err) => uploadErrorHandler(type)(err, req, res, next));
    };
}

const upload = multer({
    storage: MAO({
        config: ossConfig(),
        destination: 'uploads'
    })
});

const _upload = multer({
    storage: MAO({
        config: ossConfig(),
        destination: 'videos'
    })
});

// const storage = multer.diskStorage({
//     destination: function (req, file, cb) {
//       cb(null, 'uploads/'); // 上传的文件将保存在uploads文件夹中
//     },
//     filename: function (req, file, cb) {
//       cb(null, file.originalname); // 保留原始文件名
//     }
// });
// const storage = multer.memoryStorage(); // 可以使得文件在内存中处理，不存储到本地

// const upload = multer({ storage: storage });

router.post('/uploadImage', runUpload(upload.single('file'), '图片'), uploadImage);
router.post('/uploadVideo', runUpload(_upload.single('file'), '视频'), uploadVideo);

module.exports = router
