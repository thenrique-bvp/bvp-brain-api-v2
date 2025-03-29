const slackService = require('../services/notification/slack.service');

const testExamples = [
	{
		action: 'SUCCESS',
		title: 'Deployment Completed',
		message: 'The application deployment was completed successfully in the production environment.',
		source: 'ci-cd-pipeline',
		method: 'deploy-production',
		details: {
			version: '2.5.1',
			commitId: 'a7d3f91',
			buildTime: '3m 42s',
			environment: 'production'
		},
		fields: {
			author: 'John Smith',
			region: 'us-east-1',
			status: 'Online',
			uptime: '99.99%',
			teamNotified: 'DevOps',
			nextMaintenance: '2023-07-15'
		}
	},
	{
		action: 'ERROR',
		title: 'Database Connection Failure',
		message: 'The service could not connect to the primary database after multiple attempts.',
		source: 'users-service',
		method: 'database-connection',
		error: 'Connection timeout after 30s',
		details: {
			database: 'postgres-main',
			attempts: 5,
			lastAttempt: '2023-06-10T15:45:22Z',
			stackTrace:
				'Error: Connection timeout\n  at Database.connect (/app/db.js:15:7)\n  at processTicksAndRejections (node:internal/process/task_queues:95:5)'
		},
		fields: {
			affectedServices: 'auth, users, payments',
			impactLevel: 'Critical'
		}
	},
	{
		action: 'WARNING',
		title: 'High CPU Usage',
		message: 'Elevated CPU usage detected on production server. Monitoring the situation.',
		source: 'monitoring-service',
		method: 'resource-check',
		error: 'CPU usage above 85%',
		details: {
			server: 'prod-api-01',
			cpuUsage: '87%',
			memoryUsage: '65%',
			startTime: '2023-06-10T14:32:00Z'
		}
	},
	{
		action: 'INFO',
		title: 'Daily Report Generated',
		message: 'The daily activity report was generated and sent successfully.',
		source: 'reporting-service',
		method: 'daily-report',
		fields: {
			newUsers: '124',
			transactions: '1,567',
			revenue: '$25,432.50',
			nextReport: 'Tomorrow at 06:00'
		}
	},
	{
		action: 'SUCCESS',
		title: 'Backup Completed',
		message: 'The weekly backup was completed without errors.',
		source: 'backup-service',
		method: 'weekly-backup',
		details: {
			backupSize: '1.2TB',
			duration: '1h 45m',
			compressionRatio: '68%',
			storedAt: 's3://backups/weekly/2023-06-10'
		}
	},
	{
		action: 'ERROR',
		title: 'API Integration Error',
		message: 'Failed to integrate with external service.',
		source: 'integration-service',
		method: 'third-party-api-call',
		error: 'API Gateway Timeout (504)'
	},
	{
		action: 'INFO',
		title: 'System Update',
		message: 'The system will undergo scheduled maintenance next Friday at 10 PM.'
	},
	{
		action: 'WARNING',
		title: 'Storage Limits',
		message: 'The server is approaching available storage limits.',
		source: 'storage-monitor',
		method: 'disk-check',
		fields: {
			diskUsage: '88%',
			freeSpace: '24GB',
			projectedExhaustion: '5 days'
		}
	},
	{
		action: 'ERROR',
		title: 'Batch Processing Failure',
		message: 'Batch processing failed for multiple items.',
		source: 'batch-processor',
		method: 'process-transactions',
		error: 'Validation failed for multiple items',
		details: {
			batchId: 'BATCH-2023-06-10-001',
			totalItems: 1250,
			failedItems: 42
		},
		fields: {
			errorCodes: [400, 422, 500],
			affectedUsers: ['user123', 'user456', 'user789'],
			errorDistribution: { validation: 28, timeout: 10, unknown: 4 },
			processingStats: { avgTimePerItem: '230ms', peakMemory: '450MB' }
		}
	},
	{
		action: 'SUCCESS',
		title: 'Data Migration Complete',
		message: 'Data migration was completed successfully within the estimated timeframe.',
		source: 'data-migration-service',
		method: 'migrate-user-data',
		details: {
			fromDatabase: 'legacy-db',
			toDatabase: 'new-cloud-db',
			totalRecords: 5280324,
			duration: '4h 12m'
		},
		fields: {
			field1: 'Value 1',
			field2: 'Value 2',
			field3: 'Value 3',
			field4: 'Value 4',
			field5: 'Value 5',
			field6: 'Value 6',
			field7: 'Value 7',
			field8: 'Value 8'
		}
	}
];

async function sendNotificationsMock() {
	console.log('Starting Slack notification tests...');

	const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

	let count = 0;
	for (const example of testExamples) {
		count++;
		try {
			console.log(`Sending example ${count}/${testExamples.length}: ${example.action} - ${example.title}`);
			await slackService.notifySlack(example);
			console.log(`Example ${count} sent successfully`);

			if (count < testExamples.length) {
				await delay(2000);
			}
		} catch (error) {
			console.error(`Failed to send example ${count}: ${error.message}`);
		}
	}

	console.log('All notification tests completed!');
}

module.exports = {
	sendNotificationsMock
};
