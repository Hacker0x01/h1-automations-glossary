exports.run = async ({data, config = {}, apiGet, apiPost, promptHai}) => {
  // Default configuration 
  config = {
    ...{
      // Default to empty report_ids array to allow auto-fetching of reports
      report_ids: [],
      // Test mode - doesn't update custom fields
      dryRun: false,
      // States to check - now including triaged, resolved, and retesting
      check_states: ["triaged", "resolved", "retesting"],
      // Program handle - REQUIRED
      program_handle: "program_placeholder",
      // Custom field label for Novelty Score field, can vary by program
      novelty_score_field_label: "Novelty Score",
      // Direct novelty score prompt (no need for Hai Play ID anymore)
      novelty_prompt: `In third person and concise terms, analyze this vulnerability report and calculate a novelty score. The novelty score measures how unique a vulnerability is, ranging from 0% (not novel) to 100% (completely novel).

      Calculate the score using these specific rules:
      - 100% novel: No matching attributes with any other report
      - 80% novel: Only the CWE (vulnerability type) matches with other reports
      - 60% novel: CWE + Asset Type match with other reports
      - 40% novel: CWE + same specific Asset match with other reports
      - 20% novel: CWE + Asset + URL Path match with other reports
      - 0% novel: CWE + Asset + Path + Parameter match with other reports

      Compare this report to previous reports in the program and clearly state the final novelty score percentage. Explain your reasoning for this score based on the matching attributes.`
    },
    ...config
  };

  console.log('Starting Vulnerability Novelty Score Analyzer Integration');
  try {
    // Check if program handle is set in config
    if (!config.program_handle) {
      console.error("Program handle not specified in config. Please set config.program_handle.");
      return;
    }

    console.log(`Using program handle: ${config.program_handle}`);
    
    let reportsToProcess = [];
    
    // Option 1: Check a specific report from trigger data
    if (data && data.reportId) {
      reportsToProcess = [data.reportId];
      console.log(`Processing triggered report: ${data.reportId}`);
    }
    // Option 2: Check specific reports from config
    else if (config.report_ids && Array.isArray(config.report_ids) && config.report_ids.length > 0) {
      reportsToProcess = config.report_ids;
      console.log(`Processing ${reportsToProcess.length} reports from config.report_ids`);
    }
    // Option 3: Auto-fetch reports with specified states
    else {
      console.log(`Auto-fetching reports for program: ${config.program_handle}`);
      
      let allReports = [];
      
      // Fetch reports for each state
      for (const state of config.check_states) {
        try {
          const reportQuery = await apiGet(`/reports?filter[program][]=${config.program_handle}&filter[state][]=${state}`);
       
          if (reportQuery && reportQuery.data && reportQuery.data.length > 0) {
            allReports = allReports.concat(reportQuery.data);
            console.log(`Auto-fetched ${reportQuery.data.length} ${state} reports`);
          } else {
            console.log(`No ${state} reports found`);
          }
        } catch (error) {
          console.error(`Error fetching ${state} reports: ${error.message}`);
        }
      }
      
      if (allReports.length > 0) {
        reportsToProcess = allReports.map(report => report.id);
        console.log(`Total reports to process: ${reportsToProcess.length}`);
      } else {
        console.log("No reports found to process");
        return;
      }
    }

    // Exit if no reports to process
    if (!reportsToProcess.length) {
      console.log("No reports to process, exiting");
      return;
    }

    // For storing the custom field ID once identified
    let noveltyScoreFieldId = null;

    // Process each report
    let totalChecked = 0;
    let totalProcessed = 0;

    for (const reportId of reportsToProcess) {
      try {
        totalChecked++;
        console.log(`Processing report ${reportId} for novelty score analysis...`);
     
        // Get full report details
        const report = await apiGet(`/reports/${reportId}`);
        if (!report || !report.data) {
          console.log(`Could not retrieve report ${reportId}`);
          continue;
        }
       
        // Might need to change this, but if we haven't identified the custom field yet, try to find it from the report's program
        if (!noveltyScoreFieldId) {
          try {
            // Get the program ID from the report
            const programId = report.data.relationships?.program?.data?.id;
            if (programId) {
              console.log(`Found program ID ${programId} from report, fetching custom fields...`);
              const program = await apiGet(`/programs/${programId}`);
             
              if (program && program.data && program.data.relationships && program.data.relationships.custom_field_attributes && program.data.relationships.custom_field_attributes.data) {
                const customFields = program.data.relationships.custom_field_attributes.data;
                console.log(`Found ${customFields.length} custom fields for program`);
               
                // Find the Novelty Score field
                const noveltyField = customFields.find(field =>
                  field.attributes && field.attributes.label === config.novelty_score_field_label
                );
               
                if (noveltyField) {
                  noveltyScoreFieldId = noveltyField.id;
                  console.log(`Found Novelty Score custom field with ID: ${noveltyScoreFieldId}`);
                } else {
                  console.log(`Could not find custom field with label "${config.novelty_score_field_label}"`);
                }
              }
            }
          } catch (fieldError) {
            console.error(`Error identifying custom fields: ${fieldError.message}`);
          }
        }

        // Use promptHai for novelty score calculation if not in dry run mode
        if (!config.dryRun) {
          try {
            // Call Hai directly with the embedded novelty prompt
            const reply = await promptHai(
              config.novelty_prompt,
              { reportIds: [reportId] }
            );

            if (reply) {
              // Extract the novelty score percentage from the reply
              const scoreMatch = reply.match(/(\d+)%/);
              let noveltyScorePercentage = scoreMatch ? parseInt(scoreMatch[1]) : null;
              let noveltyCategory = "";
              
              // Determine the novelty category based on the percentage
              if (noveltyScorePercentage !== null) {
                if (noveltyScorePercentage === 100) {
                  noveltyCategory = "Completely Unique (100%)";
                } else if (noveltyScorePercentage >= 80) {
                  noveltyCategory = "Very Novel (80-99%)";
                } else if (noveltyScorePercentage >= 60) {
                  noveltyCategory = "Novel (60-79%)";
                } else if (noveltyScorePercentage >= 40) {
                  noveltyCategory = "Somewhat Novel (40-59%)";
                } else if (noveltyScorePercentage >= 20) {
                  noveltyCategory = "Similar (20-39%)";
                } else {
                  noveltyCategory = "Nearly Duplicate (0-19%)";
                }
              } else {
                // Fallback if no percentage was found
                noveltyCategory = "Unknown";
                console.log(`Could not extract novelty percentage from Hai response for report ${reportId}`);
              }
              
              // Generate explanation of the novelty score
              let noveltyExplanation = "";
              if (noveltyScorePercentage === 100) {
                noveltyExplanation = "This vulnerability is completely unique - no similar vulnerabilities have been reported in this program.";
              } else if (noveltyScorePercentage >= 80) {
                noveltyExplanation = "This vulnerability is highly novel with only the CWE (vulnerability type) matching previous reports.";
              } else if (noveltyScorePercentage >= 60) {
                noveltyExplanation = "This vulnerability has moderate novelty with the CWE and asset type matching previous reports.";
              } else if (noveltyScorePercentage >= 40) {
                noveltyExplanation = "This vulnerability shows some novelty but shares the same CWE and specific asset with previous reports.";
              } else if (noveltyScorePercentage >= 20) {
                noveltyExplanation = "This vulnerability has limited novelty, matching previous reports in CWE, asset, and path.";
              } else {
                noveltyExplanation = "This vulnerability closely resembles previous reports, matching in CWE, asset, path, and parameters.";
              }

              // Post novelty score comment
              const messagePrefix = `**Vulnerability Novelty Analysis**: ${noveltyCategory}`;

              await apiPost(`/reports/${reportId}/activities`, JSON.stringify({
                data: {
                  type: "activity-comment",
                  attributes: {
                    message: `${messagePrefix}\n\n${noveltyExplanation}\n\n${reply}`,
                    internal: true
                  }
                }
              }));

              console.log(`Successfully posted novelty score analysis for report ${reportId}`);
              
              // Update the Novelty Score custom field if we found the field
              if (noveltyScoreFieldId) {
                try {
                  await apiPost(`/reports/${reportId}/custom_field_values`, JSON.stringify({
                    data: {
                      type: "custom-field-value",
                      attributes: {
                        custom_field_attribute_id: parseInt(noveltyScoreFieldId),
                        value: noveltyCategory
                      }
                    }
                  }));
                  console.log(`Successfully updated Novelty Score custom field to "${noveltyCategory}" for report ${reportId}`);
                } catch (fieldError) {
                  console.error(`Error updating Novelty Score custom field for report ${reportId}:`, fieldError);
                }
              } else {
                console.log(`Could not update Novelty Score field for report ${reportId} because the field ID was not found`);
              }
              
              totalProcessed++;
            } else {
              console.log(`No novelty score calculation was generated for report ${reportId}`);
            }
          } catch (error) {
            console.error(`Error generating novelty score for report ${reportId}:`, error);
          }
        }
      } catch (err) {
        console.error(`Error processing report ${reportId}: ${err.message}`);
      }
    }

    console.log(`Novelty Score Analysis Summary:`);
    console.log(`- Total reports checked: ${totalChecked}`);
    console.log(`- Reports processed with novelty scores: ${totalProcessed}`);
    console.log(`- Mode: ${config.dryRun ? 'DRY RUN (no updates)' : 'PRODUCTION (novelty scores generated)'}`);

  } catch (error) {
    console.error(`Error in Novelty Score analyzer: ${error.message}`);
  }
};
