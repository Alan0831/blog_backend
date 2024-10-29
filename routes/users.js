const express = require('express');
const router = express.Router();
const { doLogin, doRegister, updateUser } = require('../controllers/user')

router.post('/doLogin', doLogin);
router.post('/doregister', doRegister);
router.post('/updateUser', updateUser);

module.exports = router
