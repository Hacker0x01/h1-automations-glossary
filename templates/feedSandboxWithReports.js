/**
 * This automation retrieves a random disclosed report from HackerOne's hacktivity feed, visits the report, and sends a new report with the same information.
 * Please note: Use this automation only for testing purposes and be careful with the sharing your API key and username.
 */

const API_KEY = "SECRET";
const USERNAME = "USERNAME";
const TEAM_HANDLE = 'YOUR_TEAM_HANDLE';
const AUTH = `${USERNAME}:${API_KEY}`;
const BASE_URL = 'api.hackerone.com';

function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    console.log('Request options:', options);
    if (postData) {
      console.log('Post data:', postData);
    }

    const req = require('https').request(options, (res) => {
      let data = '';
      console.log(`Status Code: ${res.statusCode}`);

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        console.log('Response data:', data);
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (e) => {
      console.error('Request error:', e);
      reject(e);
    });

    if (postData) {
      req.write(postData);
    }

    req.end();
  });
}

async function extractReport() {
  try {
    const options = {
      hostname: BASE_URL,
      path: '/v1/hackers/hacktivity?queryString=disclosed:true',
      method: 'GET',
      headers: {
        'Authorization': `Basic ${Buffer.from(AUTH).toString('base64')}`,
        'Accept': 'application/json',
      },
    };

    const data = await makeRequest(options);
    console.log('Extracted data:', data);

    if (data && Array.isArray(data.data)) {
      const ids = data.data.map((item) => item.id);
      const randomId = ids[Math.floor(Math.random() * ids.length)];
      console.log('Random report ID:', randomId); // Log the random report ID
      return randomId;
    } else {
      console.error('Unexpected response format:', data);
    }
  } catch (error) {
    console.error('Error extracting report:', error);
  }
}

async function visitReport(id) {
  try {
    const options = {
      hostname: 'hackerone.com',
      path: `/reports/${id}.json`,
      method: 'GET',
      headers: {
        'Authorization': `Basic ${Buffer.from(AUTH).toString('base64')}`,
        'Accept': 'application/json',
      },
    };

    const data = await makeRequest(options);
    console.log('Visited report data:', data);

    const title = data.title;
    const vulnerability_information = data.vulnerability_information;
    const severity_rating = data.severity_rating;
    console.log(`Visited report: ${id}. Extracted info: Title: ${title}, Vulnerability Information: ${vulnerability_information}, Severity Rating: ${severity_rating}`); // Log the visited report
    return { title, vulnerability_information, severity_rating };
  } catch (error) {
    console.error('Error visiting report:', error);
  }
}

async function sendNewReport(reportTitle, vulnerabilityInformation, reportSeverity) {
  try {
    const payload = JSON.stringify({
      data: {
        type: 'report',
        attributes: {
          team_handle: TEAM_HANDLE,
          title: reportTitle,
          vulnerability_information: vulnerabilityInformation,
          impact: 'This is the line about impact',
          severity_rating: reportSeverity,
        },
      },
    });
    console.log('Payload:', payload);

    const options = {
      hostname: BASE_URL,
      path: '/v1/hackers/reports',
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(AUTH).toString('base64')}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    };
    console.log('Sending report...');

    await makeRequest(options, payload);
    console.log('Report sent successfully');
  } catch (error) {
    console.error('Error sending report:', error);
  }
}

exports.run = async ({data, config, apiGet, apiPost, apiPut, apiDelete, promptHai}) => {
    async function main() {
      let report;
      let id;
  
      do {
        console.log('Fetching a report...');
        id = await extractReport();
        if (id) {
          report = await visitReport(id);
        }
        if (report && !report.vulnerability_information) {
          console.log('Empty vulnerability information, fetching another report...');
        }
      } while (report && !report.vulnerability_information); 
  
      if (report) {
        const { title, vulnerability_information, severity_rating } = report;
        await sendNewReport(title, vulnerability_information, severity_rating);
      }
    }
  
    await main();
};