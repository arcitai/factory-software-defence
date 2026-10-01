const packageName='factory-software-defence';
const versionParts=value=>{
  if(typeof value!=='string'||!/^0\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(value))
    throw new Error('Release metadata has an unsupported Factory version; inspect the migration manually.');
  return value.split('.').map(Number);
};

// Read public metadata only. npm credentials, lifecycle scripts and native
// accounts are not needed; neither the installed package nor service is changed.
export async function checkRelease({version,channel,request=fetch}) {
  if(!['latest','next'].includes(channel))throw new Error('Choose the release channel explicitly: --channel latest or --channel next.');
  const installed=versionParts(version);
  const response=await request(`https://registry.npmjs.org/${packageName}/${channel}`,{
    headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(10000),
  });
  if(!response.ok)throw new Error(`Release lookup failed (HTTP ${response.status}); availability is unknown.`);
  let size=0;const chunks=[];
  if(!response.body)throw new Error('Release lookup returned no metadata; availability is unknown.');
  for await (const chunk of response.body) {
    size+=chunk.byteLength;
    if(size>256000)throw new Error('Release metadata exceeds 256 KB; availability is unknown.');
    chunks.push(chunk);
  }
  let candidate;
  try {candidate=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch {throw new Error('Release metadata is not valid JSON; availability is unknown.');}
  if(candidate?.name!==packageName)throw new Error('Release metadata has a different package identity; availability is unknown.');
  const available=versionParts(candidate.version);
  const difference=available.findIndex((part,index)=>part!==installed[index]);
  const relation=difference<0?'current':available[difference]>installed[difference]?'newer':'older';
  return {package:packageName,channel,checked_at:new Date().toISOString(),installed_version:version,
    available_version:candidate.version,relation,update_available:relation==='newer',
    same_version_line:available[1]===installed[1],verification:'public metadata only',activation:'manual'};
}
