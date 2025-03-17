const express = require('express');
const router = express.Router();

const coreController = require('../controllers/core.controller');
const csvEnrichmentController = require('../controllers/csvEnrichment.controller');
router.get('/core/test', coreController.test);

//CSV Enrichment
router.post('/v2/core/csv', csvEnrichmentController.enrichCsv);

module.exports = router;
