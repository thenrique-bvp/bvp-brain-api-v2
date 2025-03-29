const { default: axios } = require('axios');

// Example usage with different event types:
const eventExamples = [
	{
		action: 'ERROR',
		eventType: 'RATE_LIMIT_EXCEEDED',
		title: 'Rate Limit Exceeded',
		message:
			'The API rate limit has been exceeded. This could impact service availability. Please reduce request frequency or increase limits if needed.',
		fields: {
			endpoint: '/api/users',
			requestsPerMinute: 1000,
			limit: 500,
			clientIP: '192.168.1.1'
		}
	},
	{
		action: 'ERROR',
		eventType: 'DATABASE_CONNECTION_FAILED',
		title: 'Database Connection Failed',
		message:
			'Critical database connection failure detected. Automatic retry attempts were unsuccessful. Immediate investigation required.',
		fields: {
			error: 'Connection timeout',
			database: 'users_db',
			retries: 3,
			stackTrace: 'Error: Connection timeout\n    at Database.connect (/app/db.js:15:7)',
			affectedServices: ['auth', 'users', 'payments']
		}
	},
	{
		action: 'WARNING',
		eventType: 'HIGH_MEMORY_USAGE',
		title: 'High Memory Usage',
		message:
			'System memory usage has reached concerning levels. Consider investigating memory leaks or scaling resources if trend continues.',
		fields: {
			usedMemory: '85%',
			totalMemory: '16GB',
			process: 'API Server'
		}
	},
	{
		action: 'INFO',
		eventType: 'SERVICE_STATUS_UPDATE',
		title: 'Service Status Update',
		message: 'Regular status check completed. All systems are functioning normally with excellent uptime metrics.',
		fields: {
			service: 'Payment Gateway',
			status: 'Operational',
			uptime: '99.99%'
		}
	},
	// New example: Job completed successfully
	{
		action: 'SUCCESS',
		eventType: 'JOB_COMPLETED',
		title: 'Job Completed Successfully',
		message: 'The processing job was completed within the expected time and without errors.',
		fields: {
			jobName: 'twitter-tracker',
			origin: 'Scheduler',
			duration: '45 seconds',
			recordsProcessed: 1250,
			environment: 'production',
			nextExecution: '2023-05-15T08:00:00Z'
		}
	},
	// New example: Job with error
	{
		action: 'ERROR',
		eventType: 'JOB_FAILED',
		title: 'Job Execution Failed',
		message: 'The job failed during execution and requires immediate attention.',
		fields: {
			jobName: 'pipeline-tracking',
			origin: 'Manual Trigger',
			stackTrace:
				'Error: Request failed with status code 503\n    at createError (/app/node_modules/axios/lib/core/createError.js:16:15)\n    at settle (/app/node_modules/axios/lib/core/settle.js:17:12)',
			lastSuccessfulRun: '2023-05-12T08:00:00Z',
			affectedSystems: ['billing', 'reports'],
			recommendation: 'Check payment provider status and restart the job manually after resolving the issue'
		}
	}
];
class SlackService {
	async notifySlack(data) {
		const webhookUrl = 'https://hooks.slack.com/services/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';
		if (!webhookUrl) {
			console.log('SLACK_WEBHOOK_URL not configured. Notification not sent.');
			return;
		}

		// Ensure we have a valid action
		if (!['SUCCESS', 'WARNING', 'ERROR', 'INFO'].includes(data.action)) {
			data.action = 'INFO';
		}

		try {
			const message = this.formatSlackMessage(data);
			await axios.post(webhookUrl, message);
			console.log(`Notification sent to Slack: ${data.title}`);
		} catch (error) {
			console.error(`Error sending notification to Slack: ${error.message}`);
		}
	}

