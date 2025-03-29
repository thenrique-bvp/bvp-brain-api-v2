const SlackNotification = require('../models/SlackNotification');
const errorSnsService = require('../services/notification/sns.service');
const { sendNotificationsMock } = require('../mocks');

class NotificationController {
	/**
	 * @description Send error message from Slack
	 * @param {Object} req - The request object
	 * @param {Object} res - The response object
	 * @returns {Object} The response object
	 */
	async errorMessageFromSlack(req, res) {
		try {
			const data = req.body;

			// const slackService = await SlackNotification.sendMessage(data);
			const slackService = await sendNotificationsMock();

			return res
				.status(200)
				.json({ status: 'success', message: 'Message sent successfully', data: slackService });
		} catch (err) {
			return res.status(500).json({ status: 'error', message: err.message });
		}
	}
	/**
	 * @description Send error message from SNS
	 * @param {Object} req - The request object
	 * @param {Object} res - The response object
	 * @returns {Object} The response object
	 */
	async errorMessageFromSNS(req, res) {
		try {
			const { service, method, error, details } = req.body;

			if (!service || !method || !error) {
				return res.status(400).json({
					status: 'error',
					message: 'Missing required fields: service, method, error'
				});
			}

			const result = await errorSnsService.sendMessage({
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

module.exports = new NotificationController();
