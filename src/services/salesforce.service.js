const { URL } = require('url');
const jsforce = require('jsforce');

class SalesforceService {
	constructor() {
		this.conn = new jsforce.Connection();
		this.initialized = false;
	}

	async initialize() {
		if (!this.initialized) {
			const username = process.env.SALESFORCE_USERNAME;
			const password = process.env.SALESFORCE_PASSWORD;

			if (!username || !password) {
				throw new Error('Salesforce credentials not found in environment variables');
			}

			try {
				await this.conn.login(username, password);
				this.initialized = true;
			} catch (error) {
				const errorLogService = require('./errorLog.service');
				await errorLogService.sendMessage({
					service: 'SalesforceService',
					method: 'initialize',
					error: error.message,
					details: { stack: error.stack }
				});
				throw new Error('Failed to authenticate with Salesforce');
			}
		}
	}

	async getAllCompaniesYouCreated(ownerId) {
		await this.initialize();

		const query = `SELECT Name, Id, Website FROM Account WHERE OwnerId = '${ownerId}'`;
		const results = await this.conn.query(query);
		const websites = results.records.filter((record) => record.Website).map((record) => record.Website);

		return websites;
	}

	async getWebsitesYouOwnNotCreated(bvpOwner) {
		await this.initialize();

		const query = `SELECT Website FROM Account WHERE BVP_Owners__c = '${bvpOwner}'`;
		const results = await this.conn.query(query);
		const websites = results.records.filter((record) => record.Website).map((record) => record.Website);

		return websites;
	}

	async getActiveUsers() {
		await this.initialize();

		const query = 'SELECT Id, Name, IsActive FROM User';
		const users = await this.conn.query(query);
		const activeUsers = users.records
			.filter((user) => user.IsActive)
			.map((user) => ({ Id: user.Id, Name: user.Name }));

		return activeUsers;
	}

	getUserIdByName(activeUsers, userName) {
		for (const user of activeUsers) {
			if (user.Name === userName) {
				return user.Id;
			}
		}
		return null;
	}

