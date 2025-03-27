const { salesforceApi } = require('../services/salesforce.service');

class SalesforceController {
	async checkCompany(req, res) {
		try {
			const name = req.query.name;
			const website = req.query.website;

			if (!name && !website) {
				return res.status(400).json({
					status: 'error',
					message: 'Name or website is required'
				});
			}

			const { sfId, source } = await salesforceApi.salesforceIdFinal(name, website);

			if (sfId) {
				return res.json({
					SalesforceID: sfId,
					Source: source
				});
			}

			return res.json({
				message: 'Company not found'
			});
		} catch (error) {
			debugger;
			return res.status(500).json({
				status: 'error',
				message: error.message
			});
		}
	}
}

module.exports = new SalesforceController();
