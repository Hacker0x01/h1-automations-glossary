/**
 * This automation is triggered when a hacker submits a report. It automates the process of reviewing the report,
 * generating feedback, and sending the feedback to the hacker with a comment. 
 * Please note that if you want to comment this you should set the `internal` attribute to `false`.
 */


exports.run = async ({ data, apiGet, apiPost, apiPut, apiDelete, promptHai }) => {

    const promptHaiMessage = `
    Evaluate the submitted report based on **HackerOne's Quality Reports guidelines**.  
    Assess whether it aligns with **HackerOne's Detailed Platform Standards and Core Ineligible Findings**.

    ### **Formatting Requirements:**
    - **Response must be in a Markdown table** with **three fixed columns**:
    1. **Category** (The area being evaluated)
    2. **Feedback with actional suggestions** (Concise assessment of strengths/issues and how to improve)
    - **Use emojis consistently** for visual clarity:  
    - ✅ (Good)  
    - 🛠️ (Needs improvement)   
    - **Always keep the same column headers**: "| Category | Feedback |"
    - **Do NOT alter the table format** or introduce extra formatting.

    ### **Evaluation Criteria:**
    Evaluate the report across the following Quality Reports, Detailed Platform Standards and Core Ineligible Findings from the HackerOne Documentation.
    `;

    const reply = await promptHai(
        promptHaiMessage,
        { reportIds: [Number(data.reportId)] }
    );

    await apiPost(`/reports/${data.reportId}/activities`,
        JSON.stringify(
            {
                "data": {
                    "type": "activity-comment",
                    "attributes": {
                        "message": `
                            
                            # **Hai's Report Assessment**

                            Thanks for your submission! Hai is here to give your report an **initial review**. 
                            
                            Addressing the highlighted points can help **your report move through our system faster and might even boost your reward!** You’re welcome to update the report based on Hai’s suggestions—or ignore them if you think your report is already solid.
        
                            ## Feedback from Hai 
                            
                            ${reply}
                            `,
                        "internal": true, // Not yet visible, testing its usefulness.
                        "attachment_ids": []
                    }
                }
            }
        )
    );
};

