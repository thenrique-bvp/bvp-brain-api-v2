const express = require('express');
const router = express.Router();

const coreController = require('../controllers/coreController');

router.get('/core/test', coreController.test);

module.exports = router;