	/**
	 * Format message for Slack based on action type
	 * @param {Object} data - Notification data
	 * @param {string} data.action - Action type (SUCCESS, WARNING, ERROR, INFO)
	 * @param {string} data.title - Message title
	 * @param {string} data.eventType - Type of event
	 * @param {Object} data.fields - Fields to display
	 * @returns {Object} - Formatted Slack message
	 */
	formatSlackMessage = (data) => {
		// Define action properties (emoji and color)
		const actions = {
			SUCCESS: {
				color: '#36a64f', // Green
				headerEmoji: '✅'
			},
			WARNING: {
				color: '#f2c744', // Yellow/Amber
				headerEmoji: '⚠️'
			},
			ERROR: {
				color: '#FF0000', // Red
				headerEmoji: '🚨'
			},
			INFO: {
				color: '#0000FF', // Blue
				headerEmoji: 'ℹ️'
			}
		};

		// Get the appropriate action properties (with fallback to INFO)
		const actionProps = actions[data.action] || actions.INFO;
		const { color, headerEmoji } = actionProps;

		// Create the blocks array that will form our message
		const blocks = [];

		// Adicionar menção ao canal para notificações de ERROR
		if (data.action === 'ERROR') {
			blocks.push({
				type: 'section',
				text: {
					type: 'mrkdwn',
					text: '<!channel> Guys, we have a problem here! 🚨 🧠'
				}
			});
		}

		// Add header block with title
		blocks.push({
			type: 'header',
			text: {
				type: 'plain_text',
				text: `${headerEmoji} ${data.title}`,
				emoji: true
			}
		});

		// Add message block if provided
		if (data.message) {
			blocks.push({
				type: 'section',
				text: {
					type: 'plain_text',
					text: data.message,
					emoji: true
				}
			});
		}

		// Add source and timestamp section
		blocks.push({
			type: 'section',
			fields: [
				{
					type: 'mrkdwn',
					text: `*Source:*\n ${data.source || 'bvp-brain-api'}`
				},
				{
					type: 'mrkdwn',
					text: `*Timestamp:*\n ${new Date().toLocaleString('en-US', {
						month: '2-digit',
						day: '2-digit',
						year: 'numeric',
						hour: '2-digit',
						minute: '2-digit',
						hour12: false
					})}`
				}
			]
		});

		if (data.method) {
			blocks.push({
				type: 'section',
				fields: [
					{
						type: 'mrkdwn',
						text: `*Method:*\n${data.method}`
					}
				]
			});
		}

		if (data.error) {
			blocks.push({
				type: 'section',
				text: {
					type: 'mrkdwn',
					text: `*Error:*\n \`${data.error}\``
				}
			});
		}

		if (data.details) {
			let detailsText;
			if (typeof data.details === 'object') {
				detailsText = `*Details:*\n\`\`\`\n${JSON.stringify(data.details, null, 2)}\n\`\`\``;
			} else {
				detailsText = `*Details:*\n${data.details}`;
			}

			// Verificar se existem fields para associar aos details
			if (data.fields && typeof data.fields === 'object' && Object.keys(data.fields).length > 0) {
				// Convert field entries to array for easier processing
				const fieldEntries = Object.entries(data.fields);
				const fieldsForSection = [];

				// Processar apenas os primeiros dois campos para essa seção
				for (let i = 0; i < Math.min(fieldEntries.length, 2); i++) {
					const [key, value] = fieldEntries[i];
					const capitalizedKey = key.charAt(0).toUpperCase() + key.slice(1);
					let formattedValue;
					if (typeof value === 'object') {
						formattedValue = JSON.stringify(value);
					} else {
						formattedValue = String(value);
					}

					fieldsForSection.push({
						type: 'mrkdwn',
						text: `*${capitalizedKey}:*\n${formattedValue}`
					});
				}

				// Adicionar seção combinando details e primeiros dois fields
				blocks.push({
					type: 'section',
					text: {
						type: 'mrkdwn',
						text: detailsText
					},
					fields: fieldsForSection
				});

				// Se houver mais campos, processá-los em pares como antes (começando do terceiro campo)
				if (fieldEntries.length > 2) {
					for (let i = 2; i < fieldEntries.length; i += 2) {
						const [key1, value1] = fieldEntries[i];
						const capitalizedKey1 = key1.charAt(0).toUpperCase() + key1.slice(1);
						let formattedValue1;
						if (typeof value1 === 'object') {
							formattedValue1 = JSON.stringify(value1);
						} else {
							formattedValue1 = String(value1);
						}

						if (i + 1 < fieldEntries.length) {
							const [key2, value2] = fieldEntries[i + 1];
							const capitalizedKey2 = key2.charAt(0).toUpperCase() + key2.slice(1);
							let formattedValue2;
							if (typeof value2 === 'object') {
								formattedValue2 = JSON.stringify(value2);
							} else {
								formattedValue2 = String(value2);
							}

							blocks.push({
								type: 'section',
								fields: [
									{
										type: 'mrkdwn',
										text: `*${capitalizedKey1}:*\n${formattedValue1}`
									},
									{
										type: 'mrkdwn',
										text: `*${capitalizedKey2}:*\n${formattedValue2}`
									}
								]
							});
						} else {
							blocks.push({
								type: 'section',
								fields: [
									{
										type: 'mrkdwn',
										text: `*${capitalizedKey1}:*\n${formattedValue1}`
									}
								]
							});
						}
					}
				}
			} else {
				// Se não houver fields, apenas mostrar os details sem o campo fields no objeto
				blocks.push({
					type: 'section',
					text: {
						type: 'mrkdwn',
						text: detailsText
					}
				});
			}
		} else if (data.fields && typeof data.fields === 'object' && Object.keys(data.fields).length > 0) {
			// Se não houver details mas houver fields, processar todos os fields como antes
			const fieldEntries = Object.entries(data.fields);
			for (let i = 0; i < fieldEntries.length; i += 2) {
				const [key1, value1] = fieldEntries[i];
				const capitalizedKey1 = key1.charAt(0).toUpperCase() + key1.slice(1);
				let formattedValue1;
				if (typeof value1 === 'object') {
					formattedValue1 = JSON.stringify(value1);
				} else {
					formattedValue1 = String(value1);
				}

				if (i + 1 < fieldEntries.length) {
					const [key2, value2] = fieldEntries[i + 1];
					const capitalizedKey2 = key2.charAt(0).toUpperCase() + key2.slice(1);
					let formattedValue2;
					if (typeof value2 === 'object') {
						formattedValue2 = JSON.stringify(value2);
					} else {
						formattedValue2 = String(value2);
					}

					blocks.push({
						type: 'section',
						fields: [
							{
								type: 'mrkdwn',
								text: `*${capitalizedKey1}:*\n${formattedValue1}`
							},
							{
								type: 'mrkdwn',
								text: `*${capitalizedKey2}:*\n${formattedValue2}`
							}
						]
					});
				} else {
					blocks.push({
						type: 'section',
						fields: [
							{
								type: 'mrkdwn',
								text: `*${capitalizedKey1}:*\n${formattedValue1}`
							}
						]
					});
				}
			}
		}

		// Return the formatted message with color
		return {
			attachments: [
				{
					color: color,
					blocks: blocks
				}
			]
		};
	};
}

// // Send example notifications
// eventExamples.forEach(example => {
// 	notifySlack(example);
// });

module.exports = new SlackService();
