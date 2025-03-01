/**
 * This automation sends a report to Hai for a title suggestion and updates the report title accordingly.
 * It also escalates the report to an issue tracker integration.
 * 
 * Note: This automation requires an integration capable of escalating reports to an issue tracker.
 * Note: To use this automation, use the automation 'Automatically send reports to your issue tracker' and update its configuration. You can find it in the Automation Library, the integration section.
 */

exports.run = async ({data, config, apiGet, apiPost, apiPut, promptHai}) => {

    const promptHaiMessage = `
    You are a skilled content writer tasked with creating an engaging and informative title for the vulnerability report provided.
    Your goal is to create a new, descriptive, and concise title for this content. The title must be exactly one sentence long.
    Please follow these steps:
  
    1. Analyze the content type provided.
    2. Consider the key aspects that should be highlighted in the title.
    3. Generate at least three title ideas that accurately represent the content while being engaging to potential readers.
    4. Evaluate each title idea based on clarity, engagement, and relevance to the content type.
    5. Count the words in each title to ensure it's one sentence.
    6. Choose the best title based on your evaluation.
  
    After your thought process, present your final title suggestion within <title> tags.
  
    Example output structure:
    <title>
    [Your chosen one-sentence title]
    </title>
  
    Please proceed with creating a title for the given content type.
    `;
  
    console.log(`Sending report ${data.reportId} to Hai for title suggestion`);
  
    const reply = await promptHai(
        promptHaiMessage,
        { reportIds: [data.reportId] }
    );
  
    console.log(`Hai replied with: ${reply}`);
    
    const new_title = reply.match(/<title>(.*?)<\/title>/)[1]
  
    await apiPut(`/reports/${data.reportId}/title`,
        JSON.stringify(
            {
                "data": {
                    "type": "report-title",
                    "attributes": {
                        "title": `${new_title}`
                    }
                }
            }
        )
    );
  
    console.log(`Title updated to: ${reply}`);
  
    const { reportId } = data
    
    const { integration } = config
    
    console.log(`Running an issue tracker automation for report ${reportId}`)
    
    const report = await apiGet(`/reports/${reportId}`)
    
    const programId = report.data.relationships.program.data.id
    
    const programIntegrations = await apiGet(`/programs/${programId}/integrations`)
    
    if (!programIntegrations.data.find((({ id }) => id === integration.value))) {
      console.log(`Program of the report ${reportId} is not associated with the requested integration, exiting`)
      return
    }
    
    if(report.data.attributes?.issue_tracker_reference_id !== null && report.data.attributes?.issue_tracker_reference_id !== undefined) {
      console.log(`Report ${reportId} already sent to an issue tracker, exiting`)
      return
    }
    
    console.log(
      `Sending report ${reportId} to integration ${integration.label}`
    )
    
    await apiPost(
      `/reports/${reportId}/escalate`,
      JSON.stringify({
        data: {
          type: 'escalate-report',
          attributes: {
            integration_id: integration.value
          }
        }
      })
    )
  };
  