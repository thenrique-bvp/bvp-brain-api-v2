const axios = require('axios');

class EmailService {
	async sendEmail(email, csvString) {
		const csvBase64 = Buffer.from(csvString).toString('base64');

		const attachment = {
			filename: 'report.csv',
			content_type: 'text/csv',
			data: csvBase64
		};

		const emailBody = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Your Leads Report is Ready</title>
        <style>
            /* Include any additional styles here */
        </style>
    </head>
    <body style="margin:0; padding:0; background-color:#f6f6f6;">
    <center>
      <table width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="#f6f6f6">
        <tr>
          <td style="padding: 40px 0;">
            <table width="600" border="0" cellspacing="0" cellpadding="0" bgcolor="#ffffff" align="center" style="margin: 0 auto;">
              <tr>
                <td style="padding: 20px; font-family: Arial, sans-serif;">
                  <h1 style="font-size: 24px; font-weight: bold; margin: 0 0 20px;">Your Leads Report is Ready</h1>
                  <p style="margin: 0 0 15px;">Dear Investor,</p>
                  <p style="margin: 0 0 15px;">Your latest leads report has been generated. Please find the attached CSV file containing your report.</p>
                  <p style="margin: 0;">Best regards,<br>The Bessemer Team</p>
                </td>
              </tr>
              <tr>
                <td style="padding: 20px; font-family: Arial, sans-serif; font-size: 12px; color: #888888; text-align: center;">
                  &copy; Bessemer.io
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </center>
    </body>
    </html>
  `;

		const data = {
			recipient: email,
			subject: 'Your report is ready - Bessemer Ghost Killer',
			body: emailBody,
			attachment: attachment
		};

		try {
			const response = await axios.post('http://3.144.127.65/send_email', data, {
				headers: { 'Content-Type': 'application/json' }
			});
			console.log('Email sent successfully:', response.data);
			return response.data;
		} catch (error) {
			console.error('Error sending email:', error);
			throw error;
		}
	}
}

module.exports = new EmailService();
