const Notification = require('./Notification');
const snsService = require('../services/notification/sns.service');
class SnsNotification extends Notification {
	sendMessage(data) {
		snsService.sendMessage(data);
	}
}

module.exports = new SnsNotification();
