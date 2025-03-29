const slackService = require('../services/notification/slack.service');
const Notification = require('./Notification');

class SlackNotification extends Notification {
	async sendMessage(data) {
		return await slackService.notifySlack(data);
	}
}

module.exports = new SlackNotification();
