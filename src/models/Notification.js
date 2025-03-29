class Notification {
	/**
	 * @description this method must be implemented by the child classes
	 * @param {Object} data - The data of the message to be sent
	 * @throws {Error} If the method is not implemented
	 */
	sendMessage(_data) {
		throw new Error('the method sendMessage must be implemented');
	}
}

module.exports = Notification;
