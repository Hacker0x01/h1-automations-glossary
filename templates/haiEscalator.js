/**
 * This automation script uses the HackerOne API to query for new reports submitted in the last 24 hours.
 * It then prompts Hai to determine if the reports describe the same vulnerability. 
 * If Hai decides that an escalation is necessary, an email is sent to the specified address.
 * Please note: Make sure you change the emailaddress and the team handle.
 */

const EMAIL_ADDRESS = "YOUR_EMAIL@example.com";  // Email for escalation alerts
const TEAM_HANDLE = "YOUR_TEAM_HANDLE";         // Your HackerOne program handle
const SUBJECT = "🚨 Security Alert: Escalation Required for Vulnerability Reports";

const generateMessage = (reportLinks) => `
🚨 **Hai Escalator: Increased Critical Security Findings Detected** 🚨

The following vulnerability reports show a pattern and require immediate attention:

${reportLinks}

**Why is this important?**
- These reports **may** describe the same vulnerability affecting a critical system.
- Hai, our AI security analyst, has determined that an escalation is necessary.

🔎 **Next Steps:**
1. Review the reports linked above.
2. Determine if further mitigation is required.
3. Respond to the reporters as needed.

For further details, please log into the [HackerOne platform](https://hackerone.com/users/sign_in).

Best regards,  
**Hai Escalator**
`;

async function sendEmail(apiPost, vulnerableReportsArray) {
    if (vulnerableReportsArray.length === 0) {
        console.error("Error: No report IDs provided for escalation.");
        return;
    }

    const reportLinks = vulnerableReportsArray.map(id => `- [Report ${id}](https://hackerone.com/reports/${id})`).join("\n");
    const message = generateMessage(reportLinks);

    console.log(`Sending email to ${EMAIL_ADDRESS} with subject: ${SUBJECT} and message:\n${message}`);

    try {
        await apiPost(`/email`, JSON.stringify({
            "data": {
                "type": "email-message",
                "attributes": {
                    "email": EMAIL_ADDRESS,
                    "subject": SUBJECT,
                    "markdown_content": message,
                }
            }
        }));
    } catch (error) {
        console.error('Error sending email:', error);
    }
}

async function askHai(promptHai, reportIds) {
    if (reportIds.length === 0) return { esclationNeeded: false, vulnerableReportsArray: [] }; // No reports, no escalation needed.

    const promptHaiMessage = `

        You are an AI security analyst named Hai. Your task is to analyze a set of vulnerability reports and determine if they describe the same or similar vulnerabilities, or if they show a trend that requires escalation. We will provide you with the IDs of the reports to analyze.

        ${reportIds}

        Instructions:
        1. Carefully analyze the reports corresponding to the given IDs.
        2. Determine if these reports describe similar vulnerabilities or show a trend that requires escalation.
        3. Identify which specific reports contribute to the pattern or similarity, if any.
        4. Provide your analysis and decision in the specified format.

        In your analysis, please consider the following:
        - The nature of the vulnerabilities described in each report
        - Any common attack vectors or affected systems
        - Temporal relationships between the reports
        - Severity levels of the reported vulnerabilities

        Follow these steps:

        1. List each report ID and summarize its key details (nature of vulnerability, attack vector, affected system, severity level, and date).
        2. Create a comparison matrix to visually represent similarities between reports.
        3. Identify any temporal patterns or trends.
        4. Evaluate the severity levels across reports.
        5. Make arguments for and against escalation.

        Output Format:
        After your analysis, provide your decision in the following format:
        <vulnerableReportIds>comma-separated list of IDs</vulnerableReportIds>
        <decision>true or false</decision>

        - If the reports describe similar vulnerabilities or a trend that requires escalation, list the relevant report IDs in the <vulnerableReportIds> tags and set the decision to true.
        - If the reports describe unrelated vulnerabilities or do not show a significant trend, leave the <vulnerableReportIds> tags empty and set the decision to false.

        Example output structure:
        <vulnerableReportIds>1,3,5</vulnerableReportIds>
        <decision>true</decision>

        OR

        <decision>false</decision>

        Please proceed with your analysis and decision based on the given report IDs.
    
    `;

    try {
        const reply = await promptHai(promptHaiMessage, { reportIds });

        if (!reply || typeof reply !== "string") {
            console.error("Error: Hai did not return a valid response.");
            return { esclationNeeded: false, vulnerableReportsArray: [] };
        }

        let escalationNeeded = false;
        const match = reply.match(/<decision>(true|false)<\/decision>/i);
        if (match && match[1] === "true") {
            escalationNeeded = true;
        }

        const vulnerableReportIds = reply.match(/<vulnerableReportIds>([\d,]*)<\/vulnerableReportIds>/i);
        let vulnerableReportsArray = [];
        if (vulnerableReportIds && vulnerableReportIds[1]) {
            vulnerableReportsArray = vulnerableReportIds[1].split(",").map(Number);
        }
        return { escalationNeeded, vulnerableReportsArray }
    } catch (error) {
        console.error("Error while querying Hai:", error);
        return { esclationNeeded: false, vulnerableReportsArray: [] };
    }
}

exports.run = async ({ data, config, apiGet, apiPost, promptHai }) => {
    const yesterdayDate = new Date();
    yesterdayDate.setHours(yesterdayDate.getHours() - 24);
    const formattedYesterday = yesterdayDate.toISOString();

    const response = await apiGet(`/reports?filter[program][]=${TEAM_HANDLE}&filter[submitted_at__gt]=${encodeURIComponent(formattedYesterday)}`);
    const reportIds = response?.data?.map(report => report.id) || [];

    console.log(`Reports submitted in the last 24 hours: ${reportIds.join(", ")}`);

    if (reportIds.length === 0) {
        console.log("No new reports in the last 24 hours. No escalation needed.");
        return;
    }

    const { escalationNeeded, vulnerableReportsArray } = await askHai(promptHai, reportIds);

    console.log(`Hai's decision: ${escalationNeeded ? "Escalation required" : "No escalation needed"}`);
    console.log(`Vulnerable reports: ${vulnerableReportsArray.join(", ")}`);

    if (escalationNeeded) {
        await sendEmail(apiPost, vulnerableReportsArray);
    }
};