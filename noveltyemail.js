exports.run = async ({data, config = {}, apiGet, apiPost, apiPut, apiDelete, promptHai}) => {
  // Define default configuration - VALUES SHOULD BE CHANGED!
  config = {
    ...{
      // Number of days to look back for reports
      report_period: {
        value: "250",
        label: "Last 250 days"
      },
      // Email recipients - comma-separate if multiple
      recipient_email: "test@company.com",
      // Program handle
      program_handle: "program_placeholder",
      // Number of top novel reports to include in digest, default is 5
      top_novel_count: 5
    },
    ...config
  };
  
  console.log('Running Vulnerability Novelty Score automation');
  const days = parseInt(config.report_period.value);
  const today = new Date();
  const startOfPeriod = new Date(today.getTime() - days * 24 * 60 * 60 * 1000);
  const period_lowercase = config.report_period.label.toLowerCase(); // 'last 90 days' etc.
  
  console.log(`Analyzing reports for period ${days} days (${period_lowercase}) between ${startOfPeriod.toISOString()} and ${today.toISOString()}`);
  console.log(`Using program handle: ${config.program_handle}`);
  console.log(`Sending results to: ${config.recipient_email}`);
  
  // Fetch valid reports for the program (currently triaged, resolved, retesting)
  console.log(`Fetching all valid reports for program: ${config.program_handle}`);
  
  // Fetch reports for each state we're interested in, customizable
  const validStates = ['triaged', 'resolved', 'retesting'];
  let allReports = [];
  
  for (const state of validStates) {
    try {
      const reportQuery = await apiGet(`/reports?filter[program][]=${config.program_handle}&filter[state][]=${state}`);
      if (reportQuery && reportQuery.data && reportQuery.data.length > 0) {
        console.log(`Found ${reportQuery.data.length} reports in '${state}' state`);
        allReports = allReports.concat(reportQuery.data);
      }
    } catch (error) {
      console.error(`Error fetching ${state} reports: ${error.message}`);
    }
  }
  
  if (allReports.length === 0) {
    console.log("No valid reports found");
    await apiPost(`/email`,
      JSON.stringify({
        "data": {
          "type": "email-message",
          "attributes": {
            "email": config.recipient_email,
            "subject": `Your Vulnerability Novelty Analysis for the ${period_lowercase}`,
            "markdown_content": `We could not generate a Novelty Analysis as we found no valid reports (triaged, resolved, or retesting) for this program.`
          }
        }
      })
    );
    return;
  }
  
  console.log(`Found ${allReports.length} total valid reports before additional filtering`);
  
  // For storing report details
  const reportsWithFullDetails = [];
  
  // Process each report to get full details
  for (const report of allReports) {
    try {
      const fullReportData = await apiGet(`/reports/${report.id}`);
      if (fullReportData && fullReportData.data) {
        reportsWithFullDetails.push(fullReportData.data);
      }
    } catch (error) {
      console.error(`Error fetching full details for report ${report.id}: ${error.message}`);
    }
  }
  
  console.log(`Retrieved full details for ${reportsWithFullDetails.length} reports`);
  
  // Filter reports the time period in config
  const periodReports = reportsWithFullDetails.filter(report => {
    const submittedAt = new Date(report.attributes.submitted_at);
    return submittedAt >= startOfPeriod && submittedAt <= today;
  });
  
  console.log(`Found ${periodReports.length} valid reports submitted in the ${period_lowercase}`);
  
  if (periodReports.length === 0) {
    await apiPost(`/email`,
      JSON.stringify({
        "data": {
          "type": "email-message",
          "attributes": {
            "email": config.recipient_email,
            "subject": `Your Vulnerability Novelty Analysis for the ${period_lowercase}`,
            "markdown_content": `We could not generate a Novelty Analysis as we found no valid reports from the ${period_lowercase}.`
          }
        }
      })
    );
    return;
  }
  
  // Extract the necessary information for novelty calculation
  const reportDataForNovelty = periodReports.map(report => {
    // Extract CWE from weakness relationship
    let cwe = null;
    if (report.relationships && report.relationships.weakness && report.relationships.weakness.data) {
      cwe = {
        id: report.relationships.weakness.data.id,
        name: report.relationships.weakness.data.attributes?.name || 'Unknown'
      };
    }
    
    // Extract asset information from structured_scope relationship
    let asset = null;
    let assetType = null;
    if (report.relationships && report.relationships.structured_scope && report.relationships.structured_scope.data) {
      assetType = report.relationships.structured_scope.data.attributes?.asset_type || null;
      asset = report.relationships.structured_scope.data.attributes?.asset_identifier || null;
    }
    
    // Extract URL path and parameters from report attributes/content
    // Note: simplified approach and might need to be enhanced based on actual report content structure
    // Tested, doesn't capture URLs without HTTP/S protocol, WIP regex
    let path = null;
    let parameters = null;
    
    // Try to extract URL information from the report content
    if (report.attributes && report.attributes.vulnerability_information) {
      // Simple regex to find URLs
      const urlMatch = report.attributes.vulnerability_information.match(/https?:\/\/[^\s"']+/);
      if (urlMatch) {
        try {
          const url = new URL(urlMatch[0]);
          path = url.pathname;
          parameters = url.search ? url.search.substring(1) : null;
        } catch (e) {
          console.log(`Could not parse URL for report ${report.id}`);
        }
      }
    }
    
    return {
      id: report.id,
      title: report.attributes.title,
      state: report.attributes.state,
      severity: report.relationships?.severity?.data?.attributes?.rating || 'none',
      submitted_at: report.attributes.submitted_at,
      cwe,
      assetType,
      asset,
      path,
      parameters,
      noveltyScore: 100 // Default score, will be calculated later
    };
  });
  
  // Calculate novelty scores by comparing each report with all others
  for (let i = 0; i < reportDataForNovelty.length; i++) {
    const currentReport = reportDataForNovelty[i];
    let lowestNovelty = 100; // Start with maximum novelty
    
    for (let j = 0; j < reportDataForNovelty.length; j++) {
      // Skip comparing with itself
      if (i === j) continue;
      
      const comparisonReport = reportDataForNovelty[j];
      let currentNovelty = 100; // Start with maximum novelty for each comparison
      
      // Compare CWE (vulnerability type)
      if (currentReport.cwe && comparisonReport.cwe && 
          currentReport.cwe.id === comparisonReport.cwe.id) {
        currentNovelty = 80;
        
        // Compare Asset Type
        if (currentReport.assetType && comparisonReport.assetType && 
            currentReport.assetType === comparisonReport.assetType) {
          currentNovelty = 60;
          
          // Compare specific Asset
          if (currentReport.asset && comparisonReport.asset && 
              currentReport.asset === comparisonReport.asset) {
            currentNovelty = 40;
            
            // Compare URL Path
            if (currentReport.path && comparisonReport.path && 
                currentReport.path === comparisonReport.path) {
              currentNovelty = 20;
              
              // Compare Request Parameters
              if (currentReport.parameters && comparisonReport.parameters && 
                  currentReport.parameters === comparisonReport.parameters) {
                currentNovelty = 0;
              }
            }
          }
        }
      }
      
      // Keep track of the lowest novelty score found
      if (currentNovelty < lowestNovelty) {
        lowestNovelty = currentNovelty;
      }
    }
    
    // Assign the final novelty score
    reportDataForNovelty[i].noveltyScore = lowestNovelty;
  }
  
  // Sort reports by novelty score (highest to lowest)
  reportDataForNovelty.sort((a, b) => b.noveltyScore - a.noveltyScore);
  
  // Select top N most novel reports
  const topNovelReports = reportDataForNovelty.slice(0, config.top_novel_count);
  
  console.log(`Top ${topNovelReports.length} most novel reports identified`);
  
  // Generate email content
  let emailContent = `# Vulnerability Novelty Analysis for the ${period_lowercase}\n\n`;
  emailContent += `We analyzed ${reportDataForNovelty.length} valid reports from the ${period_lowercase} and identified the following reports with the highest novelty scores:\n\n`;
  
  // Add the top novel reports
  emailContent += `## Top ${topNovelReports.length} Most Novel Vulnerabilities\n\n`;
  
  topNovelReports.forEach((report, index) => {
    emailContent += `### ${index + 1}. ${report.title} (Report #${report.id})\n\n`;
    emailContent += `**Novelty Score:** ${report.noveltyScore}%\n`;
    emailContent += `**Severity:** ${report.severity}\n`;
    emailContent += `**State:** ${report.state}\n`;
    emailContent += `**Submitted:** ${new Date(report.submitted_at).toLocaleDateString()}\n\n`;
    
    emailContent += `**Why it's novel:**\n`;
    if (report.noveltyScore === 100) {
      emailContent += `- This is a completely unique vulnerability with no similar reports\n`;
    } else if (report.noveltyScore === 80) {
      emailContent += `- Similar vulnerability type (CWE) exists but on different assets\n`;
    } else if (report.noveltyScore === 60) {
      emailContent += `- Similar vulnerability type on the same asset type but different specific asset\n`;
    } else if (report.noveltyScore === 40) {
      emailContent += `- Similar vulnerability type on the same asset but different path\n`;
    } else if (report.noveltyScore === 20) {
      emailContent += `- Similar vulnerability type on the same asset and path but different parameters\n`;
    }
    
    if (report.cwe) {
      emailContent += `- **CWE:** ${report.cwe.name} (${report.cwe.id})\n`;
    }
    if (report.asset) {
      emailContent += `- **Asset:** ${report.asset} (${report.assetType})\n`;
    }
    if (report.path) {
      emailContent += `- **Path:** ${report.path}\n`;
    }
    
    emailContent += `\n`;
  });
  
  // Add breakdown of novelty score distribution
  const noveltyRanges = {
    unique: reportDataForNovelty.filter(r => r.noveltyScore === 100).length,
    veryNovel: reportDataForNovelty.filter(r => r.noveltyScore >= 80 && r.noveltyScore < 100).length,
    novel: reportDataForNovelty.filter(r => r.noveltyScore >= 60 && r.noveltyScore < 80).length,
    somewhat: reportDataForNovelty.filter(r => r.noveltyScore >= 40 && r.noveltyScore < 60).length,
    similar: reportDataForNovelty.filter(r => r.noveltyScore >= 20 && r.noveltyScore < 40).length,
    duplicate: reportDataForNovelty.filter(r => r.noveltyScore < 20).length
  };
  
  emailContent += `## Novelty Score Distribution\n\n`;
  emailContent += `- **Completely Unique (100%):** ${noveltyRanges.unique} reports\n`;
  emailContent += `- **Very Novel (80-99%):** ${noveltyRanges.veryNovel} reports\n`;
  emailContent += `- **Novel (60-79%):** ${noveltyRanges.novel} reports\n`;
  emailContent += `- **Somewhat Novel (40-59%):** ${noveltyRanges.somewhat} reports\n`;
  emailContent += `- **Similar (20-39%):** ${noveltyRanges.similar} reports\n`;
  emailContent += `- **Nearly Duplicate (0-19%):** ${noveltyRanges.duplicate} reports\n\n`;
  
  // Add explanation of scoring methodology
  emailContent += `## About Novelty Scoring\n\n`;
  emailContent += `The "Novelty Score" measures how unique a vulnerability is, ranging from 0% (not novel) to 100% (completely novel). It's calculated by comparing attributes across vulnerability reports:\n\n`;
  emailContent += `- CWE (vulnerability type) match = 80% novel\n`;
  emailContent += `- CWE + Asset Type match = 60% novel\n`;
  emailContent += `- CWE + same Asset match = 40% novel\n`;
  emailContent += `- CWE + Asset + Path match = 20% novel\n`;
  emailContent += `- CWE + Asset + Path + Parameter match = 0% novel\n\n`;
  emailContent += `The more attributes match between reports, the lower the novelty score. No matching attributes means 100% novelty.\n\n`;
  
  emailContent += `This report was automatically generated to help you identify the most unique vulnerabilities discovered in your program, which may represent new attack vectors requiring special attention.`;
  
  // Send email
  await apiPost(`/email`,
    JSON.stringify({
      "data": {
        "type": "email-message",
        "attributes": {
          "email": config.recipient_email,
          "subject": `Vulnerability Novelty Analysis for the ${period_lowercase}`,
          "markdown_content": emailContent
        }
      }
    })
  );
  
  console.log(`Email sent successfully to ${config.recipient_email}`);
};