	async companyWebsiteExists(websites) {
		await this.initialize();

		try {
			const sanitizedDomains = [];

			for (const website of websites) {
				let domain;
				try {
					domain = new URL(website.startsWith('http') ? website : `http://${website}`).hostname;
				} catch (e) {
					domain = website;
				}

				let sanitizedDomain = domain.replace(/'/g, "''").replace('www.', '');
				sanitizedDomain = sanitizedDomain.replace('http://', '').replace('https://', '');
				sanitizedDomain = sanitizedDomain.replace(':443', '');
				sanitizedDomains.push(sanitizedDomain);
			}

			const queryConditions = sanitizedDomains.map((domain) => `Website LIKE '%${domain}%'`).join(' OR ');
			const soqlQuery = `SELECT Id, Name, Owner.Name, BVP_Owners__c, Last_Activity_Date__c, Last_Email_Received_Date__c FROM Account WHERE ${queryConditions} LIMIT 200`;

			const records = await this.conn.query(soqlQuery);

			const results = {};
			sanitizedDomains.forEach((domain) => {
				results[domain] = [];
			});

			for (const record of records.records) {
				const website = record.Website || '';

				if (record.BVP_Owners__c) {
					if (!record.Owner) {
						record.Owner = {};
					}
					record.Owner.Name = record.BVP_Owners__c;
				}

				for (const domain of sanitizedDomains) {
					if (website.includes(domain)) {
						if (!results[domain]) {
							results[domain] = [];
						}
						results[domain].push(record);
					}
				}
			}

			return results;
		} catch (error) {
			console.error(`An error occurred: ${error}`);
			return null;
		}
	}

	escapeSoqlString(s) {
		return s.replace(/'/g, '');
	}

	async companyNameExists(names) {
		await this.initialize();

		try {
			if (names.length > 0) {
				const sanitizedNames = names.map((name) => name.replace(/'/g, "''"));
				const queryConditions = sanitizedNames
					.map((name) => `Name = '${this.escapeSoqlString(name)}'`)
					.join(' OR ');
				const soqlQuery = `SELECT Id, Name, Owner.Name, BVP_Owners__c, Last_Activity_Date__c, Last_Email_Received_Date__c FROM Account WHERE ${queryConditions} LIMIT 200`;

				const records = await this.conn.query(soqlQuery);

				const results = {};
				sanitizedNames.forEach((name) => {
					results[name] = [];
				});

				for (const record of records.records) {
					const name = record.Name;
					if (record.BVP_Owners__c) {
						record.Owner.Name = record.BVP_Owners__c;
					}
					if (results[name]) {
						results[name].push(record);
					}
				}

				return results;
			} else {
				return {};
			}
		} catch (error) {
			console.error(`An error occurred: ${error}`);
			return null;
		}
	}

	async salesforceIdFinal(name, website) {
		await this.initialize();

		try {
			if (!website.startsWith('http://') && !website.startsWith('https://')) {
				website = 'http://' + website;
			}

			let domain;
			try {
				domain = new URL(website).hostname;
			} catch (e) {
				domain = website;
			}

			const sanitizedDomain = domain.replace(/'/g, "''");
			const domainNoWww = sanitizedDomain.replace('www.', '');
			console.log(`the sanitized domain is: ${domainNoWww}`);

			const queries = [
				`SELECT Id, Name FROM Account WHERE Website = 'https://${domainNoWww}' LIMIT 1`,
				`SELECT Id, Name FROM Account WHERE Website = 'http://${domainNoWww}' LIMIT 1`,
				`SELECT Id, Name FROM Account WHERE Website = 'https://www.${domainNoWww}' LIMIT 1`,
				`SELECT Id, Name FROM Account WHERE Website LIKE '%${domainNoWww}%' LIMIT 1`
			];

			for (const query of queries) {
				const records = await this.conn.query(query);
				if (records.totalSize > 0) {
					return { sfId: records.records[0].Id, source: 'website' };
				}
			}

			const nameQuery = `SELECT Id, Name FROM Account WHERE Name = '${this.escapeSoqlString(name)}' LIMIT 1`;
			const nameRecords = await this.conn.query(nameQuery);

			if (nameRecords.totalSize > 0) {
				return { sfId: nameRecords.records[0].Id, source: 'name' };
			}

			return { sfId: null, source: null };
		} catch (error) {
			console.error(`An error occurred: ${error}`);
			return { sfId: null, source: null };
		}
	}

	async salesforceOwnername(salesforceId) {
		await this.initialize();

		const objectApiName = 'Account';

		if (salesforceId) {
			try {
				const query = `SELECT Id, Name, Owner.Name, BVP_Owners__c, Last_Activity_Date__c, Last_Email_Received_Date__c FROM ${objectApiName} WHERE Id = '${salesforceId}'`;
				const result = await this.conn.query(query);

				if (result.records && result.records.length > 0) {
					const record = result.records[0];

					const ownerName = record.BVP_Owners__c || (record.Owner ? record.Owner.Name : 'Unknown Owner');
					const sfId = record.Id;
					const salesforceUrl = `https://bvp.lightning.force.com/lightning/r/Account/${sfId}/view`;

					const lastEmailDate = record.Last_Email_Received_Date__c || 'No email date found';
					const lastActivity = record.Last_Activity_Date__c || 'No activity date found';

					return {
						ownerName,
						salesforce_url: salesforceUrl,
						last_email_date: lastEmailDate,
						last_activity: lastActivity
					};
				} else {
					return 'Entry not found.';
				}
			} catch (error) {
				return `An error occurred: ${error.message}`;
			}
		} else {
			return 'No entry in Salesforce found.';
		}
	}

	async salesforceOwnernames(salesforceIds) {
		await this.initialize();

		const objectApiName = 'Account';

		if (salesforceIds && salesforceIds.length > 0) {
			try {
				const idsString = salesforceIds.map((id) => `'${id}'`).join(', ');
				const query = `SELECT Id, Owner.Name FROM ${objectApiName} WHERE Id IN (${idsString})`;
				const result = await this.conn.query(query);

				const results = [];
				for (const record of result.records) {
					const ownerName = record.Owner.Name;
					const sfId = record.Id;
					const salesforceUrl = `https://bvp.lightning.force.com/lightning/r/Account/${sfId}/view`;

					results.push({
						salesforceId: record.Id,
						ownerName,
						salesforce_url: salesforceUrl
					});
				}

				const foundIds = new Set(result.records.map((record) => record.Id));
				const notFoundIds = salesforceIds.filter((id) => !foundIds.has(id));

				for (const notFoundId of notFoundIds) {
					results.push({
						salesforceId: notFoundId,
						error: 'Entry not found.'
					});
				}

				return results;
			} catch (error) {
				return `An error occurred: ${error.message}`;
			}
		} else {
			return 'No entries in Salesforce found.';
		}
	}
}

const salesforceApi = new SalesforceService();

module.exports = { salesforceApi };
