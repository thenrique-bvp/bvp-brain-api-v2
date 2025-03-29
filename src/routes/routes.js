const express = require('express');
const router = express.Router();
const multer = require('multer');
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const csvEnrichmentController = require('../controllers/csvEnrichment.controller');
const salesforceController = require('../controllers/salesforce.controller');
const notificationController = require('../controllers/notification.controller');

//Core
router.post('/core/error', notificationController.errorMessageFromSNS);

//Salesforce
router.get('/salesforce/check_company', salesforceController.checkCompany);

//CSV Enrichment
router.post('/core/csv', upload.single('file'), csvEnrichmentController.enrichCsv);

//Notification
router.post('/notification/slack', notificationController.errorMessageFromSlack);
router.post('/notification/sns', notificationController.errorMessageFromSNS);

module.exports = router;
