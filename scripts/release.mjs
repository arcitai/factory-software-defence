import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const stable = value => typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value);
const newer = (a,b) => {
  const left=a.split('.').map(Number),right=b.split('.').map(Number);
  for(let i=0;i<3;i++)if(left[i]!==right[i])return left[i]>right[i];
  return false;
};
export async function releaseDecision(pkg,request=fetch) {
  const tag=pkg.publishConfig?.tag || 'latest';
  if(pkg.name!=='software-defence-factory'||!stable(pkg.version)||!['next','latest'].includes(tag))
    throw new Error('Unexpected release identity or channel');
  const registry='https://registry.npmjs.org/software-defence-factory';
  const lookup=path=>request(`${registry}/${path}`,{signal:AbortSignal.timeout(15000),redirect:'error'});
  const exact=await lookup(pkg.version);
  if(exact.ok)return {publish:false,channel:tag};
  if(exact.status!==404)throw new Error(`Version lookup failed: HTTP ${exact.status}`);
  const channel=await lookup(tag);
  if(channel.ok) {
    const current=await channel.json();
    if(current.name!==pkg.name||!stable(current.version)||!newer(pkg.version,current.version))
      throw new Error('Release must increase the selected channel version');
  } else if(channel.status!==404)throw new Error(`Channel lookup failed: HTTP ${channel.status}`);
  return {publish:true,channel:tag};
}
export const githubOutput=(pkg,decision)=>`publish=${decision.publish}\nversion=${pkg.version}\nchannel=${decision.channel}\n`;
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  const decision=await releaseDecision(pkg);
  console.log(`${pkg.name}@${pkg.version}: ${decision.publish?'ready to publish':'already published; skipping'} (${decision.channel})`);
  if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,githubOutput(pkg,decision));
}
