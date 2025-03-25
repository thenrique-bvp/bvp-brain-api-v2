class CoreController {
	async sendErrorMessage(req, res) {
		try {
			const { service, method, error, details } = req.body;

			if (!service || !method || !error) {
				return res.status(400).json({
					status: 'error',
					message: 'Missing required fields: service, method, error'
				});
			}

			const errorLogService = require('../services/errorLog.service');
			const result = await errorLogService.sendMessage({
				service,
				method,
				error,
				details
			});

			return res.status(200).json({
				status: 'success',
				message: 'Error message sent successfully',
				data: result
			});
		} catch (err) {
			return res.status(500).json({
				status: 'error',
				message: err.message
			});
		}
	}
}

module.exports = new CoreController();
