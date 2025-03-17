const express = require('express');
const router = express.Router();

const coreController = require('../controllers/coreController');

router.get('/core', coreController.getAllItems);

module.exports = router;
