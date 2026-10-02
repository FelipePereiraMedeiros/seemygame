/** Functional delivery and qualification are independent claims. Unsupported/empty never pass. */
export function summarizeQualityRuns(runs,{requireQuality=false}={}) {
  const delivered=runs.filter(r=>r.status==='delivered'),failed=runs.some(r=>r.status==='failed');
  const functionalPassed=delivered.length>0&&!failed;
  const qualificationStatus=runs.some(r=>r.assessment?.status==='failed')?'failed':
    runs.length>0&&runs.every(r=>r.status==='delivered'&&r.assessment?.status==='passed')?'passed':'insufficient-evidence';
  const status=failed?'failed':!delivered.length?'inconclusive':!requireQuality?'passed':qualificationStatus==='passed'?'passed':qualificationStatus==='failed'?'failed':'inconclusive';
  return {functionalPassed,qualificationStatus,requireQuality,status,deliveredRuns:delivered.length,unsupportedRuns:runs.filter(r=>r.status==='unsupported').length};
}
export function evaluateStreamVerdict({functionalPassed,measurementRequested=true,measurementValid,qualificationStatus='insufficient-evidence',requireQuality=false,minFps=0,p10Fps}) {
  const performancePassed=minFps>0 ? Number.isFinite(p10Fps) ? p10Fps>=minFps : null : null;
  const failed=!functionalPassed || performancePassed===false || requireQuality&&qualificationStatus==='failed';
  const missing=measurementRequested&&measurementValid!==true || minFps>0&&performancePassed===null || requireQuality&&qualificationStatus==='insufficient-evidence';
  return {functionalPassed,measurementRequested,measurementValid:measurementRequested?measurementValid:null,performancePassed,qualificationStatus,requireQuality,overallStatus:failed?'failed':missing?'inconclusive':'passed'};
}
